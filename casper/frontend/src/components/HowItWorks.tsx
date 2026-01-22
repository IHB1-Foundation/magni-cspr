import { FC } from 'react'

interface HowItWorksProps {
  onGetStarted: () => void
}

// Simple SVG diagram for deposit flow
const DepositFlowDiagram: FC = () => (
  <svg viewBox="0 0 400 120" className="how-diagram" aria-label="Deposit flow diagram">
    {/* User */}
    <circle cx="50" cy="60" r="30" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="2" />
    <text x="50" y="55" textAnchor="middle" fontSize="10" fill="var(--text-muted)">User</text>
    <text x="50" y="70" textAnchor="middle" fontSize="8" fill="var(--text-muted)">CSPR</text>

    {/* Arrow 1 */}
    <path d="M85 60 L145 60" stroke="var(--success)" strokeWidth="2" markerEnd="url(#arrow)" />
    <text x="115" y="50" textAnchor="middle" fontSize="8" fill="var(--text-muted)">Deposit</text>

    {/* Magni Vault */}
    <rect x="150" y="30" width="80" height="60" rx="8" fill="var(--surface-2)" stroke="var(--primary)" strokeWidth="2" />
    <text x="190" y="55" textAnchor="middle" fontSize="10" fill="var(--text)">Magni</text>
    <text x="190" y="70" textAnchor="middle" fontSize="8" fill="var(--text-muted)">Vault</text>

    {/* Arrow 2 */}
    <path d="M235 60 L295 60" stroke="var(--info)" strokeWidth="2" markerEnd="url(#arrow)" />
    <text x="265" y="50" textAnchor="middle" fontSize="8" fill="var(--text-muted)">Delegate</text>

    {/* Validator */}
    <circle cx="340" cy="60" r="30" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="2" />
    <text x="340" y="55" textAnchor="middle" fontSize="9" fill="var(--text-muted)">Validator</text>
    <text x="340" y="70" textAnchor="middle" fontSize="8" fill="var(--success)">Staking</text>

    {/* Arrow definition */}
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="var(--text-muted)" />
      </marker>
    </defs>
  </svg>
)

// Simple SVG diagram for borrow flow
const BorrowFlowDiagram: FC = () => (
  <svg viewBox="0 0 400 120" className="how-diagram" aria-label="Borrow flow diagram">
    {/* Collateral */}
    <rect x="20" y="30" width="80" height="60" rx="8" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="2" />
    <text x="60" y="50" textAnchor="middle" fontSize="9" fill="var(--text-muted)">Collateral</text>
    <text x="60" y="65" textAnchor="middle" fontSize="12" fill="var(--text)">1000</text>
    <text x="60" y="78" textAnchor="middle" fontSize="8" fill="var(--text-muted)">CSPR</text>

    {/* Arrow 1 */}
    <path d="M105 60 L165 60" stroke="var(--warning)" strokeWidth="2" markerEnd="url(#arrow2)" />
    <text x="135" y="50" textAnchor="middle" fontSize="8" fill="var(--text-muted)">80% LTV</text>

    {/* Borrow */}
    <rect x="170" y="30" width="80" height="60" rx="8" fill="var(--surface-2)" stroke="var(--warning)" strokeWidth="2" />
    <text x="210" y="50" textAnchor="middle" fontSize="9" fill="var(--text-muted)">Max Borrow</text>
    <text x="210" y="65" textAnchor="middle" fontSize="12" fill="var(--warning)">800</text>
    <text x="210" y="78" textAnchor="middle" fontSize="8" fill="var(--text-muted)">mCSPR</text>

    {/* Arrow 2 */}
    <path d="M255 60 L315 60" stroke="var(--info)" strokeWidth="2" markerEnd="url(#arrow2)" />
    <text x="285" y="50" textAnchor="middle" fontSize="8" fill="var(--text-muted)">Mint</text>

    {/* mCSPR */}
    <circle cx="355" cy="60" r="30" fill="var(--surface-2)" stroke="var(--info)" strokeWidth="2" />
    <text x="355" y="55" textAnchor="middle" fontSize="10" fill="var(--info)">mCSPR</text>
    <text x="355" y="70" textAnchor="middle" fontSize="8" fill="var(--text-muted)">Token</text>

    {/* Arrow definition */}
    <defs>
      <marker id="arrow2" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="var(--text-muted)" />
      </marker>
    </defs>
  </svg>
)

