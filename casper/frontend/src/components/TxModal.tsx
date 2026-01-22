import { FC, useEffect, useRef } from 'react'

export type TxModalStatus = 'signing' | 'pending' | 'success' | 'error'

export interface TxModalData {
  isOpen: boolean
  status: TxModalStatus
  label: string
  hash?: string
  error?: string
  explorerUrl?: string
}

interface TxModalProps {
  data: TxModalData
  onClose: () => void
  onRetry?: () => void
}

const TxModal: FC<TxModalProps> = ({ data, onClose, onRetry }) => {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!data.isOpen) return

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [data.isOpen, onClose])

  useEffect(() => {
    if (data.isOpen) {
      modalRef.current?.focus()
    }
  }, [data.isOpen])

  if (!data.isOpen) return null

  const statusConfig = {
    signing: { icon: '✍️', title: 'Waiting for Signature', color: 'var(--info)' },
    pending: { icon: '⏳', title: 'Transaction Pending', color: 'var(--warning)' },
    success: { icon: '✓', title: 'Transaction Successful', color: 'var(--success)' },
    error: { icon: '✕', title: 'Transaction Failed', color: 'var(--error)' },
  }

  const config = statusConfig[data.status]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="tx-modal-title" className="modal-title">
            {data.label}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="tx-modal-status" style={{ color: config.color }}>
            <span className="tx-modal-icon">{config.icon}</span>
            <span className="tx-modal-status-text">{config.title}</span>
          </div>

          {data.status === 'signing' && (
            <p className="tx-modal-hint">
              Please check your Casper Wallet to sign the transaction.
            </p>
          )}

          {data.status === 'pending' && (
            <p className="tx-modal-hint">
              Your transaction has been submitted to the network. This may take a moment.
            </p>
          )}

          {data.hash && (
            <div className="tx-modal-hash-section">
              <label>Deploy Hash</label>
              <div className="tx-modal-hash">
                <code>{data.hash}</code>
                <button
                  type="button"
                  className="btn btn-small btn-outline"
                  onClick={() => navigator.clipboard.writeText(data.hash || '')}
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {data.error && (
            <div className="tx-modal-error">
              <label>Error Details</label>
              <div className="tx-modal-error-text">{data.error}</div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {data.explorerUrl && (
            <a
              href={data.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              View on Explorer
            </a>
          )}
          {data.status === 'error' && onRetry && (
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              Retry
            </button>
          )}
          {(data.status === 'success' || data.status === 'error') && (
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default TxModal
