export const MOTES_DECIMALS = 9
export const WAD_DECIMALS = 18
export const ONE_CSPR = 10n ** BigInt(MOTES_DECIMALS) // 1e9 motes
export const ONE_WAD = 10n ** BigInt(WAD_DECIMALS)     // 1e18 wad
export const MOTES_TO_WAD = 10n ** 9n                  // conversion factor

export const DECIMAL_INPUT_REGEX = /^\d*(?:\.\d*)?$/

export function normalizeDecimalInput(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''
  let cleaned = trimmed.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
  }
  if (cleaned.startsWith('.')) return `0${cleaned}`
  return cleaned
}

export function formatCSPR(motes: bigint): string {
  const whole = motes / ONE_CSPR
  const frac = motes % ONE_CSPR
  const fracStr = frac.toString().padStart(MOTES_DECIMALS, '0').slice(0, 4)
  return `${whole}.${fracStr}`
}

export function formatWad(wad: bigint): string {
  const whole = wad / ONE_WAD
  const frac = wad % ONE_WAD
  const fracStr = frac.toString().padStart(WAD_DECIMALS, '0').slice(0, 4)
  return `${whole}.${fracStr}`
}

export function parseCSPR(input: string): bigint {
  const normalized = input.trim()
  if (normalized === '') return 0n
  if (!DECIMAL_INPUT_REGEX.test(normalized)) return 0n
  const parts = normalized.split('.')
  const whole = parts[0] ? BigInt(parts[0]) : 0n
  let frac = 0n
  if (parts[1] && parts[1].length > 0) {
    const fracPart = parts[1].slice(0, MOTES_DECIMALS).padEnd(MOTES_DECIMALS, '0')
    if (fracPart) frac = BigInt(fracPart)
  }
  return whole * ONE_CSPR + frac
}

export function csprToWad(motes: bigint): bigint {
  return motes * MOTES_TO_WAD
}

export function wadToMotes(wad: bigint): bigint {
  return wad / MOTES_TO_WAD
}
