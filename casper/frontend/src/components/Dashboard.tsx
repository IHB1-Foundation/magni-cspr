import { FC, useEffect, useState, useMemo } from 'react'

interface DashboardProps {
  collateralMotes: bigint
  debtWad: bigint
  ltvBps: bigint
  mCSPRBalance: bigint
  csprTotalMotes: bigint
  isDemo?: boolean
}

interface HistorySnapshot {
  timestamp: number
  collateralMotes: string
  debtWad: string
  ltvBps: string
}

const HISTORY_KEY = 'magni-vault-history'
const MAX_HISTORY = 30 // Keep 30 data points

function formatCSPRShort(motes: bigint): string {
  const cspr = Number(motes) / 1e9
  if (cspr >= 1000) return `${(cspr / 1000).toFixed(1)}k`
  return cspr.toFixed(1)
}

function formatWadShort(wad: bigint): string {
  const value = Number(wad) / 1e18
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return value.toFixed(1)
}

// Simple SVG line chart
const MiniChart: FC<{
  data: number[]
  width?: number
  height?: number
  color?: string
  label: string
}> = ({ data, width = 200, height = 60, color = '#4ade80', label }) => {
  if (data.length < 2) {
    return (
      <div className="mini-chart-empty">
        <span>Collecting data...</span>
      </div>
    )
  }

  const max = Math.max(...data, 1) // Avoid division by zero
  const min = Math.min(...data, 0)
  const range = max - min || 1

  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((value - min) / range) * (height - 10) - 5
    return `${x},${y}`
  }).join(' ')

  const lastValue = data[data.length - 1]
  const prevValue = data[data.length - 2]
  const changePercent = prevValue > 0 ? ((lastValue - prevValue) / prevValue) * 100 : 0
  const isPositive = changePercent >= 0

  return (
    <div className="mini-chart">
      <div className="mini-chart-header">
        <span className="mini-chart-label">{label}</span>
        <span className={`mini-chart-change ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '+' : ''}{changePercent.toFixed(1)}%
        </span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="mini-chart-svg"
        aria-label={`${label} trend chart`}
      >
        {/* Gradient fill */}
        <defs>
          <linearGradient id={`gradient-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Fill area */}
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill={`url(#gradient-${label})`}
        />

        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Current value dot */}
        <circle
          cx={width}
          cy={height - ((lastValue - min) / range) * (height - 10) - 5}
          r="4"
          fill={color}
        />
      </svg>
    </div>
  )
}

export const Dashboard: FC<DashboardProps> = ({
  collateralMotes,
  debtWad,
  ltvBps,
  mCSPRBalance,
  csprTotalMotes,
  isDemo,
}) => {
  const [history, setHistory] = useState<HistorySnapshot[]>([])

  // Load history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY)
      if (stored) {
        setHistory(JSON.parse(stored))
      }
    } catch {
      // Ignore parse errors
    }
  }, [])

  // Save snapshot periodically (every minute if values changed)
  useEffect(() => {
    if (collateralMotes === 0n && debtWad === 0n) return

    const interval = setInterval(() => {
      setHistory((prev) => {
        const last = prev[prev.length - 1]
        const collateralStr = collateralMotes.toString()
        const debtStr = debtWad.toString()
        const ltvStr = ltvBps.toString()

        // Only add if values changed
        if (last && last.collateralMotes === collateralStr && last.debtWad === debtStr) {
          return prev
        }

        const newSnapshot: HistorySnapshot = {
          timestamp: Date.now(),
          collateralMotes: collateralStr,
          debtWad: debtStr,
          ltvBps: ltvStr,
        }

        const updated = [...prev, newSnapshot].slice(-MAX_HISTORY)

        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
        } catch {
          // Ignore storage errors
        }

        return updated
      })
    }, 60000) // Every minute

    // Add initial snapshot
    setHistory((prev) => {
      if (prev.length === 0 || prev[prev.length - 1].collateralMotes !== collateralMotes.toString()) {
        const newSnapshot: HistorySnapshot = {
          timestamp: Date.now(),
          collateralMotes: collateralMotes.toString(),
          debtWad: debtWad.toString(),
          ltvBps: ltvBps.toString(),
        }
        const updated = [...prev, newSnapshot].slice(-MAX_HISTORY)
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
        } catch {
          // Ignore
        }
        return updated
      }
      return prev
    })

    return () => clearInterval(interval)
  }, [collateralMotes, debtWad, ltvBps])

  // Prepare chart data
  const collateralData = useMemo(
    () => history.map((h) => Number(BigInt(h.collateralMotes)) / 1e9),
    [history]
  )
  const debtData = useMemo(
    () => history.map((h) => Number(BigInt(h.debtWad)) / 1e18),
    [history]
  )

  const totalValue = Number(collateralMotes + csprTotalMotes) / 1e9
  const healthScore = ltvBps > 0n ? Math.max(0, 100 - Number(ltvBps) / 100) : 100

  return (
    <div className="dashboard">
      <h3 className="dashboard-title">
        Dashboard {isDemo && <span className="dashboard-demo-badge">Demo</span>}
      </h3>

      <div className="dashboard-kpis">
        <div className="kpi-card">
          <div className="kpi-value">{formatCSPRShort(collateralMotes)}</div>
          <div className="kpi-label">Collateral (CSPR)</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{formatWadShort(debtWad)}</div>
          <div className="kpi-label">Debt (mCSPR)</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{(Number(ltvBps) / 100).toFixed(1)}%</div>
          <div className="kpi-label">Current LTV</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: healthScore > 50 ? 'var(--success)' : 'var(--warning)' }}>
            {healthScore.toFixed(0)}
          </div>
          <div className="kpi-label">Health Score</div>
        </div>
      </div>

      <div className="dashboard-charts">
        <MiniChart data={collateralData} color="#4ade80" label="Collateral" />
        <MiniChart data={debtData} color="#f59e0b" label="Debt" />
      </div>

      <div className="dashboard-summary">
        <div className="summary-row">
          <span>Total Value Locked</span>
          <strong>{formatCSPRShort(collateralMotes)} CSPR</strong>
        </div>
        <div className="summary-row">
          <span>Available to Borrow</span>
          <strong>
            {formatWadShort(
              collateralMotes > 0n
                ? (BigInt(Math.floor(Number(collateralMotes) * 0.8)) * BigInt(1e9)) / BigInt(1e9) - debtWad
                : 0n
            )} mCSPR
          </strong>
        </div>
        <div className="summary-row">
          <span>mCSPR Balance</span>
          <strong>{formatWadShort(mCSPRBalance)} mCSPR</strong>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
