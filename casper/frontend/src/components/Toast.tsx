import { FC, useEffect, useState } from 'react'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastData {
  id: string
  type: ToastType
  title: string
  message?: string
  hash?: string
  explorerUrl?: string
  duration?: number // 0 = no auto-dismiss
  action?: {
    label: string
    onClick: () => void
  }
}

interface ToastProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

const Toast: FC<ToastProps> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    if (toast.duration === 0) return

    const timeout = toast.duration || 5000
    const timer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(() => onDismiss(toast.id), 200)
    }, timeout)

    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onDismiss])

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(() => onDismiss(toast.id), 200)
  }

  return (
    <div
      className={`toast toast--${toast.type} ${isExiting ? 'toast--exiting' : ''}`}
      role="alert"
      aria-live="polite"
    >
      <div className="toast-icon">
        {toast.type === 'success' && '✓'}
        {toast.type === 'error' && '✕'}
        {toast.type === 'warning' && '!'}
        {toast.type === 'info' && 'i'}
      </div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        {toast.message && <div className="toast-message">{toast.message}</div>}
        {toast.hash && (
          <div className="toast-hash">
            <code>{toast.hash.slice(0, 10)}...{toast.hash.slice(-8)}</code>
            {toast.explorerUrl && (
              <a
                href={toast.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="toast-explorer-link"
              >
                View
              </a>
            )}
          </div>
        )}
        {toast.action && (
          <button
            type="button"
            className="toast-action-btn"
            onClick={toast.action.onClick}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        className="toast-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

export const ToastContainer: FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null

  return (
    <div className="toast-container" aria-label="Notifications">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

export default Toast
