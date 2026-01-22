import { FC } from 'react'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string | number
  className?: string
}

export const Skeleton: FC<SkeletonProps> = ({
  width,
  height = '1rem',
  borderRadius = '4px',
  className = '',
}) => (
  <div
    className={`skeleton ${className}`}
    style={{
      width: typeof width === 'number' ? `${width}px` : width,
      height: typeof height === 'number' ? `${height}px` : height,
      borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
    }}
    aria-hidden="true"
  />
)

export const SkeletonText: FC<{ lines?: number; lastLineWidth?: string }> = ({
  lines = 1,
  lastLineWidth = '60%',
}) => (
  <div className="skeleton-text">
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        width={i === lines - 1 && lines > 1 ? lastLineWidth : '100%'}
        height="0.875rem"
        className="skeleton-line"
      />
    ))}
  </div>
)

export const SkeletonCard: FC = () => (
  <div className="skeleton-card">
    <Skeleton width="40%" height="1.25rem" className="skeleton-title" />
    <div className="skeleton-body">
      <SkeletonText lines={2} />
      <div className="skeleton-row">
        <Skeleton width="30%" height="0.75rem" />
        <Skeleton width="25%" height="0.875rem" />
      </div>
      <div className="skeleton-row">
        <Skeleton width="35%" height="0.75rem" />
        <Skeleton width="20%" height="0.875rem" />
      </div>
    </div>
  </div>
)

export const SkeletonVaultSummary: FC = () => (
  <div className="skeleton-vault-summary">
    <Skeleton width="60%" height="1.5rem" className="skeleton-title" />
    <div className="skeleton-grid">
      <div className="skeleton-item">
        <Skeleton width="60%" height="0.75rem" />
        <Skeleton width="80%" height="1.25rem" />
      </div>
      <div className="skeleton-item">
        <Skeleton width="50%" height="0.75rem" />
        <Skeleton width="70%" height="1.25rem" />
      </div>
      <div className="skeleton-item">
        <Skeleton width="40%" height="0.75rem" />
        <Skeleton width="50%" height="1.25rem" />
      </div>
      <div className="skeleton-item">
        <Skeleton width="55%" height="0.75rem" />
        <Skeleton width="65%" height="1.25rem" />
      </div>
    </div>
  </div>
)

export const SkeletonBalanceRow: FC = () => (
  <div className="skeleton-balance-row">
    <Skeleton width="35%" height="0.875rem" />
    <Skeleton width="25%" height="1rem" />
  </div>
)

export const SkeletonActivityList: FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="skeleton-activity-list">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="skeleton-activity-item">
        <Skeleton width="60px" height="1.5rem" borderRadius="6px" />
        <div className="skeleton-activity-content">
          <Skeleton width="70%" height="0.75rem" />
        </div>
        <Skeleton width="80px" height="0.75rem" />
      </div>
    ))}
  </div>
)

export default Skeleton
