import { useState, useEffect, useCallback } from 'react'
import {
  CasperClient,
  CLPublicKey,
  CLValueBuilder,
  DeployUtil,
  RuntimeArgs,
} from 'casper-js-sdk'
import { Buffer } from 'buffer'
import { blake2b } from 'blakejs'
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

// Contract event URefs are now fetched dynamically from contract named keys

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

// Activity tracking (localStorage for activity history only)
const ACTIVITY_STATE_KEY_PREFIX = 'magni_activity_v1'
const ACTIVITY_MAX_ITEMS = 50

// Log contract hashes on startup for debugging
console.log('='.repeat(60))
console.log('[STARTUP] Contract Configuration:')
console.log('[STARTUP] MAGNI_HASH from config:', MAGNI_HASH)
console.log('[STARTUP] MCSPR_HASH from config:', MCSPR_HASH)
console.log('='.repeat(60))

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

// Compute Odra dictionary key for Var<T> (simple value, no mapping key)
// The dictionary_item_key is: hex(blake2b(index_u32_be))
function computeOdraVarKey(fieldIndex: number): string {
  // Index as 4 bytes big endian
  const indexBytes = new Uint8Array(4)
  indexBytes[0] = (fieldIndex >> 24) & 0xff
  indexBytes[1] = (fieldIndex >> 16) & 0xff
  indexBytes[2] = (fieldIndex >> 8) & 0xff
  indexBytes[3] = fieldIndex & 0xff

  // Blake2b hash (32 bytes)
  const hashedKey = blake2b(indexBytes, undefined, 32)

  return bytesToHex(hashedKey)
}

// Compute Odra dictionary key for Mapping<Address, V>
// Odra stores all Mappings in a single "state" dictionary.
// The dictionary_item_key is: hex(blake2b(index_u32_be + serialized_address))
// - index: field position in the module struct (0-indexed), as u32 big endian
// - serialized_address: Odra Address encoding = 1 byte tag (0=Account, 1=Contract) + 32 bytes hash
function computeOdraMappingKey(fieldIndex: number, accountHashHex: string): string {
  // Index as 4 bytes big endian
  const indexBytes = new Uint8Array(4)
  indexBytes[0] = (fieldIndex >> 24) & 0xff
  indexBytes[1] = (fieldIndex >> 16) & 0xff
  indexBytes[2] = (fieldIndex >> 8) & 0xff
  indexBytes[3] = fieldIndex & 0xff

  // Address serialization: tag (0 for AccountHash) + 32 bytes hash
  const addressTag = new Uint8Array([0x00]) // AccountHash tag
  const hashBytes = hexToBytes(accountHashHex)

  // Concatenate: index + tag + hash
  const keyData = new Uint8Array(4 + 1 + 32)
  keyData.set(indexBytes, 0)
  keyData.set(addressTag, 4)
  keyData.set(hashBytes, 5)

  // Blake2b hash (32 bytes)
  const hashedKey = blake2b(keyData, undefined, 32)

  return bytesToHex(hashedKey)
}

// Field indices for Magni contract Mappings (based on struct field order)
// IMPORTANT: Odra module indices start from 1, not 0! (verified via RPC testing)
// See: casper/magni_casper/src/magni.rs - Magni struct
const ODRA_FIELD_INDEX_MAGNI = {
  MCSPR: 1,            // mcspr: Var<Address>
  VALIDATOR_KEY: 2,    // validator_public_key: Var<String>
  COLLATERAL: 3,       // collateral: Mapping<Address, U512>
  DEBT_PRINCIPAL: 4,   // debt_principal: Mapping<Address, U256>
  LAST_ACCRUAL_TS: 5,  // last_accrual_ts: Mapping<Address, u64>
  VAULT_STATUS: 6,     // vault_status: Mapping<Address, VaultStatus>
  PENDING_WITHDRAW: 7, // pending_withdraw: Mapping<Address, U512>
} as const

