import type { ArchiveEntry } from '../types/archive'
import { isWriteApiConfigured } from '../utils/api'
import { Dialog } from './Dialog'
import { EntryImages } from './EntryImages'
import { EntryMeta } from './EntryMeta'

interface EntryReaderProps {
  entry: ArchiveEntry
  /** True while a saved change to this entry is not deployed yet. */
  pending: boolean
  onClose: () => void
  onEdit: (entry: ArchiveEntry) => void
  onDelete: (entry: ArchiveEntry) => void
}

export function EntryReader({ entry, pending, onClose, onEdit, onDelete }: EntryReaderProps) {
  return (
    <Dialog title={entry.title ?? 'טקסט מלא'} hideTitle={!entry.title} onClose={onClose} className="dialog--reader">
      <EntryMeta entry={entry} pending={pending} />
      {entry.content && (
        <div className="work-text reader__text" tabIndex={0}>
          {entry.content}
        </div>
      )}
      <EntryImages images={entry.attachments} />
      {isWriteApiConfigured() && (
        <div className="reader__actions">
          <button type="button" className="button button--small" onClick={() => onEdit(entry)}>
            <span aria-hidden="true">✎</span> עריכה
          </button>
          <button type="button" className="button button--small button--danger-outline" onClick={() => onDelete(entry)}>
            <span aria-hidden="true">🗑</span> מחיקה
          </button>
        </div>
      )}
    </Dialog>
  )
}
