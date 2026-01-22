import { useState, useCallback } from 'react'

const DEMO_KEY = 'magni-demo-mode'

// Mock data for demo mode
export const DEMO_DATA = {
  // Mock wallet
  activeKey: '017d96b9a63abcb61c870a4f55187a0a7ac24096bdb5fc585c12a686a4d892009e',
  accountHash: '4f3c4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f',

  // Mock balances (in smallest unit)
  csprTotalMotes: 50000n * 10n ** 9n, // 50,000 CSPR
  csprAvailableMotes: 45000n * 10n ** 9n, // 45,000 CSPR available
  csprHeldMotes: 5000n * 10n ** 9n, // 5,000 CSPR held

  // Mock vault state
  collateralMotes: 10000n * 10n ** 9n, // 10,000 CSPR collateral
  debtWad: 5000n * 10n ** 18n, // 5,000 mCSPR debt
  mCSPRBalance: 5000n * 10n ** 18n, // 5,000 mCSPR
  ltvBps: 5000n, // 50% LTV
  pendingWithdrawMotes: 0n,

  // Mock activity
  activityItems: [
    {
      label: 'Deposit',
      hash: 'demo-deposit-001',
      status: 'success' as const,
      timestamp: Date.now() - 3600000, // 1 hour ago
    },
    {
      label: 'Borrow',
      hash: 'demo-borrow-001',
      status: 'success' as const,
      timestamp: Date.now() - 1800000, // 30 mins ago
    },
  ],
}

export function useDemo() {
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(DEMO_KEY) === 'true'
  })

  const enableDemo = useCallback(() => {
    setIsDemoMode(true)
    localStorage.setItem(DEMO_KEY, 'true')
  }, [])

  const disableDemo = useCallback(() => {
    setIsDemoMode(false)
    localStorage.removeItem(DEMO_KEY)
  }, [])

  const toggleDemo = useCallback(() => {
    if (isDemoMode) {
      disableDemo()
    } else {
      enableDemo()
    }
  }, [isDemoMode, enableDemo, disableDemo])

  return {
    isDemoMode,
    enableDemo,
    disableDemo,
    toggleDemo,
    demoData: DEMO_DATA,
  }
}

export default useDemo
