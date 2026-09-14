import type { ArchiveEntry } from '../types/archive'
import { makePreview } from '../utils/archive'
import { EntryMeta } from './EntryMeta'

interface EntryCardProps {
  entry: ArchiveEntry
  pending?: boolean
  onOpen: (entry: ArchiveEntry) => void
  compact?: boolean
}

export function EntryCard({ entry, pending, onOpen, compact }: EntryCardProps) {
  const preview = compact ? makePreview(entry.content, 6, 360) : makePreview(entry.content)
  const headingId = `entry-${entry.id}`
  return (
    <article className={`card${compact ? ' card--compact' : ''}${pending ? ' card--pending' : ''}`} aria-labelledby={entry.title ? headingId : undefined}>
      {entry.title && (
        <h3 className="card__title" id={headingId}>
          <button type="button" className="link-button" onClick={() => onOpen(entry)}>
            {entry.title}
          </button>
        </h3>
      )}
      <EntryMeta entry={entry} pending={pending} />
      <p className="work-text card__text">
        {preview.text}
        {preview.truncated && <span aria-hidden="true">…</span>}
      </p>
      {preview.truncated && (
        <button type="button" className="text-button" onClick={() => onOpen(entry)}>
          להמשך קריאה<span className="visually-hidden">: {entry.title ?? 'טקסט מלא'}</span>
        </button>
      )}
    </article>
  )
}
