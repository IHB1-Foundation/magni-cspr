import { FC, ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export const EmptyState: FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => (
  <div className="empty-state">
    {icon && <div className="empty-state-icon">{icon}</div>}
    <h3 className="empty-state-title">{title}</h3>
    {description && <p className="empty-state-description">{description}</p>}
    {action && (
      <button
        type="button"
        className="btn btn-primary btn-small"
        onClick={action.onClick}
      >
        {action.label}
      </button>
    )}
  </div>
)

export const NoVaultState: FC<{ onDeposit: () => void }> = ({ onDeposit }) => (
  <EmptyState
    icon={<span className="empty-state-emoji">&#128230;</span>}
    title="No Vault Yet"
    description="Deposit CSPR to create your vault and start earning staking rewards."
    action={{ label: 'Deposit Now', onClick: onDeposit }}
  />
)

export const NoActivityState: FC = () => (
  <EmptyState
    icon={<span className="empty-state-emoji">&#128221;</span>}
    title="No Activity"
    description="Your transaction history will appear here once you start using the vault."
  />
)

export const NoBalanceState: FC<{ onGetTestnet?: () => void }> = ({ onGetTestnet }) => (
  <EmptyState
    icon={<span className="empty-state-emoji">&#128176;</span>}
    title="No CSPR Balance"
    description="You need CSPR to use Magni. Get testnet tokens from the faucet."
    action={onGetTestnet ? { label: 'Get Testnet CSPR', onClick: onGetTestnet } : undefined}
  />
)

export default EmptyState
