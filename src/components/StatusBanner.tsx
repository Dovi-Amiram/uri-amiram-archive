import type { PublishStatus } from '../hooks/usePublishWatcher'
import { sectionFor } from '../types/archive'

/** Messages for saving several items at once (neutral plural, no gendered noun). */
const MANY: Record<PublishStatus['kind'], (n: number) => string> = {
  publishing: (n) => `${n} פריטים נשמרו. האתר מתעדכן כעת.`,
  published: (n) => `${n} פריטים פורסמו באתר.`,
  delayed: (n) => `${n} פריטים נשמרו בהצלחה. ייתכן שיחלפו מספר רגעים עד שיופיעו באתר.`,
}

export function StatusBanner({ status, onDismiss }: { status: PublishStatus | null; onDismiss: () => void }) {
  if (!status) return null
  const message = status.count > 1 ? MANY[status.kind](status.count) : sectionFor(status.category).messages[status.change][status.kind]
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
