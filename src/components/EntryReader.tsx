import type { ArchiveEntry } from '../types/archive'
import { Dialog } from './Dialog'
import { EntryMeta } from './EntryMeta'

export function EntryReader({ entry, onClose }: { entry: ArchiveEntry; onClose: () => void }) {
  return (
    <Dialog title={entry.title ?? 'טקסט מלא'} hideTitle={!entry.title} onClose={onClose} className="dialog--reader">
      <EntryMeta entry={entry} />
      <div className="work-text reader__text" tabIndex={0}>
        {entry.content}
      </div>
    </Dialog>
  )
}
