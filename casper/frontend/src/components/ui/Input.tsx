import { FC, InputHTMLAttributes, ReactNode } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  suffix?: ReactNode
  onMaxClick?: () => void
}

export const Input: FC<InputProps> = ({
  label,
  hint,
  error,
  suffix,
  onMaxClick,
  className = '',
  disabled,
  ...props
}) => {
  return (
    <div className={`input-wrapper ${error ? 'input-error' : ''} ${className}`}>
      {label && <label className="input-label">{label}</label>}
      <div className="input-row">
        <input
          className="input-field"
          disabled={disabled}
          {...props}
        />
        {onMaxClick && (
          <button
            type="button"
            className="btn-max"
            onClick={onMaxClick}
            disabled={disabled}
          >
            Max
          </button>
        )}
        {suffix && <span className="input-unit">{suffix}</span>}
      </div>
      {hint && !error && <span className="input-hint">{hint}</span>}
      {error && <span className="input-error-text">{error}</span>}
    </div>
  )
}

export default Input