// Field indices for MCSPRToken contract fields
// IMPORTANT: Odra module indices start from 1, not 0!
// See: casper/magni_casper/src/tokens.rs - MCSPRToken struct
const ODRA_FIELD_INDEX_MCSPR = {
  NAME: 1,             // name: Var<String>
  SYMBOL: 2,           // symbol: Var<String>
  DECIMALS: 3,         // decimals: Var<u8>
  TOTAL_SUPPLY: 4,     // total_supply: Var<U256>
  BALANCES: 5,         // balances: Mapping<Address, U256>
  ALLOWANCES: 6,       // allowances: Mapping<(Address, Address), U256>
  MINTER: 7,           // minter: Var<Address>
} as const

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

// Deploy/Transaction status check result (Casper 2.0 compatible)
interface ExecutionResultV1 {
  Success?: unknown
  Failure?: { error_message?: string }
}

interface ExecutionResultV2 {
  Version2?: {
    error_message?: string | null
    // success if no error_message
  }
}

// Casper 1.x format
interface DeployInfoResult {
  deploy: unknown
  execution_results?: Array<{
    result: ExecutionResultV1
  }>
}

// Casper 2.0 format
interface TransactionInfoResult {
  transaction?: unknown
  execution_info?: {
    execution_result?: ExecutionResultV1 | ExecutionResultV2
  }
}

// Parse execution result from either format
function parseExecutionSuccess(result: unknown): { decided: boolean; success: boolean; errorMessage?: string } {
  if (!result) return { decided: false, success: false }

  const r = result as Record<string, unknown>

  // Casper 2.0 Version2 format
  if (r.Version2) {
    const v2 = r.Version2 as Record<string, unknown>
    if (v2.error_message) {
      return { decided: true, success: false, errorMessage: String(v2.error_message) }
    }
    return { decided: true, success: true }
  }

  // Casper 1.x format
  if (r.Success !== undefined) {
    return { decided: true, success: true }
  }
  if (r.Failure) {
    const failure = r.Failure as Record<string, unknown>
    return { decided: true, success: false, errorMessage: String(failure.error_message || 'Execution failed') }
  }

  return { decided: false, success: false }
}

