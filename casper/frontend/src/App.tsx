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

// Contract event URefs (CES - Casper Event Standard)
// These are from the deployed Magni V2 contract named keys
// Updated: 2026-01-11 deployment
const EVENTS_UREF = 'uref-95ce2e2458cdbfbfe2bedd47ac9d3cd9a4f083c84b247b94f193525fac8b956e-007'
const EVENTS_LENGTH_UREF = 'uref-c5c843543fc164b1685bda0bdcf4ff7674f642502e3406fc2437b5f19e5bea80-007'

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

type ActivityStatus = 'pending' | 'success' | 'error' | 'unknown'

interface ActivityItem {
  label: string
  hash: string
  status: ActivityStatus
  timestamp: number
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
const ACTIVITY_STATE_KEY_PREFIX = 'magni_activity_v1'
const ACTIVITY_MAX_ITEMS = 50

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Compute account hash from public key (Ed25519 or Secp256k1)
// Uses casper-js-sdk CLPublicKey.toAccountHash() which computes blake2b256(prefix + 0x00 + raw_public_key)
function computeAccountHash(publicKeyHex: string): string {
  try {
    const clPubKey = CLPublicKey.fromHex(publicKeyHex)
    const accountHash = clPubKey.toAccountHash()
    return bytesToHex(accountHash)
  } catch (err) {
    console.error('[computeAccountHash] Failed:', err)
    return ''
  }
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

async function fetchDeployActivityStatus(deployHash: string): Promise<{ status: ActivityStatus; error?: string }> {
  try {
    const result = await jsonRpc<DeployInfoResult>('info_get_deploy', { deploy_hash: deployHash })

    if (result.execution_results && result.execution_results.length > 0) {
      const execResult = result.execution_results[0].result
      if (execResult.Success !== undefined) return { status: 'success' }
      if (execResult.Failure) {
        return { status: 'error', error: execResult.Failure.error_message || 'Execution failed' }
      }
    }

    return { status: 'pending' }
  } catch (err) {
    return { status: 'unknown', error: err instanceof Error ? err.message : 'Unknown error' }
  }
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

// ============ Contract Event Fetching (CES) ============

interface VaultStateFromEvents {
  collateralMotes: bigint
  debtWad: bigint
  pendingWithdrawMotes: bigint
  vaultStatus: VaultStatusType
}

// Get current state root hash
async function getStateRootHash(): Promise<string> {
  const result = await jsonRpc<{ state_root_hash: string }>('chain_get_state_root_hash', [])
  return result.state_root_hash
}

// Get events length from contract
async function getEventsLength(): Promise<number> {
  try {
    const result = await jsonRpc<{
      stored_value: { CLValue: { parsed: number } }
    }>('query_global_state', {
      state_identifier: null,
      key: EVENTS_LENGTH_UREF,
      path: [],
    })
    return result.stored_value.CLValue.parsed
  } catch (err) {
    console.error('[getEventsLength] Failed:', err)
    return 0
  }
}

// Get event at index from dictionary
async function getEventAtIndex(stateRootHash: string, index: number): Promise<Uint8Array | null> {
  try {
    const result = await jsonRpc<{
      stored_value: { CLValue: { bytes: string } }
    }>('state_get_dictionary_item', {
      state_root_hash: stateRootHash,
      dictionary_identifier: {
        URef: {
          seed_uref: EVENTS_UREF,
          dictionary_item_key: index.toString(),
        },
      },
    })

    // The bytes are the raw List<u8> which contains the CES event
    const bytesHex = result.stored_value.CLValue.bytes
    // Skip the first 4 bytes (length prefix of the List<u8>)
    const eventBytesHex = bytesHex.slice(8) // 4 bytes = 8 hex chars
    return hexToBytes(eventBytesHex)
  } catch (err) {
    console.error(`[getEventAtIndex] Failed for index ${index}:`, err)
    return null
  }
}

// Parse U512 from bytes (Casper serialization: 1 byte length + LE value bytes)
function parseU512(data: Uint8Array, offset: number): { value: bigint; bytesRead: number } {
  const length = data[offset]
  if (length === 0) return { value: 0n, bytesRead: 1 }

  let value = 0n
  for (let i = 0; i < length; i++) {
    value |= BigInt(data[offset + 1 + i]) << BigInt(i * 8)
  }
  return { value, bytesRead: 1 + length }
}

// Parse U256 from bytes (same format as U512)
function parseU256(data: Uint8Array, offset: number): { value: bigint; bytesRead: number } {
  return parseU512(data, offset) // Same format
}

function parseOptionAddress(data: Uint8Array, offset: number): {
  address: { tag: number; hashHex: string } | null
  bytesRead: number
} {
  // Option<T>: 0 => None, 1 => Some(T)
  const opt = data[offset]
  if (opt === 0) return { address: null, bytesRead: 1 }

  // Address is serialized as Key: tag (1 byte) + 32 bytes hash (Odra Address only uses Account/Hash)
  if (offset + 34 > data.length) return { address: null, bytesRead: 1 }
  const addrTag = data[offset + 1]
  const hashHex = bytesToHex(data.slice(offset + 2, offset + 34))
  return { address: { tag: addrTag, hashHex }, bytesRead: 1 + 1 + 32 }
}

function parseCESEventName(eventBytes: Uint8Array): { name: string; offsetAfterName: number } | null {
  // CES event format:
  // - u32 event_name_length (4 bytes LE)
  // - event_name (utf8 string)
  // - event data (varies by event type)
  if (eventBytes.length < 4) return null
  let offset = 0
  const nameLength = eventBytes[offset] | (eventBytes[offset + 1] << 8) |
    (eventBytes[offset + 2] << 16) | (eventBytes[offset + 3] << 24)
  offset += 4
  if (nameLength < 0 || offset + nameLength > eventBytes.length) return null
  const name = new TextDecoder().decode(eventBytes.slice(offset, offset + nameLength))
  offset += nameLength
  return { name, offsetAfterName: offset }
}

function extractEntityHashHexFromStoredValue(storedValue: unknown): string | null {
  try {
    const text = JSON.stringify(storedValue)
    const entityMatch = text.match(/entity-hash-[0-9a-f]{64}/i)
    if (entityMatch) return extractFirstHex32(entityMatch[0])
    const contractMatch = text.match(/contract-hash-[0-9a-f]{64}/i)
    if (contractMatch) return extractFirstHex32(contractMatch[0])
    return null
  } catch {
    return null
  }
}

async function resolveEntityHashHexFromContractPackageHash(contractPackageHashHex: string): Promise<string> {
  try {
    const result = await jsonRpc<{ stored_value?: unknown }>('query_global_state', {
      state_identifier: null,
      key: `hash-${contractPackageHashHex}`,
      path: [],
    })
    const extracted = extractEntityHashHexFromStoredValue(result.stored_value)
    return extracted || contractPackageHashHex
  } catch {
    return contractPackageHashHex
  }
}

async function getEventsLengthForEntity(entityHashHex: string): Promise<number> {
  try {
    // First get the contract's named keys to find __events_length URef
    const contractResult = await jsonRpc<{
      stored_value?: { Contract?: { named_keys?: Array<{ name: string; key: string }> } }
    }>('query_global_state', {
      state_identifier: null,
      key: `hash-${entityHashHex}`,
      path: [],
    })

    const namedKeys = contractResult.stored_value?.Contract?.named_keys
    if (!namedKeys) return 0

    const eventsLengthKey = namedKeys.find(nk => nk.name === '__events_length')
    if (!eventsLengthKey) return 0

    // Query the URef directly
    const result = await jsonRpc<{
      stored_value?: { CLValue?: { parsed?: unknown } }
    }>('query_global_state', {
      state_identifier: null,
      key: eventsLengthKey.key,
      path: [],
    })
    const parsed = result.stored_value?.CLValue?.parsed
    if (typeof parsed === 'number') return parsed
    if (typeof parsed === 'string') return Number(parsed) || 0
    return 0
  } catch {
    return 0
  }
}

async function getEventAtIndexForEntity(
  stateRootHash: string,
  entityHashHex: string,
  index: number
): Promise<Uint8Array | null> {
  try {
    const result = await jsonRpc<{
      stored_value?: { CLValue?: { bytes?: string } }
    }>('state_get_dictionary_item', {
      state_root_hash: stateRootHash,
      dictionary_identifier: {
        ContractNamedKey: {
          key: `hash-${entityHashHex}`,
          dictionary_name: '__events',  // Odra uses double underscore prefix
          dictionary_item_key: index.toString(),
        },
      },
    })
    const bytesHex = result.stored_value?.CLValue?.bytes
    if (!bytesHex) return null
    // Skip the first 4 bytes (length prefix of the List<u8>)
    const eventBytesHex = bytesHex.slice(8)
    return hexToBytes(eventBytesHex)
  } catch {
    return null
  }
}

// Fetch mCSPR balance by querying the balances dictionary directly
async function fetchMcsprBalanceFromContract(
  tokenPackageHashHex: string,
  userAccountHashHex: string
): Promise<bigint> {
  try {
    // Get entity hash from package hash
    const entityHashHex = await resolveEntityHashHexFromContractPackageHash(tokenPackageHashHex)
    console.log('[fetchMcsprBalance] Entity hash:', entityHashHex)
    console.log('[fetchMcsprBalance] User account hash:', userAccountHashHex)

    // In Odra, Mapping<Address, V> keys are serialized as: Address enum tag (1 byte) + hash (32 bytes)
    // For AccountHash: tag=0 + account_hash (hex encoded)
    const keyHex = '00' + userAccountHashHex.toLowerCase()
    console.log('[fetchMcsprBalance] Dictionary key (hex):', keyHex)

    const stateRootHash = await getStateRootHash()

    // Try multiple key formats since Odra's exact format may vary
    const keyFormats = [
      keyHex,                                          // hex: 00 + account_hash
      userAccountHashHex.toLowerCase(),                // just account hash
      `account-hash-${userAccountHashHex.toLowerCase()}`, // account-hash-xxx format
    ]

    for (const key of keyFormats) {
      try {
        console.log('[fetchMcsprBalance] Trying key format:', key)
        const result = await jsonRpc<{
          stored_value?: { CLValue?: { bytes?: string; parsed?: string | number } }
        }>('state_get_dictionary_item', {
          state_root_hash: stateRootHash,
          dictionary_identifier: {
            ContractNamedKey: {
              key: `hash-${entityHashHex}`,
              dictionary_name: 'balances',
              dictionary_item_key: key,
            },
          },
        })

        console.log('[fetchMcsprBalance] Result for key', key, ':', result)

        // Parse U256 from CLValue
        const parsed = result.stored_value?.CLValue?.parsed
        if (parsed !== undefined && parsed !== null) {
          const value = BigInt(parsed)
          if (value > 0n) {
            console.log('[fetchMcsprBalance] Found balance:', value.toString())
            return value
          }
        }

        // Try parsing from bytes if parsed is not available
        const bytesHex = result.stored_value?.CLValue?.bytes
        if (bytesHex) {
          const bytes = hexToBytes(bytesHex)
          const { value } = parseU256(bytes, 0)
          if (value > 0n) {
            console.log('[fetchMcsprBalance] Found balance from bytes:', value.toString())
            return value
          }
        }
      } catch (e) {
        // Key format didn't work, try next
        console.log('[fetchMcsprBalance] Key format failed:', key, e)
      }
    }

    console.log('[fetchMcsprBalance] No balance found with any key format')
    return 0n
  } catch (err) {
    console.log('[fetchMcsprBalance] Error:', err)
    return 0n
  }
}

// Event types we care about
type ParsedEvent =
  | { type: 'Deposited'; user: string; amountMotes: bigint; newCollateralMotes: bigint }
  | { type: 'Borrowed'; user: string; amountWad: bigint; newDebtWad: bigint }
  | { type: 'Repaid'; user: string; amountWad: bigint; newDebtWad: bigint }
  | { type: 'WithdrawRequested'; user: string; amountMotes: bigint }
  | { type: 'WithdrawFinalized'; user: string; amountMotes: bigint }
  | { type: 'Unknown'; name: string }

// Parse a CES event from bytes
function parseCESEvent(eventBytes: Uint8Array): ParsedEvent {
  // CES event format:
  // - u32 event_name_length (4 bytes LE)
  // - event_name (utf8 string)
  // - event data (varies by event type)

  let offset = 0

  // Read event name length
  const nameLength = eventBytes[offset] | (eventBytes[offset + 1] << 8) |
    (eventBytes[offset + 2] << 16) | (eventBytes[offset + 3] << 24)
  offset += 4

  // Read event name
  const nameBytes = eventBytes.slice(offset, offset + nameLength)
  const eventName = new TextDecoder().decode(nameBytes)
  offset += nameLength

  console.log(`[parseCESEvent] Event name: "${eventName}", offset after name: ${offset}`)

  // Parse based on event type
  if (eventName === 'event_Deposited') {
    // Address type tag (0 = AccountHash, 1 = ContractPackageHash)
    const addressTag = eventBytes[offset]
    offset += 1

    // Account hash (32 bytes)
    const userHash = bytesToHex(eventBytes.slice(offset, offset + 32))
    offset += 32

    // amount_motes (U512)
    const amountResult = parseU512(eventBytes, offset)
    offset += amountResult.bytesRead

    // new_collateral_motes (U512)
    const newCollateralResult = parseU512(eventBytes, offset)

    return {
      type: 'Deposited',
      user: userHash,
      amountMotes: amountResult.value,
      newCollateralMotes: newCollateralResult.value,
    }
  }

  if (eventName === 'event_Borrowed') {
    const addressTag = eventBytes[offset]
    offset += 1

    const userHash = bytesToHex(eventBytes.slice(offset, offset + 32))
    offset += 32

    const amountResult = parseU256(eventBytes, offset)
    offset += amountResult.bytesRead

    const newDebtResult = parseU256(eventBytes, offset)

    return {
      type: 'Borrowed',
      user: userHash,
      amountWad: amountResult.value,
      newDebtWad: newDebtResult.value,
    }
  }

  if (eventName === 'event_Repaid') {
    const addressTag = eventBytes[offset]
    offset += 1

    const userHash = bytesToHex(eventBytes.slice(offset, offset + 32))
    offset += 32

    const amountResult = parseU256(eventBytes, offset)
    offset += amountResult.bytesRead

    const newDebtResult = parseU256(eventBytes, offset)

    return {
      type: 'Repaid',
      user: userHash,
      amountWad: amountResult.value,
      newDebtWad: newDebtResult.value,
    }
  }

  if (eventName === 'event_WithdrawRequested') {
    const addressTag = eventBytes[offset]
    offset += 1

    const userHash = bytesToHex(eventBytes.slice(offset, offset + 32))
    offset += 32

    const amountResult = parseU512(eventBytes, offset)

    return {
      type: 'WithdrawRequested',
      user: userHash,
      amountMotes: amountResult.value,
    }
  }

  if (eventName === 'event_WithdrawFinalized') {
    const addressTag = eventBytes[offset]
    offset += 1

    const userHash = bytesToHex(eventBytes.slice(offset, offset + 32))
    offset += 32

    const amountResult = parseU512(eventBytes, offset)

    return {
      type: 'WithdrawFinalized',
      user: userHash,
      amountMotes: amountResult.value,
    }
  }

  return { type: 'Unknown', name: eventName }
}

// Fetch vault state from contract events
async function fetchVaultStateFromEvents(userAccountHashHex: string): Promise<VaultStateFromEvents | null> {
  console.log('[fetchVaultStateFromEvents] Fetching for user:', userAccountHashHex)

  try {
    // Get events length
    const eventsLength = await getEventsLength()
    console.log('[fetchVaultStateFromEvents] Events length:', eventsLength)

    if (eventsLength === 0) {
      return null
    }

    // Get state root hash
    const stateRootHash = await getStateRootHash()
    console.log('[fetchVaultStateFromEvents] State root:', stateRootHash)

    // Track user state from events
    let collateralMotes = 0n
    let debtWad = 0n
    let pendingWithdrawMotes = 0n
    let vaultStatus: VaultStatusType = VaultStatus.None
    let foundUserEvent = false

    // Fetch and process all events (most recent state wins for deposit/borrow amounts)
    for (let i = 0; i < eventsLength; i++) {
      const eventBytes = await getEventAtIndex(stateRootHash, i)
      if (!eventBytes) continue

      const event = parseCESEvent(eventBytes)
      console.log(`[fetchVaultStateFromEvents] Event ${i}:`, event)

      // Check if event belongs to this user
      const eventUser = 'user' in event ? event.user.toLowerCase() : null
      if (!eventUser || eventUser !== userAccountHashHex.toLowerCase()) {
        console.log(`[fetchVaultStateFromEvents] Event ${i} not for this user (event user: ${eventUser})`)
        continue
      }

      foundUserEvent = true

      switch (event.type) {
        case 'Deposited':
          // Use the new_collateral_motes from event as authoritative state
          collateralMotes = event.newCollateralMotes
          vaultStatus = VaultStatus.Active
          break

        case 'Borrowed':
          debtWad = event.newDebtWad
          break

        case 'Repaid':
          debtWad = event.newDebtWad
          break

        case 'WithdrawRequested':
          pendingWithdrawMotes = event.amountMotes
          vaultStatus = VaultStatus.Withdrawing
          // Collateral is reduced when withdraw is requested
          collateralMotes = collateralMotes > event.amountMotes
            ? collateralMotes - event.amountMotes
            : 0n
          break

        case 'WithdrawFinalized':
          pendingWithdrawMotes = 0n
          // After finalize, if no collateral left, vault is None
          if (collateralMotes === 0n && debtWad === 0n) {
            vaultStatus = VaultStatus.None
          } else {
            vaultStatus = VaultStatus.Active
          }
          break
      }
    }

    if (!foundUserEvent) {
      console.log('[fetchVaultStateFromEvents] No events found for user')
      return null
    }

    console.log('[fetchVaultStateFromEvents] Final state:', {
      collateralMotes: collateralMotes.toString(),
      debtWad: debtWad.toString(),
      pendingWithdrawMotes: pendingWithdrawMotes.toString(),
      vaultStatus,
    })

    return {
      collateralMotes,
      debtWad,
      pendingWithdrawMotes,
      vaultStatus,
    }
  } catch (err) {
    console.error('[fetchVaultStateFromEvents] Error:', err)
    return null
  }
}

// ============ End Contract Event Fetching ============

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
  const [mcsprBalanceError, setMcsprBalanceError] = useState<string | null>(null)
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

  // Activity (persisted across sessions)
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [isRefreshingActivity, setIsRefreshingActivity] = useState(false)

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

  // Loading state for vault refresh
  const [isLoadingVault, setIsLoadingVault] = useState(false)

  const refreshMCSPRBalance = useCallback(async () => {
    if (!activeKey || !mcsprPackageHashHex) return
    try {
      setMcsprBalanceError(null)
      const accountHash = computeAccountHash(activeKey)
      if (!accountHash) throw new Error('Failed to compute account hash')

      const balance = await fetchMcsprBalanceFromContract(mcsprPackageHashHex, accountHash)
      setMCSPRBalance(balance)
    } catch (err) {
      setMcsprBalanceError(err instanceof Error ? err.message : 'Failed to fetch mCSPR balance')
    }
  }, [activeKey, mcsprPackageHashHex])

  // Reload vault state from contract events (primary) or localStorage (fallback)
  const reloadVaultState = useCallback(async () => {
    if (!activeKey) return

    setIsLoadingVault(true)
    console.log('[reloadVaultState] Starting fetch for:', activeKey)

    try {
      // Compute account hash from public key
      const accountHash = computeAccountHash(activeKey)
      console.log('[reloadVaultState] Account hash:', accountHash)

      if (accountHash) {
        // Try to fetch from contract events
        const contractState = await fetchVaultStateFromEvents(accountHash)

        if (contractState) {
          console.log('[reloadVaultState] Got state from contract events:', contractState)
          setCollateralMotes(contractState.collateralMotes)
          setDebtWad(contractState.debtWad)
          setPendingWithdrawMotes(contractState.pendingWithdrawMotes)
          setVaultStatus(contractState.vaultStatus)

          // Calculate LTV
          const collateralWadValue = csprToWad(contractState.collateralMotes)
          const ltv = collateralWadValue > 0n
            ? (contractState.debtWad * BPS_DIVISOR) / collateralWadValue
            : 0n
          setLtvBps(ltv)

          await refreshMCSPRBalance()
          return
        }
      }

      // Fallback to localStorage
      console.log('[reloadVaultState] Falling back to localStorage')
      const cached = loadVaultState(activeKey)
      if (cached) {
        console.log('[reloadVaultState] Loaded from localStorage:', cached)
        setCollateralMotes(BigInt(cached.collateralMotes))
        setDebtWad(BigInt(cached.debtWad))
        setLtvBps(BigInt(cached.ltvBps))
        setPendingWithdrawMotes(BigInt(cached.pendingWithdrawMotes))
        setMCSPRBalance(BigInt(cached.mCSPRBalance))
        setVaultStatus(cached.vaultStatus)
        await refreshMCSPRBalance()
      } else {
        console.log('[reloadVaultState] No cached state found')
      }
    } catch (err) {
      console.error('[reloadVaultState] Error:', err)
      // Try localStorage as fallback
      const cached = loadVaultState(activeKey)
      if (cached) {
        setCollateralMotes(BigInt(cached.collateralMotes))
        setDebtWad(BigInt(cached.debtWad))
        setLtvBps(BigInt(cached.ltvBps))
        setPendingWithdrawMotes(BigInt(cached.pendingWithdrawMotes))
        setMCSPRBalance(BigInt(cached.mCSPRBalance))
        setVaultStatus(cached.vaultStatus)
        await refreshMCSPRBalance()
      }
    } finally {
      setIsLoadingVault(false)
    }
  }, [activeKey, refreshMCSPRBalance])


  // Load vault state on wallet connect - try contract events first, then localStorage
  useEffect(() => {
    if (!isConnected || !activeKey) return

    // Try to load from contract events first
    void reloadVaultState()
    void refreshMCSPRBalance()
  }, [isConnected, activeKey, reloadVaultState, refreshMCSPRBalance])

  // Auto-save vault state whenever it changes
  useEffect(() => {
    if (!activeKey || collateralMotes === 0n && debtWad === 0n && vaultStatus === VaultStatus.None) {
      return // Don't save empty state
    }
    console.log('[autoSaveVaultState] Saving state:', { collateralMotes: collateralMotes.toString(), debtWad: debtWad.toString(), vaultStatus })
    saveVaultState({
      collateralMotes: collateralMotes.toString(),
      debtWad: debtWad.toString(),
      ltvBps: ltvBps.toString(),
      pendingWithdrawMotes: pendingWithdrawMotes.toString(),
      mCSPRBalance: mCSPRBalance.toString(),
      vaultStatus,
      activeKey,
      timestamp: Date.now(),
    })
  }, [activeKey, collateralMotes, debtWad, ltvBps, pendingWithdrawMotes, mCSPRBalance, vaultStatus])

  const recordActivityPending = useCallback((label: string, hash: string) => {
    setActivityItems(prev => {
      const next: ActivityItem[] = [
        { label, hash, status: 'pending', timestamp: Date.now() },
        ...prev.filter(i => i.hash !== hash),
      ]
      next.sort((a, b) => b.timestamp - a.timestamp)
      return next.slice(0, ACTIVITY_MAX_ITEMS)
    })
  }, [])

  const recordActivityFinal = useCallback((hash: string, status: ActivityStatus, error?: string) => {
    setActivityItems(prev => prev.map(i => i.hash === hash ? { ...i, status, error } : i))
  }, [])

  // Load activity from localStorage on wallet connect / key change
  useEffect(() => {
    if (!isConnected || !activeKey) {
      setActivityItems([])
      return
    }

    const storageKey = `${ACTIVITY_STATE_KEY_PREFIX}:${CHAIN_NAME}:${activeKey.toLowerCase()}`
    try {
      const raw = localStorage.getItem(storageKey)
      const parsed = raw ? (JSON.parse(raw) as ActivityItem[]) : []
      const normalized = Array.isArray(parsed)
        ? parsed
          .filter(i => i && typeof i.hash === 'string' && typeof i.label === 'string')
          .map(i => ({
            label: i.label,
            hash: i.hash,
            status: (i.status === 'pending' || i.status === 'success' || i.status === 'error' || i.status === 'unknown')
              ? i.status
              : 'unknown',
            timestamp: typeof i.timestamp === 'number' ? i.timestamp : Date.now(),
            error: typeof i.error === 'string' ? i.error : undefined,
          }))
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, ACTIVITY_MAX_ITEMS)
        : []

      setActivityItems(normalized)

      const pending = normalized.filter(i => i.status === 'pending').slice(0, 10)
      if (pending.length > 0) {
        let cancelled = false
        ;(async () => {
          setIsRefreshingActivity(true)
          try {
            await Promise.all(
              pending.map(async (item) => {
                const refreshed = await fetchDeployActivityStatus(item.hash)
                if (cancelled) return
                if (refreshed.status !== 'pending') {
                  recordActivityFinal(item.hash, refreshed.status, refreshed.error)
                }
              })
            )
          } finally {
            if (!cancelled) setIsRefreshingActivity(false)
          }
        })()
        return () => { cancelled = true }
      }
    } catch (err) {
      console.warn('Failed to load activity state:', err)
      setActivityItems([])
    }
  }, [isConnected, activeKey, recordActivityFinal])

  // Persist activity to localStorage
  useEffect(() => {
    if (!isConnected || !activeKey) return
    const storageKey = `${ACTIVITY_STATE_KEY_PREFIX}:${CHAIN_NAME}:${activeKey.toLowerCase()}`
    try {
      localStorage.setItem(storageKey, JSON.stringify(activityItems.slice(0, ACTIVITY_MAX_ITEMS)))
    } catch (err) {
      console.warn('Failed to save activity state:', err)
    }
  }, [isConnected, activeKey, activityItems])

  const refreshActivity = useCallback(async () => {
    if (!isConnected || !activeKey) return
    const pending = activityItems.filter(i => i.status === 'pending').slice(0, 10)
    if (pending.length === 0) return

    setIsRefreshingActivity(true)
    try {
      await Promise.all(
        pending.map(async (item) => {
          const refreshed = await fetchDeployActivityStatus(item.hash)
          if (refreshed.status !== 'pending') {
            recordActivityFinal(item.hash, refreshed.status, refreshed.error)
          }
        })
      )
    } finally {
      setIsRefreshingActivity(false)
    }
  }, [isConnected, activeKey, activityItems, recordActivityFinal])

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
    setTxState: (state: TxState) => void,
    activityLabel?: string
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
      if (activityLabel) recordActivityPending(activityLabel, deployHash)

      // Poll for completion using jsonRpc helper
      const confirmResult = await waitForDeployConfirmation(deployHash)
      if (confirmResult.success) {
        setTxState({ status: 'success', hash: deployHash })
        if (activityLabel) recordActivityFinal(deployHash, 'success')
        return true
      } else {
        setTxState({ status: 'error', hash: deployHash, error: confirmResult.errorMessage || 'Execution failed' })
        if (activityLabel) recordActivityFinal(deployHash, 'error', confirmResult.errorMessage || 'Execution failed')
        return false
      }
    } catch (err) {
      setTxState({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  }, [provider, activeKey, casperClient, recordActivityPending, recordActivityFinal])

  // Build and send payable deploy (with attached CSPR)
  const buildAndSendPayableDeploy = useCallback(async (
    contractPackageHashHex: string,
    entryPoint: string,
    args: RuntimeArgs,
    attachedMotes: bigint,
    setTxState: (state: TxState) => void,
    activityLabel?: string
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
      if (activityLabel) recordActivityPending(activityLabel, deployHash)

      // Poll for completion using jsonRpc helper
      const confirmResult = await waitForDeployConfirmation(deployHash)
      if (confirmResult.success) {
        setTxState({ status: 'success', hash: deployHash })
        if (activityLabel) recordActivityFinal(deployHash, 'success')
        return true
      } else {
        setTxState({ status: 'error', hash: deployHash, error: confirmResult.errorMessage || 'Execution failed' })
        if (activityLabel) recordActivityFinal(deployHash, 'error', confirmResult.errorMessage || 'Execution failed')
        return false
      }
    } catch (err) {
      setTxState({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      return false
    }
  }, [provider, activeKey, proxyCallerWasmBytes, casperClient, recordActivityPending, recordActivityFinal])

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
      setCsprBalanceError(null)
      setMcsprBalanceError(null)
      setDepositTx({ status: 'idle' })
      setBorrowTx({ status: 'idle' })
      setApproveTx({ status: 'idle' })
      setRepayTx({ status: 'idle' })
      setWithdrawTx({ status: 'idle' })
      setFinalizeTx({ status: 'idle' })
      setActivityItems([])
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

    const success = await buildAndSendPayableDeploy(magniPackageHashHex, 'deposit', args, amountMotes, setDepositTx, 'Deposit')
    if (success) {
      // Refresh from contract events to get authoritative state
      void reloadVaultState()
      void refreshCsprBalance()
    }
  }, [activeKey, depositAmount, magniPackageHashHex, buildAndSendPayableDeploy, refreshCsprBalance, reloadVaultState])

