import type { ArchiveEntry } from '../types/archive'
import { isWriteApiConfigured } from '../utils/api'
import { makePreview } from '../utils/archive'
import { EntryImages } from './EntryImages'
import { EntryMeta } from './EntryMeta'
import { PencilIcon, TrashIcon } from './Icons'

interface EntryCardProps {
  entry: ArchiveEntry
  pending?: boolean
  onOpen: (entry: ArchiveEntry) => void
  onEdit: (entry: ArchiveEntry) => void
  onDelete: (entry: ArchiveEntry) => void
  compact?: boolean
}

export function EntryCard({ entry, pending, onOpen, onEdit, onDelete, compact }: EntryCardProps) {
  const preview = compact ? makePreview(entry.content, 6, 360) : makePreview(entry.content)
  const headingId = `entry-${entry.id}`
  // Screen readers get the item's name with each action, e.g. "עריכה: עייפתי".
  const name = entry.title ?? makePreview(entry.content, 1, 40).text
  return (
    <article className={`card${compact ? ' card--compact' : ''}${pending ? ' card--pending' : ''}`} aria-labelledby={entry.title ? headingId : undefined}>
      <div className="card__top">
        <div className="card__heading">
          {entry.title && (
            <h3 className="card__title" id={headingId}>
              <button type="button" className="link-button" onClick={() => onOpen(entry)}>
                {entry.title}
              </button>
            </h3>
          )}
          <EntryMeta entry={entry} pending={pending} />
        </div>
        {isWriteApiConfigured() && (
          <div className="card__actions">
            <button type="button" className="icon-button icon-button--action" onClick={() => onEdit(entry)} aria-label={`עריכה: ${name}`} title="עריכה">
              <PencilIcon />
            </button>
            <button
              type="button"
              className="icon-button icon-button--action icon-button--danger"
              onClick={() => onDelete(entry)}
              aria-label={`מחיקה: ${name}`}
              title="מחיקה"
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>
      {preview.text && (
        <p className="work-text card__text">
          {preview.text}
          {preview.truncated && <span aria-hidden="true">…</span>}
        </p>
      )}
      <EntryImages images={entry.attachments} preview />
      {(preview.truncated || entry.attachments.length > 1) && (
        <button type="button" className="text-button" onClick={() => onOpen(entry)}>
          להמשך קריאה<span className="visually-hidden">: {entry.title ?? 'טקסט מלא'}</span>
        </button>
      )}
    </article>
  )
}
