import { useState, useEffect, useCallback } from 'react'
import {
  CasperClient,
  CLPublicKey,
  CLValueBuilder,
  DeployUtil,
  RuntimeArgs,
} from 'casper-js-sdk'
import { Buffer } from 'buffer'
import { generatedConfig } from './config/contracts.generated'
import proxyCallerWasmUrl from './assets/proxy_caller_with_return.wasm?url'

// Config from env with generated config fallback
const CHAIN_NAME = import.meta.env.VITE_CASPER_CHAIN_NAME || generatedConfig.chainName || 'casper-test'
const NODE_URL_RAW =
  import.meta.env.VITE_CASPER_NODE_URL || generatedConfig.nodeUrl || ''

// Always use same-origin `/rpc` to avoid CORS issues in browsers.
// - Dev: Vite proxies `/rpc` to a Casper node (see `vite.config.ts`)
// - Prod: hosting should provide `/rpc` (e.g. Vercel function + rewrite)
const NODE_URL = '/rpc'

const MCSPR_HASH = import.meta.env.VITE_MCSPR_CONTRACT_HASH || generatedConfig.mcsprContractHash || ''
const MAGNI_HASH = import.meta.env.VITE_MAGNI_CONTRACT_HASH || generatedConfig.magniContractHash || ''
const VALIDATOR_KEY = import.meta.env.VITE_DEFAULT_VALIDATOR_PUBLIC_KEY || generatedConfig.defaultValidatorPublicKey || ''

const TESTNET_EXPLORER = 'https://testnet.cspr.live'
const NETWORK_LABEL =
  CHAIN_NAME === 'casper'
    ? 'Mainnet'
    : /test/i.test(CHAIN_NAME)
      ? 'Testnet'
      : CHAIN_NAME
const MOTES_DECIMALS = 9
const WAD_DECIMALS = 18
const ONE_CSPR = BigInt(10) ** BigInt(MOTES_DECIMALS) // 1e9 motes
const ONE_WAD = BigInt(10) ** BigInt(WAD_DECIMALS)     // 1e18 wad
const MOTES_TO_WAD = BigInt(10) ** BigInt(9)           // conversion factor
const PAYMENT_AMOUNT = '5000000000' // 5 CSPR for simple contract calls
const PAYABLE_PAYMENT_AMOUNT = '50000000000' // 50 CSPR for payable calls (proxy caller wasm needs more gas)
const REQUESTS_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes (Casper Wallet provider request timeout)

// Minimum deposit = 500 CSPR (required for delegation)
const MIN_DEPOSIT_CSPR = 500n
const MIN_DEPOSIT_MOTES = MIN_DEPOSIT_CSPR * ONE_CSPR // 500 * 1e9

// LTV constants (basis points)
const LTV_MAX_BPS = 8000n // 80%
const BPS_DIVISOR = 10000n

// Casper Wallet types
interface CasperWalletState {
  isLocked: boolean
  isConnected: boolean
  activeKey: string | null
}

interface SignResult {
  cancelled: boolean
  signatureHex: string
  signature: Uint8Array
}

interface CasperWalletProvider {
  requestConnection: () => Promise<boolean>
  disconnectFromSite: () => Promise<boolean>
  getActivePublicKey: () => Promise<string>
  isConnected: () => Promise<boolean>
  sign: (deployJson: string, publicKey: string) => Promise<SignResult>
}

type CasperWalletProviderFactory = (options?: { timeout?: number }) => CasperWalletProvider

declare global {
  interface Window {
    CasperWalletProvider?: CasperWalletProviderFactory
    CasperWalletEventTypes?: {
      Connected: string
      Disconnected: string
      ActiveKeyChanged: string
      Locked: string
      Unlocked: string
    }
  }
}

// Transaction status type
type TxStatus = 'idle' | 'signing' | 'pending' | 'success' | 'error'

interface TxState {
  status: TxStatus
  hash?: string
  error?: string
}

// Vault status enum (matches contract)
type VaultStatusType = 0 | 1 | 2
const VaultStatus = {
  None: 0 as VaultStatusType,
  Active: 1 as VaultStatusType,
  Withdrawing: 2 as VaultStatusType,
}

// LocalStorage key for persisting vault state
const VAULT_STATE_KEY = 'magni_vault_state'

interface PersistedVaultState {
  collateralMotes: string
  debtWad: string
  ltvBps: string
  pendingWithdrawMotes: string
  mCSPRBalance: string
  vaultStatus: VaultStatusType
  activeKey: string
  timestamp: number
}

// Format utils
function formatCSPR(motes: bigint): string {
  const whole = motes / ONE_CSPR
  const frac = motes % ONE_CSPR
  const fracStr = frac.toString().padStart(MOTES_DECIMALS, '0').slice(0, 4)
  return `${whole}.${fracStr}`
}

function formatWad(wad: bigint): string {
  const whole = wad / ONE_WAD
  const frac = wad % ONE_WAD
  const fracStr = frac.toString().padStart(WAD_DECIMALS, '0').slice(0, 4)
  return `${whole}.${fracStr}`
}

function parseCSPR(input: string): bigint {
  const parts = input.split('.')
  const whole = BigInt(parts[0] || '0')
  let frac = BigInt(0)
  if (parts[1]) {
    const fracPart = parts[1].slice(0, MOTES_DECIMALS).padEnd(MOTES_DECIMALS, '0')
    frac = BigInt(fracPart)
  }
  return whole * ONE_CSPR + frac
}

function csprToWad(motes: bigint): bigint {
  return motes * MOTES_TO_WAD
}

