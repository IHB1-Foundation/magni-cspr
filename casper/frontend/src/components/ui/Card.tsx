import { FC, ReactNode, HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'connected' | 'warning' | 'info'
  padding?: 'none' | 'small' | 'medium' | 'large'
  children: ReactNode
}

export const Card: FC<CardProps> = ({
  variant = 'default',
  padding = 'medium',
  children,
  className = '',
  ...props
}) => {
  const variantClass = variant !== 'default' ? variant : ''
  const paddingClass = padding !== 'medium' ? `card-padding-${padding}` : ''

  return (
    <div
      className={`card ${variantClass} ${paddingClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title: string
  action?: ReactNode
}

export const CardHeader: FC<CardHeaderProps> = ({ title, action }) => (
  <div className="card-header">
    <h2 className="card-title">{title}</h2>
    {action && <div className="card-action">{action}</div>}
  </div>
)

export const CardBody: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="card-body">{children}</div>
)

export const CardFooter: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="card-footer">{children}</div>
)

export default Card