  // Borrow mCSPR
  const handleBorrow = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const borrowMotes = parseCSPR(borrowAmount)
    const borrowWadAmount = csprToWad(borrowMotes)

    const args = RuntimeArgs.fromMap({
      amount_wad: CLValueBuilder.u256(borrowWadAmount.toString()),
    })

    const success = await buildAndSendDeploy(magniPackageHashHex, 'borrow', args, setBorrowTx, 'Borrow')
    if (success) {
      // Refresh from contract events to get authoritative state
      void reloadVaultState()
      void refreshCsprBalance()
    }
  }, [activeKey, borrowAmount, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, reloadVaultState])

  // Approve mCSPR for repay (specific amount)
  const handleApprove = useCallback(async () => {
    if (!activeKey || !mcsprPackageHashHex || !magniPackageHashHex) return

    const repayMotes = parseCSPR(repayAmount || '0')
    if (repayMotes === 0n) {
      setApproveTx({ status: 'error', error: 'Enter an amount to approve' })
      return
    }
    let repayWadAmount = csprToWad(repayMotes)
    // Cap at current debt
    if (repayWadAmount > debtWad) {
      repayWadAmount = debtWad
    }

    const args = RuntimeArgs.fromMap({
      spender: CLValueBuilder.key(
        CLValueBuilder.byteArray(hexToBytes(magniPackageHashHex))
      ),
      amount: CLValueBuilder.u256(repayWadAmount.toString()),
    })

    await buildAndSendDeploy(mcsprPackageHashHex, 'approve', args, setApproveTx, 'Approve')
  }, [activeKey, repayAmount, debtWad, mcsprPackageHashHex, magniPackageHashHex, buildAndSendDeploy])

  // Approve all mCSPR for repay_all (adds 1% buffer for interest accrual)
  const handleApproveAll = useCallback(async () => {
    if (!activeKey || !mcsprPackageHashHex || !magniPackageHashHex) return

    if (debtWad === 0n) {
      setApproveTx({ status: 'error', error: 'No debt to repay' })
      return
    }

    // Add 1% buffer for interest that accrues between approve and repay_all
    const approveAmount = debtWad + (debtWad / 100n)

    const args = RuntimeArgs.fromMap({
      spender: CLValueBuilder.key(
        CLValueBuilder.byteArray(hexToBytes(magniPackageHashHex))
      ),
      amount: CLValueBuilder.u256(approveAmount.toString()),
    })

    await buildAndSendDeploy(mcsprPackageHashHex, 'approve', args, setApproveTx, 'Approve All')
  }, [activeKey, debtWad, mcsprPackageHashHex, magniPackageHashHex, buildAndSendDeploy])

  // Repay mCSPR debt
  const handleRepay = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const repayMotes = parseCSPR(repayAmount || '0')
    if (repayMotes === 0n) {
      setRepayTx({ status: 'error', error: 'Enter an amount to repay' })
      return
    }
    let repayWadAmount = csprToWad(repayMotes)
    // Cap at current debt
    if (repayWadAmount > debtWad) {
      repayWadAmount = debtWad
    }

    const args = RuntimeArgs.fromMap({
      amount_wad: CLValueBuilder.u256(repayWadAmount.toString()),
    })

    const success = await buildAndSendDeploy(magniPackageHashHex, 'repay', args, setRepayTx, 'Repay')
    if (success) {
      // Refresh from contract events to get authoritative state
      void reloadVaultState()
      void refreshCsprBalance()
    }
  }, [activeKey, repayAmount, debtWad, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, reloadVaultState])

  // Request withdraw
  const handleRequestWithdraw = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const withdrawMotes = parseCSPR(withdrawAmount)

    const args = RuntimeArgs.fromMap({
      amount_motes: CLValueBuilder.u512(withdrawMotes.toString()),
    })

    const success = await buildAndSendDeploy(magniPackageHashHex, 'request_withdraw', args, setWithdrawTx, 'Withdraw')
    if (success) {
      // Refresh from contract events to get authoritative state
      void reloadVaultState()
      void refreshCsprBalance()
    }
  }, [activeKey, withdrawAmount, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, reloadVaultState])

  // Withdraw max (calls contract's withdraw_max which calculates exact max on-chain)
  const handleWithdrawMax = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const args = RuntimeArgs.fromMap({})

    const success = await buildAndSendDeploy(magniPackageHashHex, 'withdraw_max', args, setWithdrawTx, 'Withdraw Max')
    if (success) {
      // Refresh from contract events to get authoritative state
      void reloadVaultState()
      void refreshCsprBalance()
    }
  }, [activeKey, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, reloadVaultState])

  // Finalize withdraw
  const handleFinalizeWithdraw = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const args = RuntimeArgs.fromMap({})

    const success = await buildAndSendDeploy(magniPackageHashHex, 'finalize_withdraw', args, setFinalizeTx, 'Finalize')
    if (success) {
      // Refresh from contract events to get authoritative state
      void reloadVaultState()
      void refreshCsprBalance()
    }
  }, [activeKey, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, reloadVaultState])

  // Repay all debt (calls contract's repay_all which calculates exact debt on-chain)
  const handleRepayAll = useCallback(async () => {
    if (!activeKey || !magniPackageHashHex) return

    const args = RuntimeArgs.fromMap({})

    const success = await buildAndSendDeploy(magniPackageHashHex, 'repay_all', args, setRepayTx, 'Repay All')
    if (success) {
      // Refresh from contract events to get authoritative state
      void reloadVaultState()
      void refreshCsprBalance()
    }
  }, [activeKey, magniPackageHashHex, buildAndSendDeploy, refreshCsprBalance, reloadVaultState])

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
                  onClick={() => void reloadVaultState()}
                  disabled={!isConnected || !contractsConfigured || isLoadingVault}
                >
                  {isLoadingVault ? 'Loading...' : 'Refresh Vault'}
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
                <div className="no-position">
                  <p>No vault. Deposit CSPR to create one.</p>
                </div>
              )}
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h2 style={{ margin: 0 }}>Activity</h2>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => void refreshActivity()}
                  disabled={!isConnected || isRefreshingActivity}
                  title={!isConnected ? 'Connect wallet to refresh activity.' : undefined}
                >
                  {isRefreshingActivity ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {!isConnected ? (
                <p className="no-position">Connect your wallet to see activity.</p>
              ) : activityItems.length === 0 ? (
                <p className="no-position">No transactions yet.</p>
              ) : (
                <div className="tx-list">
                  {activityItems.map((item) => (
                    <div key={item.hash} className="tx-list-row">
                      <div className="tx-list-left">
                        <span className="tx-pill">{item.label}</span>
                        <span className="tx-list-status" title={item.error}>
                          {item.status}{item.timestamp ? ` · ${new Date(item.timestamp).toLocaleString()}` : ''}
                        </span>
                      </div>
                      <a
                        href={`${TESTNET_EXPLORER}/deploy/${item.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tx-list-link"
                      >
                        {truncateHash(item.hash)}
                      </a>
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
                  onClick={() => void reloadVaultState()}
                  disabled={!isConnected || !contractsConfigured || isLoadingVault}
                >
                  {isLoadingVault ? 'Loading...' : 'Refresh Vault'}
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
                <div className="input-row">
                  <input
                    type="text"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder={`Min ${MIN_DEPOSIT_CSPR.toString()} CSPR`}
                    disabled={!isConnected || !contractsConfigured || !proxyCallerWasmBytes || isAnyTxPending}
                  />
                  <button
                    type="button"
                    className="btn-max"
                    onClick={() => setDepositAmount(formatCSPR(csprAvailableMotes > ONE_CSPR ? csprAvailableMotes - ONE_CSPR : 0n))}
                    disabled={!isConnected || csprAvailableMotes === 0n || isAnyTxPending}
                    title="Leave 1 CSPR for gas"
                  >
                    Max
                  </button>
                  <span className="input-unit">CSPR</span>
                </div>
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
                className="btn btn-primary btn-action"
                disabled={!isConnected || !contractsConfigured || !proxyCallerWasmBytes || isAnyTxPending || parseCSPR(depositAmount) < MIN_DEPOSIT_MOTES}
              >
                Deposit {depositAmount || '0'} CSPR
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
                <div className="input-row">
                  <input
                    type="text"
                    value={borrowAmount}
                    onChange={(e) => setBorrowAmount(e.target.value)}
                    placeholder="Amount in mCSPR"
                    disabled={!isConnected || !contractsConfigured || vaultStatus !== VaultStatus.Active || isAnyTxPending}
                  />
                  <button
                    type="button"
                    className="btn-max"
                    onClick={() => setBorrowAmount(formatWad(availableToBorrow))}
                    disabled={!isConnected || availableToBorrow === 0n || isAnyTxPending}
                  >
                    Max
                  </button>
                  <span className="input-unit">mCSPR</span>
                </div>
              </div>
              <button
                onClick={handleBorrow}
                className="btn btn-primary btn-action"
                disabled={!isConnected || !contractsConfigured || vaultStatus !== VaultStatus.Active || isAnyTxPending || parseCSPR(borrowAmount) === 0n}
              >
                Borrow {borrowAmount || '0'} mCSPR
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
                <div className="input-row">
                  <input
                    type="text"
                    value={repayAmount}
                    onChange={(e) => setRepayAmount(e.target.value)}
                    placeholder="Amount in mCSPR"
                    disabled={!isConnected || !contractsConfigured || debtWad === 0n || isAnyTxPending}
                  />
                  <button
                    type="button"
                    className="btn-max"
                    onClick={() => setRepayAmount(formatWad(debtWad))}
                    disabled={!isConnected || debtWad === 0n || isAnyTxPending}
                  >
                    Max
                  </button>
                  <span className="input-unit">mCSPR</span>
                </div>
              </div>
              <div className="btn-group">
                <button
                  onClick={handleApprove}
                  className="btn btn-secondary"
                  disabled={!isConnected || !contractsConfigured || debtWad === 0n || isAnyTxPending || parseCSPR(repayAmount) === 0n}
                >
                  1. Approve
                </button>
                <button
                  onClick={handleRepay}
                  className="btn btn-primary"
                  disabled={!isConnected || !contractsConfigured || debtWad === 0n || isAnyTxPending || parseCSPR(repayAmount) === 0n}
                >
                  2. Repay {repayAmount || '0'} mCSPR
                </button>
              </div>
              {(approveTx.status !== 'idle' || repayTx.status !== 'idle') && (
                <div className="tx-status-row">
                  {renderTxStatus(approveTx, 'Approve')}
                  {renderTxStatus(repayTx, 'Repay')}
                </div>
              )}
              <div className="divider" />
              <p className="hint">Or repay all debt (interest calculated on-chain):</p>
              <div className="btn-group">
                <button
                  onClick={handleApproveAll}
                  className="btn btn-secondary"
                  disabled={!isConnected || !contractsConfigured || debtWad === 0n || isAnyTxPending}
                  title="Approve debt + 1% buffer for interest"
                >
                  1. Approve All
                </button>
                <button
                  onClick={handleRepayAll}
                  className="btn btn-primary"
                  disabled={!isConnected || !contractsConfigured || debtWad === 0n || isAnyTxPending}
                  title="Repay all debt including accrued interest (calculated on-chain)"
                >
                  2. Repay All
                </button>
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
                    className="btn btn-primary btn-action"
                    disabled={!isConnected || isAnyTxPending}
                  >
                    Finalize Withdraw
                  </button>
                  {renderTxStatus(finalizeTx, 'Finalize')}
                </>
              ) : (
                <>
                  <div className="input-group">
                    <div className="input-row">
                      <input
                        type="text"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder="Amount in CSPR"
                        disabled={!isConnected || !contractsConfigured || vaultStatus !== VaultStatus.Active || isAnyTxPending}
                      />
                      <button
                        type="button"
                        className="btn-max"
                        onClick={() => setWithdrawAmount(formatCSPR(maxWithdrawMotes))}
                        disabled={!isConnected || maxWithdrawMotes === 0n || isAnyTxPending}
                      >
                        Max
                      </button>
                      <span className="input-unit">CSPR</span>
                    </div>
                  </div>
                  <div className="btn-group">
                    <button
                      onClick={handleRequestWithdraw}
                      className="btn btn-primary"
                      disabled={!isConnected || !contractsConfigured || vaultStatus !== VaultStatus.Active || isAnyTxPending || parseCSPR(withdrawAmount) === 0n}
                    >
                      Withdraw {withdrawAmount || '0'} CSPR
                    </button>
                    <button
                      onClick={handleWithdrawMax}
                      className="btn btn-secondary"
                      disabled={!isConnected || !contractsConfigured || vaultStatus !== VaultStatus.Active || isAnyTxPending || maxWithdrawMotes === 0n}
                      title="Withdraw maximum while keeping LTV valid (calculated on-chain)"
                    >
                      Withdraw Max
                    </button>
                  </div>
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
                <div className="balance-display">
                  <span>Collateral (Locked)</span>
                  <strong title={collateralMotes.toString()}>{formatCSPR(collateralMotes)} CSPR</strong>
                </div>
                <div className="balance-display">
                  <span>mCSPR Balance</span>
                  <strong title={mCSPRBalance.toString()}>{formatWad(mCSPRBalance)} mCSPR</strong>
                </div>
                {mcsprBalanceError && <p className="error">{mcsprBalanceError}</p>}
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
                  <li>
                    <span className="contract-label">mCSPR</span>
                    <code>{truncateHash(mcsprPackageHashHex || MCSPR_HASH)}</code>
                    <a
                      href={`https://testnet.cspr.live/contract-package/${mcsprPackageHashHex}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-btn"
                      title="View on Explorer"
                    >
                      ↗
                    </a>
                  </li>
                  <li>
                    <span className="contract-label">Magni</span>
                    <code>{truncateHash(magniPackageHashHex || MAGNI_HASH)}</code>
                    <a
                      href={`https://testnet.cspr.live/contract-package/${magniPackageHashHex}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-btn"
                      title="View on Explorer"
                    >
                      ↗
                    </a>
                  </li>
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
              {mcsprBalanceError && <p className="error">{mcsprBalanceError}</p>}

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
                <div className="no-position">
                  <p>No vault. Deposit CSPR to create one.</p>
                </div>
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