async function fetchDeployActivityStatus(deployHash: string): Promise<{ status: ActivityStatus; error?: string }> {
  // Try Casper 2.0 API first (info_get_transaction)
  try {
    const txResult = await jsonRpc<TransactionInfoResult>('info_get_transaction', {
      transaction_hash: { Deploy: deployHash },
      finalized_approvals: false,
    })

    if (txResult.execution_info?.execution_result) {
      const parsed = parseExecutionSuccess(txResult.execution_info.execution_result)
      if (parsed.decided) {
        return parsed.success
          ? { status: 'success' }
          : { status: 'error', error: parsed.errorMessage }
      }
    }
  } catch {
    // Fall through to legacy API
  }

  // Fallback to Casper 1.x API (info_get_deploy)
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

// Wait for deploy confirmation using jsonRpc directly (Casper 2.0 compatible)
async function waitForDeployConfirmation(
  deployHash: string,
  maxAttempts = 90,
  intervalMs = 2000
): Promise<{ success: boolean; errorMessage?: string }> {
  console.log(`[waitForDeployConfirmation] Waiting for ${deployHash}`)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Try Casper 2.0 API first (info_get_transaction)
    try {
      const txResult = await jsonRpc<TransactionInfoResult>('info_get_transaction', {
        transaction_hash: { Deploy: deployHash },
        finalized_approvals: false,
      })

      console.log(`[waitForDeployConfirmation] attempt ${attempt + 1} (v2):`, JSON.stringify(txResult.execution_info?.execution_result))

      if (txResult.execution_info?.execution_result) {
        const parsed = parseExecutionSuccess(txResult.execution_info.execution_result)
        if (parsed.decided) {
          console.log(`[waitForDeployConfirmation] Result:`, parsed)
          return { success: parsed.success, errorMessage: parsed.errorMessage }
        }
      }
    } catch {
      // Try legacy API
      try {
        const result = await jsonRpc<DeployInfoResult>('info_get_deploy', { deploy_hash: deployHash })

        console.log(`[waitForDeployConfirmation] attempt ${attempt + 1} (v1):`, JSON.stringify(result.execution_results?.[0]?.result))

        if (result.execution_results && result.execution_results.length > 0) {
          const execResult = result.execution_results[0].result
          if (execResult.Success !== undefined) {
            console.log(`[waitForDeployConfirmation] Success (v1)`)
            return { success: true }
          } else if (execResult.Failure) {
            console.log(`[waitForDeployConfirmation] Failure (v1):`, execResult.Failure)
            return {
              success: false,
              errorMessage: execResult.Failure.error_message || 'Execution failed',
            }
          }
        }
      } catch (err) {
        console.debug(`[waitForDeployConfirmation] attempt ${attempt + 1}: ${err}`)
      }
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

// Old hardcoded URef functions removed - now using getEventsLengthForEntity and getEventAtIndexForEntity

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
    // Casper 2.0: entity-contract-<hash> or AddressableEntity
    const entityMatch = text.match(/entity-contract-[0-9a-f]{64}/i)
    if (entityMatch) return extractFirstHex32(entityMatch[0])
    // Casper 1.x/2.0: contract-<hash> (NOT contract-hash-)
    const contractMatch = text.match(/"contract-([0-9a-f]{64})"/i)
    if (contractMatch) return contractMatch[1].toLowerCase()
    // Fallback: any 64-char hex after "contract_hash"
    const hashMatch = text.match(/"contract_hash":\s*"[^"]*?([0-9a-f]{64})"/i)
    if (hashMatch) return hashMatch[1].toLowerCase()
    return null
  } catch {
    return null
  }
}

async function resolveEntityHashHexFromContractPackageHash(contractPackageHashHex: string): Promise<string> {
  try {
    console.log('[resolveEntityHash] Querying for package hash:', contractPackageHashHex)
    const result = await jsonRpc<{ stored_value?: unknown }>('query_global_state', {
      state_identifier: null,
      key: `hash-${contractPackageHashHex}`,
      path: [],
    })
    console.log('[resolveEntityHash] Result:', JSON.stringify(result, null, 2).slice(0, 500))
    const extracted = extractEntityHashHexFromStoredValue(result.stored_value)
    console.log('[resolveEntityHash] Extracted entity hash:', extracted)
    return extracted || contractPackageHashHex
  } catch (err) {
    console.error('[resolveEntityHash] Error:', err)
    return contractPackageHashHex
  }
}

// Query Magni contract state directly (collateral, debt for a user)
// Odra stores all Mappings in a single "state" dictionary with blake2b-hashed keys.
// The key is computed as: hex(blake2b(field_index_u32_be + serialized_address))
async function fetchMagniPositionDirect(
  magniPackageHashHex: string,
  userAccountHashHex: string
): Promise<{ collateralMotes: bigint; debtWad: bigint } | null> {
  try {
    const entityHashHex = await resolveEntityHashHexFromContractPackageHash(magniPackageHashHex)
    console.log('[fetchMagniPosition] Package hash:', magniPackageHashHex)
    console.log('[fetchMagniPosition] Entity hash:', entityHashHex)

    const stateRootHash = await getStateRootHash()
    console.log('[fetchMagniPosition] State root:', stateRootHash)
    console.log('[fetchMagniPosition] User account hash:', userAccountHashHex)

    // Compute Odra dictionary keys for collateral and debt Mappings
    const collateralKey = computeOdraMappingKey(ODRA_FIELD_INDEX_MAGNI.COLLATERAL, userAccountHashHex)
    const debtKey = computeOdraMappingKey(ODRA_FIELD_INDEX_MAGNI.DEBT_PRINCIPAL, userAccountHashHex)
    console.log('[fetchMagniPosition] Collateral key (hashed):', collateralKey)
    console.log('[fetchMagniPosition] Debt key (hashed):', debtKey)

    let collateralMotes = 0n
    let debtWad = 0n

    // Query collateral from "state" dictionary (Mapping<Address, U512>)
    const collResult = await queryDictionaryItem(stateRootHash, entityHashHex, 'state', collateralKey)
    if (collResult?.stored_value?.CLValue) {
      console.log('[fetchMagniPosition] Collateral result:', JSON.stringify(collResult, null, 2))
      const parsed = collResult.stored_value.CLValue.parsed
      // Odra stores values as Vec<u8> (List U8), so parsed is an array of bytes
      if (Array.isArray(parsed)) {
        // Convert array to Uint8Array and parse as U512
        const bytes = new Uint8Array(parsed)
        const { value } = parseU512(bytes, 0)
        collateralMotes = value
        console.log('[fetchMagniPosition] Parsed collateral from array:', collateralMotes.toString())
      } else if (parsed !== null && parsed !== undefined) {
        // Direct numeric value (shouldn't happen with Odra, but fallback)
        collateralMotes = BigInt(String(parsed))
      } else {
        // Parse from raw bytes (includes Vec length prefix)
        const bytesHex = collResult.stored_value.CLValue.bytes
        if (bytesHex) {
          const bytes = hexToBytes(bytesHex)
          // Skip 4-byte Vec<u8> length prefix
          const { value } = parseU512(bytes, 4)
          collateralMotes = value
        }
      }
    } else {
      console.log('[fetchMagniPosition] No collateral found for user')
    }

    // Query debt_principal from "state" dictionary (Mapping<Address, U256>)
    const debtResult = await queryDictionaryItem(stateRootHash, entityHashHex, 'state', debtKey)
    if (debtResult?.stored_value?.CLValue) {
      console.log('[fetchMagniPosition] Debt result:', JSON.stringify(debtResult, null, 2))
      const parsed = debtResult.stored_value.CLValue.parsed
      // Odra stores values as Vec<u8> (List U8), so parsed is an array of bytes
      if (Array.isArray(parsed)) {
        // Convert array to Uint8Array and parse as U256
        const bytes = new Uint8Array(parsed)
        const { value } = parseU256(bytes, 0)
        debtWad = value
        console.log('[fetchMagniPosition] Parsed debt from array:', debtWad.toString())
      } else if (parsed !== null && parsed !== undefined) {
        // Direct numeric value (shouldn't happen with Odra, but fallback)
        debtWad = BigInt(String(parsed))
      } else {
        // Parse from raw bytes (includes Vec length prefix)
        const bytesHex = debtResult.stored_value.CLValue.bytes
        if (bytesHex) {
          const bytes = hexToBytes(bytesHex)
          // Skip 4-byte Vec<u8> length prefix
          const { value } = parseU256(bytes, 4)
          debtWad = value
        }
      }
    } else {
      console.log('[fetchMagniPosition] No debt found for user')
    }

    console.log('[fetchMagniPosition] Final:', { collateralMotes: collateralMotes.toString(), debtWad: debtWad.toString() })
    return { collateralMotes, debtWad }
  } catch (err) {
    console.error('[fetchMagniPosition] Error:', err)
    return null
  }
}

// Extract named_keys from stored_value (handles both Casper 1.x Contract and 2.0 AddressableEntity)
function extractNamedKeys(storedValue: unknown): Array<{ name: string; key: string }> | null {
  if (!storedValue || typeof storedValue !== 'object') return null
  const sv = storedValue as Record<string, unknown>

  // Casper 1.x: Contract.named_keys
  if (sv.Contract && typeof sv.Contract === 'object') {
    const contract = sv.Contract as Record<string, unknown>
    if (Array.isArray(contract.named_keys)) return contract.named_keys as Array<{ name: string; key: string }>
  }

  // Casper 2.0: AddressableEntity.named_keys
  if (sv.AddressableEntity && typeof sv.AddressableEntity === 'object') {
    const entity = sv.AddressableEntity as Record<string, unknown>
    if (Array.isArray(entity.named_keys)) return entity.named_keys as Array<{ name: string; key: string }>
  }

  // Try finding named_keys at any level by stringifying
  try {
    const text = JSON.stringify(storedValue)
    console.log('[extractNamedKeys] stored_value structure:', text.slice(0, 500))
  } catch {}

  return null
}

async function getEventsLengthForEntity(entityHashHex: string): Promise<number> {
  try {
    console.log('[getEventsLength] Querying entity hash:', entityHashHex)

    // First get the contract's named keys to find __events_length URef
    const contractResult = await jsonRpc<{ stored_value?: unknown }>('query_global_state', {
      state_identifier: null,
      key: `hash-${entityHashHex}`,
      path: [],
    })

    console.log('[getEventsLength] Query result:', JSON.stringify(contractResult, null, 2).slice(0, 800))

    const namedKeys = extractNamedKeys(contractResult.stored_value)
    if (!namedKeys) {
      console.log('[getEventsLength] No named_keys found')
      return 0
    }

    console.log('[getEventsLength] Named keys:', namedKeys.map(nk => nk.name).join(', '))

    const eventsLengthKey = namedKeys.find(nk => nk.name === '__events_length')
    if (!eventsLengthKey) {
      console.log('[getEventsLength] No __events_length key found')
      return 0
    }

    console.log('[getEventsLength] Events length URef:', eventsLengthKey.key)

    // Query the URef directly
    const result = await jsonRpc<{
      stored_value?: { CLValue?: { parsed?: unknown } }
    }>('query_global_state', {
      state_identifier: null,
      key: eventsLengthKey.key,
      path: [],
    })
    const parsed = result.stored_value?.CLValue?.parsed
    console.log('[getEventsLength] Events length parsed:', parsed)
    if (typeof parsed === 'number') return parsed
    if (typeof parsed === 'string') return Number(parsed) || 0
    return 0
  } catch (err) {
    console.error('[getEventsLength] Error:', err)
    return 0
  }
}

// Helper to query dictionary item with both ContractNamedKey and EntityNamedKey formats
async function queryDictionaryItem(
  stateRootHash: string,
  entityHashHex: string,
  dictionaryName: string,
  itemKey: string
): Promise<{ stored_value?: { CLValue?: { bytes?: string; parsed?: unknown } } } | null> {
  // Try ContractNamedKey first (Casper 1.x style)
  try {
    const result = await jsonRpc<{
      stored_value?: { CLValue?: { bytes?: string; parsed?: unknown } }
    }>('state_get_dictionary_item', {
      state_root_hash: stateRootHash,
      dictionary_identifier: {
        ContractNamedKey: {
          key: `hash-${entityHashHex}`,
          dictionary_name: dictionaryName,
          dictionary_item_key: itemKey,
        },
      },
    })
    if (result.stored_value?.CLValue) {
      console.log(`[queryDictionary] Success with ContractNamedKey for ${dictionaryName}[${itemKey}]`)
      return result
    }
  } catch (e) {
    console.log(`[queryDictionary] ContractNamedKey failed for ${dictionaryName}[${itemKey}]:`, e)
  }

  // Try EntityNamedKey (Casper 2.0 style)
  try {
    const result = await jsonRpc<{
      stored_value?: { CLValue?: { bytes?: string; parsed?: unknown } }
    }>('state_get_dictionary_item', {
      state_root_hash: stateRootHash,
      dictionary_identifier: {
        EntityNamedKey: {
          key: `entity-contract-${entityHashHex}`,
          dictionary_name: dictionaryName,
          dictionary_item_key: itemKey,
        },
      },
    })
    if (result.stored_value?.CLValue) {
      console.log(`[queryDictionary] Success with EntityNamedKey for ${dictionaryName}[${itemKey}]`)
      return result
    }
  } catch (e) {
    console.log(`[queryDictionary] EntityNamedKey failed for ${dictionaryName}[${itemKey}]:`, e)
  }

  return null
}

async function getEventAtIndexForEntity(
  stateRootHash: string,
  entityHashHex: string,
  index: number
): Promise<Uint8Array | null> {
  try {
    const result = await queryDictionaryItem(stateRootHash, entityHashHex, '__events', index.toString())
    const bytesHex = result?.stored_value?.CLValue?.bytes
    if (!bytesHex) return null
    // Skip the first 4 bytes (length prefix of the List<u8>)
    const eventBytesHex = bytesHex.slice(8)
    return hexToBytes(eventBytesHex)
  } catch {
    return null
  }
}

// Fetch mCSPR balance by querying the state dictionary directly
// Odra stores all Mappings in a single "state" dictionary with blake2b-hashed keys.
async function fetchMcsprBalanceFromContract(
  tokenPackageHashHex: string,
  userAccountHashHex: string
): Promise<bigint> {
  try {
    // Get entity hash from package hash
    const entityHashHex = await resolveEntityHashHexFromContractPackageHash(tokenPackageHashHex)
    console.log('[fetchMcsprBalance] Entity hash:', entityHashHex)
    console.log('[fetchMcsprBalance] User account hash:', userAccountHashHex)

    const stateRootHash = await getStateRootHash()

    // Compute Odra dictionary key for balances Mapping (index 4 in MCSPRToken)
    const balanceKey = computeOdraMappingKey(ODRA_FIELD_INDEX_MCSPR.BALANCES, userAccountHashHex)
    console.log('[fetchMcsprBalance] Balance key (hashed):', balanceKey)

    const result = await queryDictionaryItem(stateRootHash, entityHashHex, 'state', balanceKey)

    if (result?.stored_value?.CLValue) {
      console.log('[fetchMcsprBalance] Result:', JSON.stringify(result, null, 2))

      // Parse U256 from CLValue
      const parsed = result.stored_value.CLValue.parsed
      // Odra stores values as Vec<u8> (List U8), so parsed is an array of bytes
      if (Array.isArray(parsed)) {
        // Convert array to Uint8Array and parse as U256
        const bytes = new Uint8Array(parsed)
        const { value } = parseU256(bytes, 0)
        console.log('[fetchMcsprBalance] Found balance from array:', value.toString())
        return value
      } else if (parsed !== undefined && parsed !== null) {
        // Direct numeric value (shouldn't happen with Odra, but fallback)
        const value = BigInt(String(parsed))
        console.log('[fetchMcsprBalance] Found balance:', value.toString())
        return value
      }

      // Try parsing from bytes if parsed is not available
      const bytesHex = result.stored_value.CLValue.bytes
      if (bytesHex) {
        const bytes = hexToBytes(bytesHex)
        // Skip 4-byte Vec<u8> length prefix
        const { value } = parseU256(bytes, 4)
        console.log('[fetchMcsprBalance] Found balance from bytes:', value.toString())
        return value
      }
    }

    console.log('[fetchMcsprBalance] No balance found')
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

// Fetch vault state from contract events (dynamic - uses contract's named keys)
async function fetchVaultStateFromEvents(
  userAccountHashHex: string,
  magniPackageHashHex: string
): Promise<VaultStateFromEvents | null> {
  console.log('[fetchVaultStateFromEvents] Fetching for user:', userAccountHashHex)
  console.log('[fetchVaultStateFromEvents] Magni package hash:', magniPackageHashHex)

  try {
    // Get entity hash from package hash
    const entityHashHex = await resolveEntityHashHexFromContractPackageHash(magniPackageHashHex)
    console.log('[fetchVaultStateFromEvents] Entity hash:', entityHashHex)

    // Get events length dynamically from contract's named keys
    const eventsLength = await getEventsLengthForEntity(entityHashHex)
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
      const eventBytes = await getEventAtIndexForEntity(stateRootHash, entityHashHex, i)
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

  // Reload vault state from contract (direct query or events)
  // NO localStorage - always fetch fresh from chain
  const reloadVaultState = useCallback(async () => {
    if (!activeKey) return

    setIsLoadingVault(true)
    console.log('='.repeat(50))
    console.log('[reloadVaultState] Starting fetch')
    console.log('[reloadVaultState] Active key:', activeKey)
    console.log('[reloadVaultState] Magni package hash:', magniPackageHashHex)
    console.log('[reloadVaultState] mCSPR package hash:', mcsprPackageHashHex)

    try {
      // Compute account hash from public key
      const accountHash = computeAccountHash(activeKey)
      console.log('[reloadVaultState] Account hash:', accountHash)

      // Try direct contract state query first (most reliable)
      if (accountHash && magniPackageHashHex) {
        console.log('[reloadVaultState] Fetching direct state from contract...')
        const directState = await fetchMagniPositionDirect(magniPackageHashHex, accountHash)
        if (directState) {
          console.log('[reloadVaultState] Direct state result:', {
            collateralMotes: directState.collateralMotes.toString(),
            debtWad: directState.debtWad.toString()
          })

          // If we got non-zero values from direct query, use them
          if (directState.collateralMotes > 0n || directState.debtWad > 0n) {
            setCollateralMotes(directState.collateralMotes)
            setDebtWad(directState.debtWad)

            // Set vault status based on collateral
            if (directState.collateralMotes > 0n) {
              setVaultStatus(VaultStatus.Active)
            }

            // Calculate LTV
            const collateralWadValue = csprToWad(directState.collateralMotes)
            const ltv = collateralWadValue > 0n
              ? (directState.debtWad * BPS_DIVISOR) / collateralWadValue
              : 0n
            setLtvBps(ltv)

            await refreshMCSPRBalance()
            setIsLoadingVault(false)
            console.log('[reloadVaultState] SUCCESS - vault state loaded from direct query')
            return
          }
        }
      }

      // Try to fetch from contract events as fallback
      if (accountHash && magniPackageHashHex) {
        console.log('[reloadVaultState] Fetching from contract events...')
        const contractState = await fetchVaultStateFromEvents(accountHash, magniPackageHashHex)

        if (contractState && (contractState.collateralMotes > 0n || contractState.debtWad > 0n)) {
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
          console.log('[reloadVaultState] SUCCESS - vault state loaded from events')
          return
        }
      }

      // No vault found - reset to empty state
      console.log('[reloadVaultState] No vault found on chain - resetting to empty state')
      setCollateralMotes(0n)
      setDebtWad(0n)
      setLtvBps(0n)
      setPendingWithdrawMotes(0n)
      setVaultStatus(VaultStatus.None)
      await refreshMCSPRBalance()

    } catch (err) {
      console.error('[reloadVaultState] Error:', err)
      // Reset to empty on error
      setCollateralMotes(0n)
      setDebtWad(0n)
      setLtvBps(0n)
      setPendingWithdrawMotes(0n)
      setVaultStatus(VaultStatus.None)
    } finally {
      setIsLoadingVault(false)
    }
  }, [activeKey, refreshMCSPRBalance, mcsprPackageHashHex, magniPackageHashHex])


  // Load vault state on wallet connect
  useEffect(() => {
    if (!isConnected || !activeKey) return

    void reloadVaultState()
    void refreshMCSPRBalance()
  }, [isConnected, activeKey, reloadVaultState, refreshMCSPRBalance])

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
        // Auto-hide success after 3 seconds
        setTimeout(() => setTxState({ status: 'idle' }), 3000)
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

    console.log('='.repeat(60))
    console.log('[buildAndSendPayableDeploy] BUILDING TRANSACTION')
    console.log('[buildAndSendPayableDeploy] CONTRACT:', contractPackageHashHex)
    console.log('[buildAndSendPayableDeploy] ENTRY POINT:', entryPoint)
    console.log('[buildAndSendPayableDeploy] AMOUNT:', Number(attachedMotes) / 1e9, 'CSPR')
    console.log('='.repeat(60))

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
        // Auto-hide success after 3 seconds
        setTimeout(() => setTxState({ status: 'idle' }), 3000)
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
              {!isConnected ? (
                <div className="connect-prompt">
                  <p>Connect your wallet to view your portfolio.</p>
                  <button type="button" className="btn btn-primary" onClick={connect}>
                    Connect Wallet
                  </button>
                </div>
              ) : (
                <>
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
                    >
                      Refresh Balance
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => void reloadVaultState()}
                      disabled={!contractsConfigured || isLoadingVault}
                    >
                      {isLoadingVault ? 'Loading...' : 'Refresh Vault'}
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className={`card ${vaultStatus !== VaultStatus.None ? 'connected' : ''}`}>
              <h2>Vault Position</h2>

              {!isConnected ? (
                <div className="connect-prompt">
                  <p>Connect your wallet to view your vault.</p>
                </div>
              ) : vaultStatus !== VaultStatus.None ? (
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
                    <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255, 193, 7, 0.15)', border: '1px solid rgba(255, 193, 7, 0.3)', borderRadius: '8px' }}>
                      <strong>⏳ Withdrawal Pending</strong>
                      <div style={{ marginTop: '0.5rem' }}>
                        <span className="label">Amount: </span>
                        <strong>{formatCSPR(pendingWithdrawMotes)} CSPR</strong>
                      </div>
                      <div style={{ marginTop: '0.5rem', fontSize: '0.85em', opacity: 0.8 }}>
                        Go to Deposit tab → Withdraw section to finalize after unbonding.
                      </div>
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
              {!isConnected ? (
                <div className="connect-prompt">
                  <p>Connect your wallet to view balances and vault status.</p>
                  <button type="button" className="btn btn-primary" onClick={connect}>
                    Connect Wallet
                  </button>
                </div>
              ) : (
                <>
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
                    >
                      Refresh Balance
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      onClick={() => void reloadVaultState()}
                      disabled={!contractsConfigured || isLoadingVault}
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
                </>
              )}
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
              <div className="info-box" style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.85em' }}>
                <strong>2-Step Withdrawal Process:</strong>
                <ol style={{ margin: '0.5rem 0 0 1.25rem', padding: 0 }}>
                  <li><strong>Request</strong> - Initiate withdrawal (starts unbonding)</li>
                  <li><strong>Finalize</strong> - Complete after unbonding period (~14h testnet / ~14 days mainnet)</li>
                </ol>
              </div>
              <div className="info-row">
                <span>Max safe withdraw:</span>
                <strong>{formatCSPR(maxWithdrawMotes)} CSPR</strong>
              </div>

              {vaultStatus === VaultStatus.Withdrawing ? (
                <>
                  <div className="warning-box" style={{ background: 'rgba(255, 193, 7, 0.15)', border: '1px solid rgba(255, 193, 7, 0.3)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem' }}>
                    <strong>⏳ Withdrawal Pending</strong>
                    <div style={{ marginTop: '0.5rem' }}>
                      Amount: <strong>{formatCSPR(pendingWithdrawMotes)} CSPR</strong>
                    </div>
                    <div style={{ marginTop: '0.25rem', fontSize: '0.9em', opacity: 0.8 }}>
                      Wait for unbonding period to complete, then click "Finalize Withdraw".
                    </div>
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

              {!isConnected ? (
                <div className="connect-prompt">
                  <p style={{ color: '#888', fontSize: '0.9em' }}>Connect wallet to view vault</p>
                </div>
              ) : (
                <>
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
                        <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'rgba(255, 193, 7, 0.15)', border: '1px solid rgba(255, 193, 7, 0.3)', borderRadius: '6px', fontSize: '0.85em' }}>
                          <strong>⏳ Pending: {formatCSPR(pendingWithdrawMotes)} CSPR</strong>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="no-position">
                      <p>No vault. Deposit CSPR to create one.</p>
                    </div>
                  )}
                </>
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
