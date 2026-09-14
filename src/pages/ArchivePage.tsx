import { useDeferredValue, useId, useMemo, useState } from 'react'
import { EntryCard } from '../components/EntryCard'
import type { ArchiveEntry, SectionInfo, SortDirection, SortField } from '../types/archive'
import { searchEntries, sortEntries } from '../utils/archive'

interface ArchivePageProps {
  section: SectionInfo
  /** Entries to show, with pending (not yet deployed) changes already applied. */
  entries: ArchiveEntry[]
  pendingIds: Set<string>
  onOpen: (entry: ArchiveEntry) => void
  onEdit: (entry: ArchiveEntry) => void
  onDelete: (entry: ArchiveEntry) => void
  onAdd: () => void
}

const SORT_LABELS: Record<SortField, string> = {
  date: 'תאריך',
  title: 'כותרת',
  likes: 'לייקים',
}

// Palindromes have no titles but do have likes.
const SORT_FIELDS: Record<SectionInfo['category'], SortField[]> = {
  creation: ['date', 'title'],
  palindrome: ['date', 'likes'],
}

/** What each direction means for each field, for the toggle button. */
const DIRECTION_LABELS: Record<SortField, Record<SortDirection, string>> = {
  date: { desc: 'מהחדש לישן', asc: 'מהישן לחדש' },
  title: { asc: 'מא׳ עד ת׳', desc: 'מת׳ עד א׳' },
  likes: { desc: 'מהרב למעט', asc: 'מהמעט לרב' },
}

const DEFAULT_DIRECTION: Record<SortField, SortDirection> = { date: 'desc', title: 'asc', likes: 'desc' }

export function ArchivePage({ section, entries, pendingIds, onOpen, onEdit, onDelete, onAdd }: ArchivePageProps) {
  const [query, setQuery] = useState('')
  const [field, setField] = useState<SortField>('date')
  const [direction, setDirection] = useState<SortDirection>('desc')
  const deferredQuery = useDeferredValue(query)
  const searchId = useId()
  const sortId = useId()
  const isPalindromes = section.category === 'palindrome'

  const visible = useMemo(
    () => sortEntries(searchEntries(entries, deferredQuery), field, direction),
    [entries, deferredQuery, field, direction],
  )
  const flipped: SortDirection = direction === 'desc' ? 'asc' : 'desc'

  return (
    <section aria-labelledby={`${section.hash}-heading`}>
      <h2 id={`${section.hash}-heading`} className="visually-hidden">
        {section.label}
      </h2>

      <div className="toolbar">
        <div className="toolbar__search">
          <label htmlFor={searchId} className="visually-hidden">
            חיפוש
          </label>
          <input
            id={searchId}
            type="search"
            placeholder="חיפוש…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="toolbar__sort">
          <label htmlFor={sortId}>מיון לפי</label>
          <select
            id={sortId}
            value={field}
            onChange={(e) => {
              const next = e.target.value as SortField
              setField(next)
              setDirection(DEFAULT_DIRECTION[next])
            }}
          >
            {SORT_FIELDS[section.category].map((f) => (
              <option key={f} value={f}>
                {SORT_LABELS[f]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button sort-direction"
            onClick={() => setDirection(flipped)}
            aria-label={`סדר: ${DIRECTION_LABELS[field][direction]}. לחצו כדי להפוך ל${DIRECTION_LABELS[field][flipped]}`}
            title="היפוך סדר המיון"
          >
            <span aria-hidden="true" className="sort-direction__icon">
              {direction === 'desc' ? '↓' : '↑'}
            </span>
            <span aria-hidden="true">{DIRECTION_LABELS[field][direction]}</span>
          </button>
        </div>
        <button type="button" className="button button--primary toolbar__add" onClick={onAdd}>
          <span aria-hidden="true">＋</span> {section.addLabel}
        </button>
      </div>

      <p className="result-count" aria-live="polite">
        {deferredQuery.trim() ? `נמצאו ${visible.length} מתוך ${entries.length}` : `${entries.length} פריטים`}
      </p>

      {visible.length === 0 ? (
        <p className="empty-state">{deferredQuery.trim() ? 'לא נמצאו פריטים התואמים לחיפוש' : 'אין עדיין פריטים'}</p>
      ) : (
        <ul className={`entry-list${isPalindromes ? ' entry-list--grid' : ''}`}>
          {visible.map((entry) => (
            <li key={entry.id}>
              <EntryCard
                entry={entry}
                pending={pendingIds.has(entry.id)}
                onOpen={onOpen}
                onEdit={onEdit}
                onDelete={onDelete}
                compact={isPalindromes}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
