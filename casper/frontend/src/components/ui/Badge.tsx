import { FC, ReactNode } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

interface BadgeProps {
  variant?: BadgeVariant
  size?: 'small' | 'medium'
  children: ReactNode
  className?: string
}

export const Badge: FC<BadgeProps> = ({
  variant = 'default',
  size = 'medium',
  children,
  className = '',
}) => {
  return (
    <span
      className={`badge badge-${variant} badge-${size} ${className}`.trim()}
    >
      {children}
    </span>
  )
}

export const NetworkBadge: FC<{ network: string }> = ({ network }) => {
  const isTestnet = /test/i.test(network)
  return (
    <Badge variant={isTestnet ? 'warning' : 'default'} size="small">
      {network}
    </Badge>
  )
}

export const StatusBadge: FC<{ status: 'pending' | 'success' | 'error' | 'idle' }> = ({ status }) => {
  const variantMap: Record<string, BadgeVariant> = {
    pending: 'warning',
    success: 'success',
    error: 'error',
    idle: 'default',
  }
  return (
    <Badge variant={variantMap[status] || 'default'} size="small">
      {status}
    </Badge>
  )
}

export default Badge
