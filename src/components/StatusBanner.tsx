import type { PublishStatus } from '../hooks/usePublishWatcher'
import { sectionFor } from '../types/archive'

export function StatusBanner({ status, onDismiss }: { status: PublishStatus | null; onDismiss: () => void }) {
  if (!status) return null
  const message = sectionFor(status.category).messages[status.kind]
  return (
    <div className={`status-banner status-banner--${status.kind}`} role="status" aria-live="polite">
      {status.kind === 'publishing' && <span className="spinner" aria-hidden="true" />}
      <span>{message}</span>
      {status.kind !== 'publishing' && (
        <button type="button" className="icon-button" onClick={onDismiss} aria-label="סגירת ההודעה">
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  )
}
