import { buildHash } from '../hooks/useHashRoute'
import { SECTIONS, type ArchiveEntry, type Category, type SectionInfo } from '../types/archive'

interface SiteHeaderProps {
  current: SectionInfo
  entries: Record<Category, ArchiveEntry[]> | null
}

/** "100 יצירות · 663 פלינדרומים · 2003–2026", all derived from the archive itself. */
function ArchiveSummary({ entries }: { entries: Record<Category, ArchiveEntry[]> }) {
  const all = [...entries.creation, ...entries.palindrome]
  if (all.length === 0) return null
  const years = all.map((e) => Number(e.postedAt?.slice(0, 4))).filter((y) => y > 1900)
  return (
    <>
      {entries.creation.length.toLocaleString('he-IL')} יצירות · {entries.palindrome.length.toLocaleString('he-IL')} פלינדרומים
      {years.length > 0 && (
        <>
          {' · '}
          {/* An explicit LTR run keeps the range reading 2003–2026 inside RTL text. */}
          <bdi dir="ltr">
            {Math.min(...years)}–{Math.max(...years)}
          </bdi>
        </>
      )}
    </>
  )
}

export function SiteHeader({ current, entries }: SiteHeaderProps) {
  return (
    <header className="hero">
      <div className="hero__inner">
        <h1 className="hero__title">
          <a href={buildHash(SECTIONS[0])}>
            <span className="hero__eyebrow">היצירות של</span>
            <span className="hero__name">אורי עמירם</span>
          </a>
        </h1>
        <div className="hero__ornament" aria-hidden="true">
          <span />
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M12 2 L15 12 L12 22 L9 12 Z" fill="currentColor" />
          </svg>
          <span />
        </div>
        <p className="hero__tagline">שירים, פזמונים ופלינדרומים</p>
        <p className="hero__summary" aria-live="polite">
          {entries && <ArchiveSummary entries={entries} />}
        </p>
      </div>
      <nav className="hero__nav" aria-label="ניווט ראשי">
        <ul className="tabs">
          {SECTIONS.map((s) => (
            <li key={s.hash}>
              <a href={buildHash(s)} className="tab" aria-current={s.hash === current.hash ? 'page' : undefined}>
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  )
}
