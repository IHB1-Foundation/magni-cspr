import { describe, expect, it } from 'vitest'
import {
  ONE_CSPR,
  csprToWad,
  formatCSPR,
  normalizeDecimalInput,
  parseCSPR,
  wadToMotes,
} from './amounts'

describe('normalizeDecimalInput', () => {
  it('strips invalid characters and extra dots', () => {
    expect(normalizeDecimalInput('1..2')).toBe('1.2')
    expect(normalizeDecimalInput('1.2.3')).toBe('1.23')
    expect(normalizeDecimalInput('ab12.3cd')).toBe('12.3')
  })

  it('handles leading dots and whitespace', () => {
    expect(normalizeDecimalInput('.5')).toBe('0.5')
    expect(normalizeDecimalInput('  12.34  ')).toBe('12.34')
    expect(normalizeDecimalInput('')).toBe('')
  })
})

describe('parseCSPR', () => {
  it('parses whole and fractional amounts', () => {
    expect(parseCSPR('1')).toBe(ONE_CSPR)
    expect(parseCSPR('0.5')).toBe(500_000_000n)
    expect(parseCSPR('1.000000001')).toBe(1_000_000_001n)
  })

  it('trims to 9 decimals', () => {
    expect(parseCSPR('1.0000000012')).toBe(1_000_000_001n)
  })

  it('returns zero on invalid input', () => {
    expect(parseCSPR('')).toBe(0n)
    expect(parseCSPR('1a')).toBe(0n)
  })
})

describe('csprToWad / wadToMotes', () => {
  it('round-trips 1 CSPR', () => {
    const wad = csprToWad(ONE_CSPR)
    expect(wadToMotes(wad)).toBe(ONE_CSPR)
  })

  it('formats amounts consistently', () => {
    expect(formatCSPR(ONE_CSPR)).toBe('1.0000')
  })
})
