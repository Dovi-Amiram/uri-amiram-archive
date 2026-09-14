import { useDeferredValue, useId, useMemo, useState } from 'react'
import { EntryCard } from '../components/EntryCard'
import type { ArchiveEntry, SectionInfo, SortMode } from '../types/archive'
import { searchEntries, sortEntries } from '../utils/archive'

interface ArchivePageProps {
  section: SectionInfo
  entries: ArchiveEntry[]
  pending: ArchiveEntry[]
  onOpen: (entry: ArchiveEntry) => void
  onAdd: () => void
}

const SORT_LABELS: Record<SortMode, string> = {
  newest: 'החדש ביותר',
  oldest: 'הישן ביותר',
  title: 'לפי כותרת',
  likes: 'הכי הרבה לייקים',
}

// Palindromes have no titles but do have likes.
const SORT_MODES: Record<SectionInfo['category'], SortMode[]> = {
  creation: ['newest', 'oldest', 'title'],
  palindrome: ['newest', 'oldest', 'likes'],
}

export function ArchivePage({ section, entries, pending, onOpen, onAdd }: ArchivePageProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('newest')
  const deferredQuery = useDeferredValue(query)
  const searchId = useId()
  const sortId = useId()
  const isPalindromes = section.category === 'palindrome'

  const pendingIds = useMemo(() => new Set(pending.map((e) => e.id)), [pending])
  // Saved-but-not-yet-deployed entries are shown alongside the published ones.
  const all = useMemo(() => {
    const unpublished = pending.filter((p) => p.category === section.category && !entries.some((e) => e.id === p.id))
    return [...unpublished, ...entries]
  }, [entries, pending, section.category])
  const visible = useMemo(() => sortEntries(searchEntries(all, deferredQuery), sort), [all, deferredQuery, sort])
  const total = all.length

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
          <label htmlFor={sortId}>מיון</label>
          <select id={sortId} value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            {SORT_MODES[section.category].map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="button button--primary toolbar__add" onClick={onAdd}>
          <span aria-hidden="true">＋</span> {section.addLabel}
        </button>
      </div>

      <p className="result-count" aria-live="polite">
        {deferredQuery.trim() ? `נמצאו ${visible.length} מתוך ${total}` : `${total} פריטים`}
      </p>

      {visible.length === 0 ? (
        <p className="empty-state">{deferredQuery.trim() ? 'לא נמצאו פריטים התואמים לחיפוש' : 'אין עדיין פריטים'}</p>
      ) : (
        <ul className={`entry-list${isPalindromes ? ' entry-list--grid' : ''}`}>
          {visible.map((entry) => (
            <li key={entry.id}>
              <EntryCard entry={entry} pending={pendingIds.has(entry.id)} onOpen={onOpen} compact={isPalindromes} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
