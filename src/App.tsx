import { useCallback, useState } from 'react'
import { EntryForm } from './components/EntryForm'
import { EntryReader } from './components/EntryReader'
import { SiteHeader } from './components/SiteHeader'
import { StatusBanner } from './components/StatusBanner'
import { useArchiveData } from './hooks/useArchiveData'
import { useHashRoute } from './hooks/useHashRoute'
import { usePublishWatcher } from './hooks/usePublishWatcher'
import { ArchivePage } from './pages/ArchivePage'
import type { ArchiveEntry } from './types/archive'
import type { SessionToken } from './utils/api'

export default function App() {
  const { route, navigate } = useHashRoute()
  const { state, entries, buildId, reload } = useArchiveData()
  const { pending, status, watch, dismiss } = usePublishWatcher(buildId, reload)
  const [adding, setAdding] = useState(false)
  // In memory only: gone when the tab is closed or reloaded.
  const [session, setSession] = useState<SessionToken | null>(null)

  const { section, entryId } = route
  const sectionEntries = entries[section.category]
  const openEntry = entryId
    ? (sectionEntries.find((e) => e.id === entryId) ?? pending.find((e) => e.id === entryId && e.category === section.category))
    : undefined

  const handleOpen = useCallback((entry: ArchiveEntry) => navigate(section, entry.id), [navigate, section])
  const handleCloseReader = useCallback(() => navigate(section, null, true), [navigate, section])

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        דילוג לתוכן
      </a>
      <SiteHeader current={section} entries={state === 'ready' ? entries : null} />

      <main id="main" className="main" tabIndex={-1}>
        <StatusBanner status={status} onDismiss={dismiss} />
        {state === 'loading' && (
          <p className="loading" role="status">
            טוען...
          </p>
        )}
        {state === 'error' && (
          <div className="error-state" role="alert">
            <p>אירעה שגיאה בטעינת הארכיון.</p>
            <button type="button" className="button" onClick={() => void reload()}>
              ניסיון נוסף
            </button>
          </div>
        )}
        {state === 'ready' && (
          <ArchivePage
            key={section.hash}
            section={section}
            entries={sectionEntries}
            pending={pending}
            onOpen={handleOpen}
            onAdd={() => setAdding(true)}
          />
        )}
      </main>

      <footer className="site-footer">
        <p>ארכיון דיגיטלי לשמירת כתביו של אורי עמירם</p>
      </footer>

      {openEntry && <EntryReader entry={openEntry} onClose={handleCloseReader} />}
      {adding && (
        <EntryForm
          section={section}
          session={session}
          onSession={setSession}
          onClose={() => setAdding(false)}
          onSaved={(entry) => {
            setAdding(false)
            watch(entry)
          }}
        />
      )}
    </div>
  )
}
