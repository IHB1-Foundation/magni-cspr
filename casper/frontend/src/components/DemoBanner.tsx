import { FC } from 'react'

interface DemoBannerProps {
  onExit: () => void
}

export const DemoBanner: FC<DemoBannerProps> = ({ onExit }) => {
  return (
    <div className="demo-banner" role="alert">
      <div className="demo-banner-content">
        <span className="demo-banner-icon">🎭</span>
        <span className="demo-banner-text">
          <strong>Demo Mode</strong> — Using mocked data. Transactions are disabled.
        </span>
      </div>
      <button
        type="button"
        className="demo-banner-exit"
        onClick={onExit}
      >
        Exit Demo
      </button>
    </div>
  )
}

export default DemoBanner
