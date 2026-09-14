import { DEFAULT_AUTHOR, type ArchiveEntry } from '../types/archive'
import { formatDate } from '../utils/archive'

const SOURCE_LABELS: Record<ArchiveEntry['source'], string> = {
  tzura: 'צורה',
  facebook: 'פייסבוק',
  manual: 'נוסף באתר',
}

export function EntryMeta({ entry, pending }: { entry: ArchiveEntry; pending?: boolean }) {
  const date = formatDate(entry.postedAt)
  const showAuthor = entry.author && entry.author !== DEFAULT_AUTHOR
  return (
    <p className="entry-meta">
      {date && <time dateTime={entry.postedAt ?? undefined}>{date}</time>}
      {showAuthor && <span>{entry.author}</span>}
      {entry.sourceUrl ? (
        <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="entry-meta__source">
          למקור<span className="visually-hidden"> ({SOURCE_LABELS[entry.source]}, נפתח בחלון חדש)</span>
        </a>
      ) : (
        entry.source === 'manual' && !pending && <span className="entry-meta__source">{SOURCE_LABELS.manual}</span>
      )}
      {pending && <span className="badge">ממתין לפרסום</span>}
    </p>
  )
}
