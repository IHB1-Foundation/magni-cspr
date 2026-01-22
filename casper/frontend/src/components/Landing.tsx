import { FC } from 'react'

interface LandingProps {
  onLaunchApp: () => void
  onHowItWorks: () => void
}

const Landing: FC<LandingProps> = ({ onLaunchApp, onHowItWorks }) => {
  return (
    <section className="landing">
      <div className="landing-hero">
        <h1 className="landing-title">Unlock Your Staked CSPR</h1>
        <p className="landing-subtitle">
          Deposit CSPR, earn staking rewards, and borrow against your collateral — all in one vault.
        </p>
        <div className="landing-ctas">
          <button
            type="button"
            className="btn btn-primary btn-large"
            onClick={onLaunchApp}
          >
            Launch dApp
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-large"
            onClick={onHowItWorks}
          >
            How It Works
          </button>
        </div>
      </div>

      <div className="landing-metrics">
        <div className="metric-card">
          <span className="metric-value">80%</span>
          <span className="metric-label">Max LTV</span>
          <span className="metric-desc">Borrow up to 80% of your collateral value</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">2%</span>
          <span className="metric-label">APR Interest</span>
          <span className="metric-desc">Low-cost borrowing on your staked CSPR</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">500</span>
          <span className="metric-label">Min Deposit</span>
          <span className="metric-desc">CSPR minimum required for delegation</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">~14h</span>
          <span className="metric-label">Unbonding</span>
          <span className="metric-desc">Testnet unbonding period for withdrawals</span>
        </div>
      </div>

      <div className="landing-features">
        <div className="feature-item">
          <span className="feature-icon">1</span>
          <h3>Deposit CSPR</h3>
          <p>Your collateral is delegated to validators for staking rewards</p>
        </div>
        <div className="feature-item">
          <span className="feature-icon">2</span>
          <h3>Borrow mCSPR</h3>
          <p>Mint synthetic mCSPR against your collateral at up to 80% LTV</p>
        </div>
        <div className="feature-item">
          <span className="feature-icon">3</span>
          <h3>Repay &amp; Withdraw</h3>
          <p>Repay debt and withdraw with a 2-step unbonding process</p>
        </div>
      </div>
    </section>
  )
}

export default Landing