// Simple SVG diagram for withdraw flow
const WithdrawFlowDiagram: FC = () => (
  <svg viewBox="0 0 400 100" className="how-diagram" aria-label="Withdraw flow diagram">
    {/* Step 1 */}
    <rect x="20" y="25" width="70" height="50" rx="8" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="2" />
    <text x="55" y="45" textAnchor="middle" fontSize="8" fill="var(--text-muted)">1. Request</text>
    <text x="55" y="60" textAnchor="middle" fontSize="8" fill="var(--warning)">Undelegate</text>

    {/* Arrow 1 */}
    <path d="M95 50 L135 50" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="4 2" />

    {/* Step 2 */}
    <rect x="140" y="25" width="70" height="50" rx="8" fill="var(--surface-2)" stroke="var(--warning)" strokeWidth="2" />
    <text x="175" y="45" textAnchor="middle" fontSize="8" fill="var(--text-muted)">2. Wait</text>
    <text x="175" y="60" textAnchor="middle" fontSize="8" fill="var(--warning)">~14h</text>

    {/* Arrow 2 */}
    <path d="M215 50 L255 50" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="4 2" />

    {/* Step 3 */}
    <rect x="260" y="25" width="70" height="50" rx="8" fill="var(--surface-2)" stroke="var(--success)" strokeWidth="2" />
    <text x="295" y="45" textAnchor="middle" fontSize="8" fill="var(--text-muted)">3. Finalize</text>
    <text x="295" y="60" textAnchor="middle" fontSize="8" fill="var(--success)">Receive</text>

    {/* Arrow 3 */}
    <path d="M335 50 L360 50" stroke="var(--success)" strokeWidth="2" markerEnd="url(#arrow3)" />

    {/* CSPR */}
    <text x="380" y="55" textAnchor="middle" fontSize="10" fill="var(--success)">CSPR</text>

    <defs>
      <marker id="arrow3" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="var(--success)" />
      </marker>
    </defs>
  </svg>
)

export const HowItWorks: FC<HowItWorksProps> = ({ onGetStarted }) => {
  return (
    <div className="how-it-works">
      <div className="how-header">
        <h2>How Magni Works</h2>
        <p className="how-subtitle">
          Magni is a collateral-debt vault on Casper Network. Deposit CSPR, earn staking rewards, and borrow against your collateral.
        </p>
      </div>

      <div className="how-section">
        <h3>1. Deposit CSPR</h3>
        <p>
          Your deposited CSPR is delegated to validators for staking rewards. You maintain ownership while earning yield.
        </p>
        <div className="how-diagram-container">
          <DepositFlowDiagram />
        </div>
        <ul className="how-list">
          <li>Minimum deposit: <strong>500 CSPR</strong> (required for delegation)</li>
          <li>Collateral is staked to earn rewards</li>
          <li>No lock-up period for deposits</li>
        </ul>
      </div>

      <div className="how-section">
        <h3>2. Borrow mCSPR</h3>
        <p>
          Borrow synthetic mCSPR tokens against your collateral at up to 80% Loan-to-Value (LTV).
        </p>
        <div className="how-diagram-container">
          <BorrowFlowDiagram />
        </div>
        <ul className="how-list">
          <li>Maximum LTV: <strong>80%</strong></li>
          <li>Interest rate: <strong>2% APR</strong></li>
          <li>mCSPR is freely transferable</li>
        </ul>
      </div>

      <div className="how-section">
        <h3>3. Repay & Withdraw</h3>
        <p>
          Repay your debt at any time. Withdrawals follow a 2-step process due to unbonding requirements.
        </p>
        <div className="how-diagram-container">
          <WithdrawFlowDiagram />
        </div>
        <ul className="how-list">
          <li>Repay debt using mCSPR (requires approval)</li>
          <li>Unbonding period: <strong>~14 hours</strong> (testnet) / ~14 days (mainnet)</li>
          <li>Cannot withdraw while debt exceeds safe LTV</li>
        </ul>
      </div>

      <div className="how-cta">
        <button
          type="button"
          className="btn btn-primary btn-large"
          onClick={onGetStarted}
        >
          Get Started
        </button>
      </div>
    </div>
  )
}

export default HowItWorks
