import { FC } from 'react'

type StepStatus = 'complete' | 'current' | 'pending' | 'blocked'

interface Step {
  id: string
  label: string
  status: StepStatus
  description?: string
  action?: {
    label: string
    onClick: () => void
    disabled?: boolean
  }
  hint?: string
}

interface OnboardingStepperProps {
  hasWallet: boolean
  isConnected: boolean
  networkMatch: boolean
  contractsConfigured: boolean
  hasVault: boolean
  hasDebt: boolean
  isPendingWithdraw: boolean
  onConnect: () => void
  onInstallWallet: () => void
  onDeposit: () => void
  onEnableDemo?: () => void
}

const OnboardingStepper: FC<OnboardingStepperProps> = ({
  hasWallet,
  isConnected,
  networkMatch,
  contractsConfigured,
  hasVault,
  hasDebt,
  isPendingWithdraw,
  onConnect,
  onInstallWallet,
  onDeposit,
  onEnableDemo,
}) => {
  const getStepStatus = (stepCondition: boolean, prevComplete: boolean): StepStatus => {
    if (stepCondition) return 'complete'
    if (prevComplete) return 'current'
    return 'pending'
  }

  const steps: Step[] = [
    {
      id: 'wallet',
      label: 'Install Casper Wallet',
      status: hasWallet ? 'complete' : 'current',
      description: hasWallet
        ? 'Casper Wallet detected'
        : 'Browser extension required to sign transactions',
      action: hasWallet
        ? undefined
        : { label: 'Get Wallet', onClick: onInstallWallet },
    },
    {
      id: 'connect',
      label: 'Connect Wallet',
      status: getStepStatus(isConnected, hasWallet),
      description: isConnected
        ? 'Wallet connected'
        : hasWallet
          ? 'Authorize this site to interact with your wallet'
          : 'Complete previous step first',
      action:
        !isConnected && hasWallet
          ? { label: 'Connect', onClick: onConnect }
          : undefined,
    },
    {
      id: 'network',
      label: 'Verify Network',
      status: getStepStatus(networkMatch && isConnected, isConnected),
      description: !isConnected
        ? 'Connect wallet first'
        : networkMatch
          ? 'Network confirmed: Casper Testnet'
          : 'Network mismatch detected - check wallet settings',
      hint: !networkMatch && isConnected ? 'Ensure your wallet is on Casper Testnet' : undefined,
    },
    {
      id: 'contracts',
      label: 'Contracts Ready',
      status: getStepStatus(contractsConfigured, networkMatch && isConnected),
      description: contractsConfigured
        ? 'Smart contracts configured'
        : 'Contract addresses not found in config',
      hint: !contractsConfigured ? 'Check contracts.generated.ts' : undefined,
    },
    {
      id: 'deposit',
      label: 'Deposit CSPR',
      status: hasVault
        ? 'complete'
        : contractsConfigured && isConnected
          ? 'current'
          : 'pending',
      description: hasVault
        ? 'Vault created - you can add more collateral anytime'
        : 'Deposit CSPR to create your vault (min 500 CSPR)',
      action:
        !hasVault && contractsConfigured && isConnected
          ? { label: 'Deposit Now', onClick: onDeposit }
          : undefined,
    },
    {
      id: 'borrow',
      label: 'Borrow mCSPR',
      status: hasDebt
        ? 'complete'
        : hasVault
          ? 'current'
          : 'pending',
      description: hasDebt
        ? 'You have an active loan'
        : hasVault
          ? 'Borrow up to 80% LTV against your collateral'
          : 'Deposit first to enable borrowing',
    },
    {
      id: 'manage',
      label: 'Repay & Withdraw',
      status: isPendingWithdraw
        ? 'current'
        : hasDebt || hasVault
          ? 'current'
          : 'pending',
      description: isPendingWithdraw
        ? 'Withdrawal pending - finalize after unbonding'
        : hasDebt
          ? 'Repay debt before withdrawing collateral'
          : hasVault
            ? 'Manage your vault position'
            : 'Create a vault to access these actions',
    },
  ]

  const completedCount = steps.filter((s) => s.status === 'complete').length
  const progressPercent = (completedCount / steps.length) * 100

  return (
    <div className="onboarding-stepper">
      <div className="stepper-header">
        <h3>Getting Started</h3>
        <span className="stepper-progress-text">
          {completedCount} of {steps.length} complete
        </span>
      </div>

      <div className="stepper-progress-bar">
        <div
          className="stepper-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <ol className="stepper-list">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={`stepper-item stepper-item--${step.status}`}
          >
            <div className="stepper-indicator">
              {step.status === 'complete' ? (
                <span className="stepper-check">&#10003;</span>
              ) : (
                <span className="stepper-number">{index + 1}</span>
              )}
            </div>
            <div className="stepper-content">
              <div className="stepper-label">{step.label}</div>
              {step.description && (
                <div className="stepper-description">{step.description}</div>
              )}
              {step.hint && (
                <div className="stepper-hint">{step.hint}</div>
              )}
              {step.action && (
                <button
                  type="button"
                  className="btn btn-primary btn-small stepper-action"
                  onClick={step.action.onClick}
                  disabled={step.action.disabled}
                >
                  {step.action.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="stepper-demo-hint">
        <span>No wallet? Try </span>
        <button
          type="button"
          className="stepper-demo-link"
          onClick={onEnableDemo}
          disabled={!onEnableDemo}
        >
          Demo Mode
        </button>
      </div>
    </div>
  )
}

export default OnboardingStepper