function wadToMotes(wad: bigint): bigint {
  return wad / MOTES_TO_WAD
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

function extractFirstHex32(input: string): string | null {
  if (!input) return null
  const match = input.match(/[0-9a-fA-F]{64}/)
  return match ? match[0].toLowerCase() : null
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

type JsonRpcSuccess<T> = { jsonrpc: '2.0'; id: number | string; result: T }
type JsonRpcError = {
  jsonrpc: '2.0'
  id: number | string | null
  error: { code: number; message: string; data?: unknown }
}

async function jsonRpc<T>(method: string, params?: unknown): Promise<T> {
  const res = await fetch(NODE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params: params ?? [],
    }),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}: ${text}`)

  const parsed = JSON.parse(text) as JsonRpcSuccess<T> | JsonRpcError
  if ('error' in parsed) throw new Error(parsed.error.message || 'RPC error')
  return parsed.result
}

// Deploy status check result
interface DeployExecutionResult {
  Success?: unknown
  Failure?: { error_message?: string }
}

interface DeployInfoResult {
  deploy: unknown
  execution_results?: Array<{
    result: DeployExecutionResult
  }>
}

// Wait for deploy confirmation using jsonRpc directly
async function waitForDeployConfirmation(
  deployHash: string,
  maxAttempts = 90,
  intervalMs = 2000
): Promise<{ success: boolean; errorMessage?: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await jsonRpc<DeployInfoResult>('info_get_deploy', { deploy_hash: deployHash })

      if (result.execution_results && result.execution_results.length > 0) {
        const execResult = result.execution_results[0].result
        if (execResult.Success !== undefined) {
          return { success: true }
        } else if (execResult.Failure) {
          return {
            success: false,
            errorMessage: execResult.Failure.error_message || 'Execution failed',
          }
        }
      }
    } catch (err) {
      // Deploy not found yet or RPC error, continue polling
      console.debug(`[waitForDeployConfirmation] attempt ${attempt + 1}: ${err}`)
    }

    await new Promise(r => setTimeout(r, intervalMs))
  }

  return { success: false, errorMessage: 'Timeout waiting for confirmation' }
}

function isAccountHashIdentifier(id: string): boolean {
  return /^account-hash-[0-9a-f]{64}$/i.test(id)
}

function isPublicKeyIdentifier(id: string): boolean {
  return /^(01[0-9a-f]{64}|02[0-9a-f]{66})$/i.test(id) || /^[0-9a-f]{66}$/i.test(id)
}

async function fetchCsprBalanceDetails(accountIdentifier: string): Promise<{
  totalMotes: bigint
  availableMotes: bigint
  heldMotes: bigint
}> {
  try {
    const purse_identifier = isAccountHashIdentifier(accountIdentifier)
      ? { main_purse_under_account_hash: accountIdentifier }
      : { main_purse_under_public_key: accountIdentifier }

    const result = await jsonRpc<{
      api_version: string
      total_balance: string
      available_balance: string
      holds: Array<{ amount: string }>
    }>('query_balance_details', { purse_identifier })

    const heldMotes = result.holds.reduce((sum, h) => sum + BigInt(h.amount), 0n)
    return {
      totalMotes: BigInt(result.total_balance),
      availableMotes: BigInt(result.available_balance),
      heldMotes,
    }
  } catch (primaryErr) {
    // Fallback path for older nodes / unexpected identifier formats.
    // Uses legacy state_root_hash + main_purse + state_get_balance (available only).
    if (!isPublicKeyIdentifier(accountIdentifier) && !isAccountHashIdentifier(accountIdentifier)) {
      throw primaryErr
    }

    const { state_root_hash } = await jsonRpc<{ api_version: string; state_root_hash: string }>(
      'chain_get_state_root_hash',
      []
    )

    const { account } = await jsonRpc<{
      api_version: string
      account: { main_purse: string }
    }>('state_get_account_info', { account_identifier: accountIdentifier })

    const { balance_value } = await jsonRpc<{ api_version: string; balance_value: string }>(
      'state_get_balance',
      { state_root_hash, purse_uref: account.main_purse }
    )

    const availableMotes = BigInt(balance_value)
    return { totalMotes: availableMotes, availableMotes, heldMotes: 0n }
  }
}

// Save vault state to localStorage
function saveVaultState(state: PersistedVaultState): void {
  try {
    localStorage.setItem(VAULT_STATE_KEY, JSON.stringify(state))
  } catch (err) {
    console.warn('Failed to save vault state:', err)
  }
}

// Load vault state from localStorage
function loadVaultState(activeKey: string): PersistedVaultState | null {
  try {
    const raw = localStorage.getItem(VAULT_STATE_KEY)
    if (!raw) return null
    const state = JSON.parse(raw) as PersistedVaultState
    // Only return if it matches the current active key
    if (state.activeKey !== activeKey) return null
    return state
  } catch (err) {
    console.warn('Failed to load vault state:', err)
    return null
  }
}

// Query contract dictionary item
async function queryContractDictionary(
  contractHash: string,
  dictionaryName: string,
  dictionaryItemKey: string
): Promise<string | null> {
  try {
    const { state_root_hash } = await jsonRpc<{ state_root_hash: string }>('chain_get_state_root_hash', [])

    const result = await jsonRpc<{
      stored_value: {
        CLValue?: {
          bytes: string
          parsed: unknown
        }
      }
    }>('state_get_dictionary_item', {
      state_root_hash,
      dictionary_identifier: {
        ContractNamedKey: {
          key: `hash-${contractHash}`,
          dictionary_name: dictionaryName,
          dictionary_item_key: dictionaryItemKey,
        }
      }
    })

    if (result.stored_value?.CLValue?.parsed !== undefined) {
      return String(result.stored_value.CLValue.parsed)
    }
    return null
  } catch (err) {
    console.debug(`[queryContractDictionary] ${dictionaryName}[${dictionaryItemKey}]:`, err)
    return null
  }
}

// Convert public key to account hash hex
function publicKeyToAccountHashHex(publicKeyHex: string): string {
  const clPublicKey = CLPublicKey.fromHex(publicKeyHex)
  const accountHash = clPublicKey.toAccountHashStr() // "account-hash-xxxx"
  return accountHash.replace('account-hash-', '')
}

// Fetch user's vault position from contract
async function fetchVaultPosition(
  magniContractHash: string,
  mcsprContractHash: string,
  userPublicKey: string
): Promise<{
  collateralMotes: bigint
  debtWad: bigint
  pendingWithdrawMotes: bigint
  vaultStatus: VaultStatusType
  mCSPRBalance: bigint
} | null> {
  try {
    const accountHashHex = publicKeyToAccountHashHex(userPublicKey)
    console.log('[fetchVaultPosition] accountHashHex:', accountHashHex)

    // Query collateral
    const collateralRaw = await queryContractDictionary(magniContractHash, 'collateral', accountHashHex)
    const collateralMotes = collateralRaw ? BigInt(collateralRaw) : 0n

    // Query debt
    const debtRaw = await queryContractDictionary(magniContractHash, 'debt_principal', accountHashHex)
    const debtWad = debtRaw ? BigInt(debtRaw) : 0n

    // Query pending withdraw
    const pendingRaw = await queryContractDictionary(magniContractHash, 'pending_withdraw', accountHashHex)
    const pendingWithdrawMotes = pendingRaw ? BigInt(pendingRaw) : 0n

    // Query vault status
    const statusRaw = await queryContractDictionary(magniContractHash, 'vault_status', accountHashHex)
    let vaultStatus: VaultStatusType = VaultStatus.None
    if (statusRaw) {
      const statusNum = parseInt(statusRaw, 10)
      if (statusNum === 1) vaultStatus = VaultStatus.Active
      else if (statusNum === 2) vaultStatus = VaultStatus.Withdrawing
    } else if (collateralMotes > 0n) {
      // If collateral exists but status not found, assume Active
      vaultStatus = VaultStatus.Active
    }

    // Query mCSPR balance
    const mCSPRRaw = await queryContractDictionary(mcsprContractHash, 'balances', accountHashHex)
    const mCSPRBalance = mCSPRRaw ? BigInt(mCSPRRaw) : 0n

    console.log('[fetchVaultPosition] result:', {
      collateralMotes: collateralMotes.toString(),
      debtWad: debtWad.toString(),
      pendingWithdrawMotes: pendingWithdrawMotes.toString(),
      vaultStatus,
      mCSPRBalance: mCSPRBalance.toString(),
    })

    return { collateralMotes, debtWad, pendingWithdrawMotes, vaultStatus, mCSPRBalance }
  } catch (err) {
    console.error('[fetchVaultPosition] error:', err)
    return null
  }
}

function App() {
  const [activePage, setActivePage] = useState<'deposit' | 'portfolio'>(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash === 'portfolio' || hash === 'deposit') return hash
    return 'deposit'
  })

  // Wallet state
  const [provider, setProvider] = useState<CasperWalletProvider | null>(null)
  const [casperClient] = useState(() => new CasperClient(NODE_URL))
  const [isConnected, setIsConnected] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [csprTotalMotes, setCsprTotalMotes] = useState<bigint>(0n)
  const [csprAvailableMotes, setCsprAvailableMotes] = useState<bigint>(0n)
  const [csprHeldMotes, setCsprHeldMotes] = useState<bigint>(0n)
  const [csprBalanceError, setCsprBalanceError] = useState<string | null>(null)
  const [rpcChainspecName, setRpcChainspecName] = useState<string | null>(null)
  const [proxyCallerWasmBytes, setProxyCallerWasmBytes] = useState<Uint8Array | null>(null)

  const mcsprPackageHashHex = extractFirstHex32(MCSPR_HASH)
  const magniPackageHashHex = extractFirstHex32(MAGNI_HASH)

  // Vault state
  const [vaultStatus, setVaultStatus] = useState<VaultStatusType>(VaultStatus.None)
  const [collateralMotes, setCollateralMotes] = useState<bigint>(BigInt(0))
  const [debtWad, setDebtWad] = useState<bigint>(BigInt(0))
  const [ltvBps, setLtvBps] = useState<bigint>(BigInt(0))
  const [pendingWithdrawMotes, setPendingWithdrawMotes] = useState<bigint>(BigInt(0))
  const [mCSPRBalance, setMCSPRBalance] = useState<bigint>(BigInt(0))

  // Form inputs
  const [depositAmount, setDepositAmount] = useState('500')
  const [borrowAmount, setBorrowAmount] = useState('50')
  const [repayAmount, setRepayAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')

  // Transaction states
  const [depositTx, setDepositTx] = useState<TxState>({ status: 'idle' })
  const [borrowTx, setBorrowTx] = useState<TxState>({ status: 'idle' })
  const [approveTx, setApproveTx] = useState<TxState>({ status: 'idle' })
  const [repayTx, setRepayTx] = useState<TxState>({ status: 'idle' })
  const [withdrawTx, setWithdrawTx] = useState<TxState>({ status: 'idle' })
  const [finalizeTx, setFinalizeTx] = useState<TxState>({ status: 'idle' })

  // Contract configured check
  const contractsConfigured = Boolean(mcsprPackageHashHex && magniPackageHashHex)

  // Computed values
  const collateralWad = csprToWad(collateralMotes)
  const maxBorrowWad = (collateralWad * LTV_MAX_BPS) / BPS_DIVISOR
  const availableToBorrow = maxBorrowWad > debtWad ? maxBorrowWad - debtWad : BigInt(0)

  // Calculate max safe withdraw (keeps LTV at 80%)
  const minCollateralWad = debtWad > 0n ? (debtWad * BPS_DIVISOR) / LTV_MAX_BPS : 0n
  const maxWithdrawWad = collateralWad > minCollateralWad ? collateralWad - minCollateralWad : 0n
  const maxWithdrawMotes = wadToMotes(maxWithdrawWad)

  // Refresh vault position from contract
  const refreshVaultPosition = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex || !mcsprPackageHashHex) return

    console.log('[refreshVaultPosition] Fetching vault state from contract...')
    const position = await fetchVaultPosition(magniPackageHashHex, mcsprPackageHashHex, activeKey)

    if (position) {
      setCollateralMotes(position.collateralMotes)
      setDebtWad(position.debtWad)
      setPendingWithdrawMotes(position.pendingWithdrawMotes)
      setVaultStatus(position.vaultStatus)
      setMCSPRBalance(position.mCSPRBalance)

      // Calculate LTV
      const collWad = csprToWad(position.collateralMotes)
      const ltv = collWad > 0n ? (position.debtWad * BPS_DIVISOR) / collWad : 0n
      setLtvBps(ltv)

      // Save to localStorage
      saveVaultState({
        collateralMotes: position.collateralMotes.toString(),
        debtWad: position.debtWad.toString(),
        ltvBps: ltv.toString(),
        pendingWithdrawMotes: position.pendingWithdrawMotes.toString(),
        mCSPRBalance: position.mCSPRBalance.toString(),
        vaultStatus: position.vaultStatus,
        activeKey,
        timestamp: Date.now(),
      })
    }
  }, [activeKey, magniPackageHashHex, mcsprPackageHashHex])

  // Load vault state on wallet connect
  useEffect(() => {
    if (!isConnected || !activeKey) return

    // First, try to load from localStorage for immediate UI
    const cached = loadVaultState(activeKey)
    if (cached) {
      setCollateralMotes(BigInt(cached.collateralMotes))
      setDebtWad(BigInt(cached.debtWad))
      setLtvBps(BigInt(cached.ltvBps))
      setPendingWithdrawMotes(BigInt(cached.pendingWithdrawMotes))
      setMCSPRBalance(BigInt(cached.mCSPRBalance))
      setVaultStatus(cached.vaultStatus)
    }

    // Then fetch fresh data from contract
    void refreshVaultPosition()
  }, [isConnected, activeKey, refreshVaultPosition])

  // Simple hash routing for top nav
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '')
      if (hash === 'portfolio' || hash === 'deposit') {
        setActivePage(hash)
      } else if (hash) {
        // Unknown route (e.g. old #swap) -> send user to deposit.
        setActivePage('deposit')
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (window.location.hash !== `#${activePage}`) {
      window.location.hash = `#${activePage}`
    }
  }, [activePage])

  // Load Odra proxy caller (used for payable calls like deposit)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(proxyCallerWasmUrl)
        if (!res.ok) throw new Error(`Failed to load proxy caller wasm (${res.status})`)
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (!cancelled) setProxyCallerWasmBytes(bytes)
      } catch (err) {
        console.error('Failed to load proxy caller wasm:', err)
        if (!cancelled) setProxyCallerWasmBytes(null)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Detect which network the RPC actually points to (helps debug wrong proxy / env).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await jsonRpc<{ chainspec_name: string }>('info_get_status', [])
        if (!cancelled) setRpcChainspecName(status.chainspec_name)
      } catch {
        if (!cancelled) setRpcChainspecName(null)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const refreshCsprBalance = useCallback(async () => {
    if (!activeKey) return
    try {
      setCsprBalanceError(null)
      const { totalMotes, availableMotes, heldMotes } = await fetchCsprBalanceDetails(activeKey)
      setCsprTotalMotes(totalMotes)
      setCsprAvailableMotes(availableMotes)
      setCsprHeldMotes(heldMotes)
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to fetch balance'
      const hint = /Failed to fetch|NetworkError/i.test(rawMsg)
        ? 'RPC request failed. Make sure `/rpc` is reachable (dev: Vite proxy via `pnpm dev`; prod: deploy with a `/rpc` reverse proxy like Vercel `api/rpc.js`).'
        : /account/i.test(rawMsg) && /not found|missing/i.test(rawMsg)
          ? 'Account not found on this network (balance is effectively 0). Make sure your wallet is on the same network as the app and has testnet funds.'
        : rawMsg
      setCsprBalanceError(hint)
    }
  }, [activeKey])

  // Refresh balance on connect / account change
  useEffect(() => {
    if (!isConnected || !activeKey) return
    void refreshCsprBalance()
    const interval = setInterval(() => {
      void refreshCsprBalance()
    }, 15_000)
    return () => clearInterval(interval)
  }, [isConnected, activeKey, refreshCsprBalance])

  // Initialize provider
  useEffect(() => {
    const tryInit = () => {
      const providerFactory = window.CasperWalletProvider
      if (!providerFactory) return false

      try {
        let wp: CasperWalletProvider
        try {
          wp = providerFactory({ timeout: REQUESTS_TIMEOUT_MS })
        } catch {
          // Backwards compatibility: some versions exposed a constructor.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ProviderCtor = window.CasperWalletProvider as any
          wp = new ProviderCtor()
        }
        setProvider(wp)
        wp.isConnected()
          .then((connected) => {
            if (connected) {
              setIsConnected(true)
              wp.getActivePublicKey().then(setActiveKey).catch(console.error)
            }
          })
          .catch(() => {
            // Wallet may be locked; connection status will update via user action/events.
          })
        return true
      } catch (err) {
        console.error('Failed to initialize Casper Wallet provider:', err)
        return false
      }
    }

    // Content script injection can be slightly delayed; retry a few times.
    if (tryInit()) return
    let attempts = 0
    const interval = setInterval(() => {
      attempts += 1
      if (tryInit() || attempts >= 10) clearInterval(interval)
    }, 500)

    return () => clearInterval(interval)
  }, [])

  // Wallet events
  useEffect(() => {
    const handleEvent = (event: Event) => {
      const customEvent = event as CustomEvent<CasperWalletState>
      const state = customEvent.detail
      if (state.isConnected && state.activeKey) {
        setIsConnected(true)
        setActiveKey(state.activeKey)
      } else {
        setIsConnected(false)
        setActiveKey(null)
        setCsprTotalMotes(0n)
        setCsprAvailableMotes(0n)
        setCsprHeldMotes(0n)
      }
    }

    if (window.CasperWalletEventTypes) {
      window.addEventListener(window.CasperWalletEventTypes.Connected, handleEvent)
      window.addEventListener(window.CasperWalletEventTypes.Disconnected, handleEvent)
      window.addEventListener(window.CasperWalletEventTypes.ActiveKeyChanged, handleEvent)
    }

    return () => {
      if (window.CasperWalletEventTypes) {
        window.removeEventListener(window.CasperWalletEventTypes.Connected, handleEvent)
        window.removeEventListener(window.CasperWalletEventTypes.Disconnected, handleEvent)
        window.removeEventListener(window.CasperWalletEventTypes.ActiveKeyChanged, handleEvent)
      }
    }
  }, [])

  // Build and send deploy helper (standard contract call)
  const buildAndSendDeploy = useCallback(async (
    contractPackageHashHex: string,
    entryPoint: string,
    args: RuntimeArgs,
    setTxState: (state: TxState) => void
  ): Promise<boolean> => {
    if (!provider || !activeKey) return false

    try {
      setTxState({ status: 'signing' })

      const publicKey = CLPublicKey.fromHex(activeKey)
      const hashBytes = hexToBytes(contractPackageHashHex)

      const deploy = DeployUtil.makeDeploy(
        new DeployUtil.DeployParams(publicKey, CHAIN_NAME),
        DeployUtil.ExecutableDeployItem.newStoredVersionContractByHash(hashBytes, null, entryPoint, args),
        DeployUtil.standardPayment(PAYMENT_AMOUNT)
      )

      const deployJson = DeployUtil.deployToJson(deploy)
      const signResult = await provider.sign(JSON.stringify(deployJson), activeKey)

      if (signResult.cancelled) {
        setTxState({ status: 'idle', error: 'User cancelled' })
        return false
      }

      setTxState({ status: 'pending' })

      const signedDeploy = DeployUtil.setSignature(
        deploy,
        signResult.signature,
        publicKey
      )

      const deployHash = await casperClient.putDeploy(signedDeploy)
      setTxState({ status: 'pending', hash: deployHash })

      // Poll for completion using jsonRpc helper
      const confirmResult = await waitForDeployConfirmation(deployHash)
      if (confirmResult.success) {
        setTxState({ status: 'success', hash: deployHash })
        return true
      } else {
        setTxState({ status: 'error', hash: deployHash, error: confirmResult.errorMessage || 'Execution failed' })
        return false
      }
    } catch (err) {
      setTxState({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  }, [provider, activeKey, casperClient])

  // Build and send payable deploy (with attached CSPR)
  const buildAndSendPayableDeploy = useCallback(async (
    contractPackageHashHex: string,
    entryPoint: string,
    args: RuntimeArgs,
    attachedMotes: bigint,
    setTxState: (state: TxState) => void
  ): Promise<boolean> => {
    if (!provider || !activeKey) return false
    if (!proxyCallerWasmBytes) {
      setTxState({ status: 'error', error: 'Proxy caller wasm not loaded (required for payable calls).' })
      return false
    }

    console.log('[buildAndSendPayableDeploy] entryPoint:', entryPoint)
    console.log('[buildAndSendPayableDeploy] attachedMotes:', attachedMotes.toString())
    console.log('[buildAndSendPayableDeploy] in CSPR:', Number(attachedMotes) / 1e9)
    console.log('[buildAndSendPayableDeploy] contractPackageHashHex:', contractPackageHashHex)

    try {
      setTxState({ status: 'signing' })

      const publicKey = CLPublicKey.fromHex(activeKey)
      const packageHashBytes = hexToBytes(contractPackageHashHex)
      const argsBytes = args.toBytes().unwrap()

      console.log('[buildAndSendPayableDeploy] packageHashBytes length:', packageHashBytes.length)
      console.log('[buildAndSendPayableDeploy] argsBytes length:', argsBytes.length)

      const deploy = DeployUtil.makeDeploy(
        new DeployUtil.DeployParams(publicKey, CHAIN_NAME),
        DeployUtil.ExecutableDeployItem.newModuleBytes(
          proxyCallerWasmBytes,
          RuntimeArgs.fromMap({
            // Odra proxy caller args
            package_hash: CLValueBuilder.byteArray(packageHashBytes),
            entry_point: CLValueBuilder.string(entryPoint),
            args: CLValueBuilder.list(Array.from(argsBytes).map(b => CLValueBuilder.u8(b))),
            attached_value: CLValueBuilder.u512(attachedMotes.toString()),
            amount: CLValueBuilder.u512(attachedMotes.toString()),
          })
        ),
        DeployUtil.standardPayment(PAYABLE_PAYMENT_AMOUNT)
      )

      console.log('[buildAndSendPayableDeploy] gas payment:', PAYABLE_PAYMENT_AMOUNT, 'motes (', Number(PAYABLE_PAYMENT_AMOUNT) / 1e9, 'CSPR)')

      const deployJson = DeployUtil.deployToJson(deploy)
      const signResult = await provider.sign(JSON.stringify(deployJson), activeKey)

      if (signResult.cancelled) {
        setTxState({ status: 'idle', error: 'User cancelled' })
        return false
      }

      setTxState({ status: 'pending' })

      const signedDeploy = DeployUtil.setSignature(
        deploy,
        signResult.signature,
        publicKey
      )

      const deployHash = await casperClient.putDeploy(signedDeploy)
      setTxState({ status: 'pending', hash: deployHash })

      // Poll for completion using jsonRpc helper
      const confirmResult = await waitForDeployConfirmation(deployHash)
      if (confirmResult.success) {
        setTxState({ status: 'success', hash: deployHash })
        return true
      } else {
        setTxState({ status: 'error', hash: deployHash, error: confirmResult.errorMessage || 'Execution failed' })
        return false
      }
    } catch (err) {
      setTxState({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  }, [provider, activeKey, proxyCallerWasmBytes, casperClient])

  // Connect wallet
  const connect = useCallback(async () => {
    if (!provider) {
      setWalletError('Casper Wallet not found. Please install the browser extension.')
      return
    }
    try {
      setWalletError(null)
      const connected = await provider.requestConnection()
      if (connected) {
        setIsConnected(true)
        const key = await provider.getActivePublicKey()
        setActiveKey(key)
      }
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Failed to connect')
    }
  }, [provider])

  // Disconnect wallet
  const disconnect = useCallback(async () => {
    if (!provider) return
    try {
      await provider.disconnectFromSite()
      setIsConnected(false)
      setActiveKey(null)
      setVaultStatus(VaultStatus.None)
      setCollateralMotes(BigInt(0))
      setDebtWad(BigInt(0))
      setMCSPRBalance(BigInt(0))
      setCsprTotalMotes(0n)
      setCsprAvailableMotes(0n)
      setCsprHeldMotes(0n)
    } catch (err) {
      console.error('Disconnect error:', err)
    }
  }, [provider])

  // Deposit CSPR as collateral
  const handleDeposit = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const amountMotes = parseCSPR(depositAmount)
    console.log('[handleDeposit] depositAmount input:', depositAmount)
    console.log('[handleDeposit] parsed amountMotes:', amountMotes.toString())
    console.log('[handleDeposit] in CSPR:', Number(amountMotes) / 1e9)
    console.log('[handleDeposit] MIN_DEPOSIT_MOTES:', MIN_DEPOSIT_MOTES.toString())

    if (amountMotes < MIN_DEPOSIT_MOTES) {
      setDepositTx({ status: 'error', error: `Minimum deposit is ${MIN_DEPOSIT_CSPR.toString()} CSPR` })
      return
    }

    const args = RuntimeArgs.fromMap({})

    const success = await buildAndSendPayableDeploy(magniPackageHashHex, 'deposit', args, amountMotes, setDepositTx)
    if (success) {
      // Optimistic update
      setCollateralMotes(prev => prev + amountMotes)
      setVaultStatus(VaultStatus.Active)
      void refreshCsprBalance()
      // Fetch actual state from contract after a short delay
      setTimeout(() => void refreshVaultPosition(), 3000)
    }
  }, [activeKey, depositAmount, magniPackageHashHex, buildAndSendPayableDeploy, refreshCsprBalance, refreshVaultPosition])

  // Borrow mCSPR
  const handleBorrow = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const borrowMotes = parseCSPR(borrowAmount)
    const borrowWadAmount = csprToWad(borrowMotes)

    const args = RuntimeArgs.fromMap({
      amount_wad: CLValueBuilder.u256(borrowWadAmount.toString()),
    })

    const success = await buildAndSendDeploy(magniPackageHashHex, 'borrow', args, setBorrowTx)
    if (success) {
      // Optimistic update
      setDebtWad(prev => prev + borrowWadAmount)
      setMCSPRBalance(prev => prev + borrowWadAmount)
      const newDebt = debtWad + borrowWadAmount
      const ltv = collateralWad > 0n ? (newDebt * BPS_DIVISOR) / collateralWad : 0n
      setLtvBps(ltv)
      void refreshCsprBalance()
      setTimeout(() => void refreshVaultPosition(), 3000)
    }
  }, [activeKey, borrowAmount, debtWad, collateralWad, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, refreshVaultPosition])

  // Approve mCSPR for repay
  const handleApprove = useCallback(async () => {
    if (!activeKey || !mcsprPackageHashHex || !magniPackageHashHex) return

    const repayMotes = parseCSPR(repayAmount || '0')
    const repayWadAmount = repayMotes > 0n ? csprToWad(repayMotes) : debtWad

    const args = RuntimeArgs.fromMap({
      spender: CLValueBuilder.key(
        CLValueBuilder.byteArray(hexToBytes(magniPackageHashHex))
      ),
      amount: CLValueBuilder.u256(repayWadAmount.toString()),
    })

    await buildAndSendDeploy(mcsprPackageHashHex, 'approve', args, setApproveTx)
  }, [activeKey, repayAmount, debtWad, mcsprPackageHashHex, magniPackageHashHex, buildAndSendDeploy])

  // Repay mCSPR debt
  const handleRepay = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const repayMotes = parseCSPR(repayAmount || '0')
    let repayWadAmount = repayMotes > 0n ? csprToWad(repayMotes) : debtWad
    // Cap at current debt
    if (repayWadAmount > debtWad) {
      repayWadAmount = debtWad
    }

    const args = RuntimeArgs.fromMap({
      amount_wad: CLValueBuilder.u256(repayWadAmount.toString()),
    })

    const success = await buildAndSendDeploy(magniPackageHashHex, 'repay', args, setRepayTx)
    if (success) {
      // Optimistic update
      setDebtWad(prev => prev > repayWadAmount ? prev - repayWadAmount : 0n)
      setMCSPRBalance(prev => prev > repayWadAmount ? prev - repayWadAmount : 0n)
      const newDebt = debtWad - repayWadAmount
      const ltv = collateralWad > 0n ? (newDebt * BPS_DIVISOR) / collateralWad : 0n
      setLtvBps(ltv)
      void refreshCsprBalance()
      setTimeout(() => void refreshVaultPosition(), 3000)
    }
  }, [activeKey, repayAmount, debtWad, collateralWad, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, refreshVaultPosition])

  // Request withdraw
  const handleRequestWithdraw = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const withdrawMotes = parseCSPR(withdrawAmount)

    const args = RuntimeArgs.fromMap({
      amount_motes: CLValueBuilder.u512(withdrawMotes.toString()),
    })

    const success = await buildAndSendDeploy(magniPackageHashHex, 'request_withdraw', args, setWithdrawTx)
    if (success) {
      // Optimistic update
      setCollateralMotes(prev => prev > withdrawMotes ? prev - withdrawMotes : 0n)
      setPendingWithdrawMotes(withdrawMotes)
      setVaultStatus(VaultStatus.Withdrawing)
      void refreshCsprBalance()
      setTimeout(() => void refreshVaultPosition(), 3000)
    }
  }, [activeKey, withdrawAmount, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, refreshVaultPosition])

  // Finalize withdraw
  const handleFinalizeWithdraw = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const args = RuntimeArgs.fromMap({})

    const success = await buildAndSendDeploy(magniPackageHashHex, 'finalize_withdraw', args, setFinalizeTx)
    if (success) {
      // Optimistic update
      setPendingWithdrawMotes(BigInt(0))
      if (collateralMotes === BigInt(0) && debtWad === BigInt(0)) {
        setVaultStatus(VaultStatus.None)
      } else {
        setVaultStatus(VaultStatus.Active)
      }
      void refreshCsprBalance()
      setTimeout(() => void refreshVaultPosition(), 3000)
    }
  }, [activeKey, collateralMotes, debtWad, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, refreshVaultPosition])

  // Render tx status badge
  const renderTxStatus = (tx: TxState, label: string) => {
    if (tx.status === 'idle') return null
    return (
      <div className={`tx-status tx-${tx.status}`}>
        <span className="tx-label">{label}:</span>
        <span className="tx-state">
          {tx.status === 'signing' && 'Waiting for signature...'}
          {tx.status === 'pending' && 'Pending...'}
          {tx.status === 'success' && 'Success!'}
          {tx.status === 'error' && `Error: ${tx.error}`}
        </span>
        {tx.hash && (
          <a
            href={`${TESTNET_EXPLORER}/deploy/${tx.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="tx-link"
          >
            View
          </a>
        )}
      </div>
    )
  }

  const isAnyTxPending =
    depositTx.status === 'pending' || depositTx.status === 'signing' ||
    borrowTx.status === 'pending' || borrowTx.status === 'signing' ||
    approveTx.status === 'pending' || approveTx.status === 'signing' ||
    repayTx.status === 'pending' || repayTx.status === 'signing' ||
    withdrawTx.status === 'pending' || withdrawTx.status === 'signing' ||
    finalizeTx.status === 'pending' || finalizeTx.status === 'signing'

  const txList = [
    { label: 'Deposit', tx: depositTx },
    { label: 'Borrow', tx: borrowTx },
    { label: 'Approve', tx: approveTx },
    { label: 'Repay', tx: repayTx },
    { label: 'Withdraw', tx: withdrawTx },
    { label: 'Finalize', tx: finalizeTx },
  ].filter(({ tx }) => tx.status !== 'idle')

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Magni</h1>
          <span className="network-badge">{NETWORK_LABEL}</span>
        </div>
        <nav className="top-nav" aria-label="Primary">
          <button
            type="button"
            className={`nav-link ${activePage === 'deposit' ? 'active' : ''}`}
            onClick={() => setActivePage('deposit')}
          >
            Deposit
          </button>
          <button
            type="button"
            className={`nav-link ${activePage === 'portfolio' ? 'active' : ''}`}
            onClick={() => setActivePage('portfolio')}
          >
            Portfolio
          </button>
        </nav>
      </header>

      <main className="main">
        {activePage === 'portfolio' ? (
          <section className="main-left">
            <div className="card">
              <h2>Portfolio</h2>
              <p>Your balances and vault position at a glance.</p>

              <div className="balances">
                <div className="balance-row">
                  <span>CSPR (Wallet)</span>
                  <strong>{formatCSPR(csprTotalMotes)} CSPR</strong>
                </div>
                <div className="balance-row">
                  <span>mCSPR</span>
                  <strong>{formatWad(mCSPRBalance)} mCSPR</strong>
                </div>
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => setActivePage('deposit')}
                >
                  Go to Deposit
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => void refreshCsprBalance()}
                  disabled={!isConnected}
                >
                  Refresh Balance
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => void refreshVaultPosition()}
                  disabled={!isConnected || !contractsConfigured}
                >
                  Refresh Vault
                </button>
              </div>
            </div>

            <div className={`card ${vaultStatus !== VaultStatus.None ? 'connected' : ''}`}>
              <h2>Vault Position</h2>

              {vaultStatus !== VaultStatus.None ? (
                <div className="position-summary">
                  <h3>Your Vault</h3>
                  <div className="position-grid">
                    <div className="position-item">
                      <span className="label">Collateral</span>
                      <span className="value">{formatCSPR(collateralMotes)} CSPR</span>
                    </div>
                    <div className="position-item">
                      <span className="label">Debt</span>
                      <span className="value">{formatWad(debtWad)} mCSPR</span>
                    </div>
                    <div className="position-item">
                      <span className="label">LTV</span>
                      <span className="value">{Number(ltvBps) / 100}%</span>
                    </div>
                    <div className="position-item">
                      <span className="label">Status</span>
                      <span className="value">
                        {vaultStatus === VaultStatus.Active ? 'Active' :
                         vaultStatus === VaultStatus.Withdrawing ? 'Withdrawing' : 'None'}
                      </span>
                    </div>
                  </div>

                  {vaultStatus === VaultStatus.Withdrawing && (
                    <div className="position-item" style={{ marginTop: 12 }}>
                      <span className="label">Pending Withdraw</span>
                      <span className="value">{formatCSPR(pendingWithdrawMotes)} CSPR</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="no-position">No vault. Deposit CSPR to create one.</p>
              )}
            </div>

            <div className="card">
              <h2>Activity</h2>
              {txList.length === 0 ? (
                <p className="no-position">No recent transactions in this session.</p>
              ) : (
                <div className="tx-list">
                  {txList.map(({ label, tx }) => (
                    <div key={`${label}-${tx.hash || tx.status}`} className="tx-list-row">
                      <div className="tx-list-left">
                        <span className="tx-pill">{label}</span>
                        <span className="tx-list-status">{tx.status}</span>
                      </div>
                      {tx.hash ? (
                        <a
                          href={`${TESTNET_EXPLORER}/deploy/${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tx-list-link"
                        >
                          {truncateHash(tx.hash)}
                        </a>
                      ) : (
                        <span className="tx-list-link">—</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="main-left">
            <div className={`card ${vaultStatus !== VaultStatus.None ? 'connected' : ''}`}>
              <h2>Overview</h2>
              <p>Balances and vault status.</p>

              <div className="balances">
                <div className="balance-row">
                  <span>CSPR (Total)</span>
                  <strong>{formatCSPR(csprTotalMotes)} CSPR</strong>
                </div>
                <div className="balance-row">
                  <span>CSPR (Available)</span>
                  <strong>{formatCSPR(csprAvailableMotes)} CSPR</strong>
                </div>
                <div className="balance-row">
                  <span>CSPR (Held)</span>
                  <strong>{formatCSPR(csprHeldMotes)} CSPR</strong>
                </div>
                <div className="balance-row">
                  <span>Collateral</span>
                  <strong>{formatCSPR(collateralMotes)} CSPR</strong>
                </div>
                <div className="balance-row">
                  <span>Debt</span>
                  <strong>{formatWad(debtWad)} mCSPR</strong>
                </div>
                <div className="balance-row">
                  <span>LTV</span>
                  <strong>{Number(ltvBps) / 100}%</strong>
                </div>
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => void refreshCsprBalance()}
                  disabled={!isConnected}
                >
                  Refresh Balance
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => void refreshVaultPosition()}
                  disabled={!isConnected || !contractsConfigured}
                >
                  Refresh Vault
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setActivePage('portfolio')}
                >
                  View Portfolio
                </button>
              </div>
            </div>

            <div className="card">
              <h2>Deposit</h2>
              <p>Deposit native CSPR as collateral. Your CSPR will be delegated to validators for staking rewards.</p>
              <p style={{ fontSize: '0.9em', color: '#888' }}>Minimum deposit: {MIN_DEPOSIT_CSPR.toString()} CSPR (required for delegation)</p>
              <div className="input-group">
                <input
                  type="text"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder={`Min ${MIN_DEPOSIT_CSPR.toString()} CSPR`}
                  disabled={!isConnected || !contractsConfigured || !proxyCallerWasmBytes || isAnyTxPending}
                />
                <span className="input-suffix">CSPR</span>
              </div>
              {depositAmount && parseCSPR(depositAmount) > 0n && (
                <div className="info-row" style={{ marginBottom: '0.5rem', fontSize: '0.9em', color: parseCSPR(depositAmount) < MIN_DEPOSIT_MOTES ? '#e74c3c' : '#666' }}>
                  <span>Will deposit:</span>
                  <strong>
                    {formatCSPR(parseCSPR(depositAmount))} CSPR
                    {parseCSPR(depositAmount) < MIN_DEPOSIT_MOTES && ` (below minimum ${MIN_DEPOSIT_CSPR.toString()} CSPR)`}
                  </strong>
                </div>
              )}
              <button
                onClick={handleDeposit}
                className="btn btn-primary"
                disabled={!isConnected || !contractsConfigured || !proxyCallerWasmBytes || isAnyTxPending || parseCSPR(depositAmount) < MIN_DEPOSIT_MOTES}
              >
                Deposit {depositAmount} CSPR
              </button>
              {renderTxStatus(depositTx, 'Deposit')}
            </div>

            <div className="card">
              <h2>Borrow</h2>
              <p>Borrow mCSPR against your collateral (up to 80% LTV).</p>
              <div className="info-row">
                <span>Max borrow available:</span>
                <strong>{formatWad(availableToBorrow)} mCSPR</strong>
              </div>
              <div className="input-group">
                <input
                  type="text"
                  value={borrowAmount}
                  onChange={(e) => setBorrowAmount(e.target.value)}
                  placeholder="Amount in mCSPR"
                  disabled={!isConnected || !contractsConfigured || vaultStatus !== VaultStatus.Active || isAnyTxPending}
                />
                <span className="input-suffix">mCSPR</span>
              </div>
              <button
                onClick={handleBorrow}
                className="btn btn-primary"
                disabled={!isConnected || !contractsConfigured || vaultStatus !== VaultStatus.Active || isAnyTxPending}
              >
                Borrow
              </button>
              {renderTxStatus(borrowTx, 'Borrow')}
            </div>

            <div className="card">
              <h2>Repay</h2>
              <p>Repay your mCSPR debt. Requires approval first.</p>
              <div className="info-row">
                <span>Current debt:</span>
                <strong>{formatWad(debtWad)} mCSPR</strong>
              </div>
              <div className="input-group">
                <input
                  type="text"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  placeholder="Leave empty for max"
                  disabled={!isConnected || !contractsConfigured || debtWad === 0n || isAnyTxPending}
                />
                <span className="input-suffix">mCSPR</span>
              </div>
              <div className="step-actions">
                <div className="step">
                  <span className="step-label">Step 1: Approve</span>
                  <button
                    onClick={handleApprove}
                    className="btn btn-secondary"
                    disabled={!isConnected || !contractsConfigured || debtWad === 0n || isAnyTxPending}
                  >
                    Approve mCSPR
                  </button>
                  {renderTxStatus(approveTx, 'Approve')}
                </div>
                <div className="step">
                  <span className="step-label">Step 2: Repay</span>
                  <button
                    onClick={handleRepay}
                    className="btn btn-primary"
                    disabled={!isConnected || !contractsConfigured || debtWad === 0n || isAnyTxPending}
                  >
                    Repay
                  </button>
                  {renderTxStatus(repayTx, 'Repay')}
                </div>
              </div>
            </div>

            <div className="card">
              <h2>Withdraw</h2>
              <p>Withdraw collateral (2-step: request, then finalize after unbonding).</p>
              <div className="info-row">
                <span>Max safe withdraw:</span>
                <strong>{formatCSPR(maxWithdrawMotes)} CSPR</strong>
              </div>

              {vaultStatus === VaultStatus.Withdrawing ? (
                <>
                  <div className="warning-box">
                    Withdrawal pending: {formatCSPR(pendingWithdrawMotes)} CSPR
                    <br />
                    Wait for unbonding (~14h on testnet), then finalize.
                  </div>
                  <button
                    onClick={handleFinalizeWithdraw}
                    className="btn btn-primary"
                    disabled={!isConnected || isAnyTxPending}
                  >
                    Finalize Withdraw
                  </button>
                  {renderTxStatus(finalizeTx, 'Finalize')}
                </>
              ) : (
                <>
                  <div className="input-group">
                    <input
                      type="text"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="Amount in CSPR"
                      disabled={!isConnected || !contractsConfigured || vaultStatus !== VaultStatus.Active || isAnyTxPending}
                    />
                    <span className="input-suffix">CSPR</span>
                  </div>
                  <button
                    onClick={handleRequestWithdraw}
                    className="btn btn-primary"
                    disabled={!isConnected || !contractsConfigured || vaultStatus !== VaultStatus.Active || isAnyTxPending}
                  >
                    Request Withdraw
                  </button>
                  {renderTxStatus(withdrawTx, 'Withdraw')}
                </>
              )}
            </div>
          </section>
        )}

        <aside className="main-right">
          <div className={`card ${isConnected ? 'connected' : ''}`}>
            <h2>Wallet</h2>
            {!provider ? (
              <>
                <p>Casper Wallet not detected.</p>
                <a
                  href="https://www.casperwallet.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  Get Casper Wallet
                </a>
              </>
            ) : !isConnected ? (
              <>
                <p>Connect your Casper Wallet to continue.</p>
                <button onClick={connect} className="btn btn-primary">
                  Connect Wallet
                </button>
                {walletError && <p className="error">{walletError}</p>}
              </>
            ) : (
              <>
                <div className="key-display">
                  <label>Connected Account</label>
                  <div className="key-value">
                    <code>{truncateHash(activeKey || '')}</code>
                    <button
                      className="btn btn-small"
                      onClick={() => navigator.clipboard.writeText(activeKey || '')}
                    >
                      Copy
                    </button>
                  </div>
                </div>
                {rpcChainspecName && (
                  <div className="info-row" style={{ marginTop: 10 }}>
                    <span>RPC Network</span>
                    <strong>{rpcChainspecName}</strong>
                  </div>
                )}
                {rpcChainspecName && rpcChainspecName !== CHAIN_NAME && (
                  <p className="error">
                    Network mismatch: app is set to {CHAIN_NAME}, but RPC points to {rpcChainspecName}.
                  </p>
                )}
                <div className="balance-display">
                  <span>CSPR Balance (Total)</span>
                  <strong title={csprTotalMotes.toString()}>{formatCSPR(csprTotalMotes)} CSPR</strong>
                </div>
                <div className="balance-display">
                  <span>Available</span>
                  <strong title={csprAvailableMotes.toString()}>{formatCSPR(csprAvailableMotes)} CSPR</strong>
                </div>
                {csprHeldMotes > 0n && (
                  <div className="balance-display">
                    <span>Held</span>
                    <strong title={csprHeldMotes.toString()}>{formatCSPR(csprHeldMotes)} CSPR</strong>
                  </div>
                )}
                {csprBalanceError && <p className="error">{csprBalanceError}</p>}
                <div className="actions">
                  <a
                    href={`${TESTNET_EXPLORER}/account/${activeKey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary btn-small"
                  >
                    Explorer
                  </a>
                  <button onClick={disconnect} className="btn btn-outline btn-small">
                    Disconnect
                  </button>
                </div>
              </>
            )}
          </div>

          <div className={`card ${contractsConfigured ? '' : 'warning'}`}>
            <h2>Contracts</h2>
            {!contractsConfigured ? (
              <>
                <p>Contract hashes not configured. Set them in .env file:</p>
                <ul className="contract-list">
                  <li>VITE_MCSPR_CONTRACT_HASH</li>
                  <li>VITE_MAGNI_CONTRACT_HASH</li>
                </ul>
              </>
            ) : (
              <>
                <p>Contracts configured for {CHAIN_NAME}</p>
                <ul className="contract-list">
                  <li>mCSPR: {truncateHash(mcsprPackageHashHex || MCSPR_HASH)}</li>
                  <li>Magni V2: {truncateHash(magniPackageHashHex || MAGNI_HASH)}</li>
                </ul>
              </>
            )}
          </div>

          {activePage !== 'portfolio' && (
            <div className={`card ${vaultStatus !== VaultStatus.None ? 'connected' : ''}`}>
              <h2>Vault</h2>

              <div className="balances">
                <div className="balance-row">
                  <span>mCSPR Balance</span>
                  <strong>{formatWad(mCSPRBalance)} mCSPR</strong>
                </div>
              </div>

              {vaultStatus !== VaultStatus.None ? (
                <div className="position-summary">
                  <h3>Your Vault</h3>
                  <div className="position-grid">
                    <div className="position-item">
                      <span className="label">Collateral</span>
                      <span className="value">{formatCSPR(collateralMotes)} CSPR</span>
                    </div>
                    <div className="position-item">
                      <span className="label">Debt</span>
                      <span className="value">{formatWad(debtWad)} mCSPR</span>
                    </div>
                    <div className="position-item">
                      <span className="label">LTV</span>
                      <span className="value">{Number(ltvBps) / 100}%</span>
                    </div>
                    <div className="position-item">
                      <span className="label">Status</span>
                      <span className="value">
                        {vaultStatus === VaultStatus.Active ? 'Active' :
                        vaultStatus === VaultStatus.Withdrawing ? 'Withdrawing' : 'None'}
                      </span>
                    </div>
                  </div>

                  {vaultStatus === VaultStatus.Withdrawing && (
                    <div className="position-item">
                      <span className="label">Pending Withdraw</span>
                      <span className="value">{formatCSPR(pendingWithdrawMotes)} CSPR</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="no-position">No vault. Deposit CSPR to create one.</p>
              )}
            </div>
          )}

          <div className="info-card">
            <h3>Magni V2 CSPR Vault</h3>
            <p>Collateral-debt vault on Casper Network</p>
            <ul>
              <li>Deposit CSPR as collateral (staked to validators)</li>
              <li>Borrow mCSPR up to 80% LTV</li>
              <li>Debt accrues 2% APR interest</li>
              <li>2-step withdrawal (unbonding delay ~14h)</li>
              {VALIDATOR_KEY && (
                <li>Validator: {truncateHash(VALIDATOR_KEY)}</li>
              )}
            </ul>
          </div>
        </aside>
      </main>

      <footer className="footer">
        <p>Casper Testnet Only | V2 Vault Prototype</p>
      </footer>
    </div>
  )
}

export default App
