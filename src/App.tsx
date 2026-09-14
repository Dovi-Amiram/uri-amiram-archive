import { useCallback, useMemo, useState } from 'react'
import { DeleteDialog } from './components/DeleteDialog'
import { EntryForm } from './components/EntryForm'
import { EntryReader } from './components/EntryReader'
import { SiteHeader } from './components/SiteHeader'
import { StatusBanner } from './components/StatusBanner'
import { useArchiveData } from './hooks/useArchiveData'
import { useHashRoute } from './hooks/useHashRoute'
import { usePublishWatcher } from './hooks/usePublishWatcher'
import { ArchivePage } from './pages/ArchivePage'
import { SECTIONS, sectionFor, type ArchiveEntry, type Category } from './types/archive'
import type { SessionToken } from './utils/api'
import { applyPendingChanges } from './utils/archive'

/** Which write dialog is open. */
type Editor = { mode: 'create' } | { mode: 'edit'; entry: ArchiveEntry } | { mode: 'delete'; entry: ArchiveEntry } | null

export default function App() {
  const { route, navigate } = useHashRoute()
  const { state, entries, buildId, reload } = useArchiveData()
  const { pending, status, watch, dismiss } = usePublishWatcher(buildId, reload)
  const [editor, setEditor] = useState<Editor>(null)
  // In memory only: gone when the tab is closed or reloaded.
  const [session, setSession] = useState<SessionToken | null>(null)

  const { section, entryId } = route
  // Published entries with saved-but-not-yet-deployed changes applied on top.
  const shown = useMemo(
    () =>
      Object.fromEntries(SECTIONS.map((s) => [s.category, applyPendingChanges(entries[s.category], pending, s.category)])) as Record<
        Category,
        ArchiveEntry[]
      >,
    [entries, pending],
  )
  const pendingIds = useMemo(() => new Set(pending.map((c) => c.entry.id)), [pending])
  const openEntry = entryId ? shown[section.category].find((e) => e.id === entryId) : undefined

  const handleOpen = useCallback((entry: ArchiveEntry) => navigate(section, entry.id), [navigate, section])
  const closeReader = useCallback(() => navigate(section, null, true), [navigate, section])
  const closeEditor = useCallback(() => setEditor(null), [])

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        דילוג לתוכן
      </a>
      <SiteHeader current={section} entries={state === 'ready' ? shown : null} />

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
            entries={shown[section.category]}
            pendingIds={pendingIds}
            onOpen={handleOpen}
            onEdit={(entry) => setEditor({ mode: 'edit', entry })}
            onDelete={(entry) => setEditor({ mode: 'delete', entry })}
            onAdd={() => setEditor({ mode: 'create' })}
          />
        )}
      </main>

      <footer className="site-footer">
        <p>ארכיון דיגיטלי לשמירת כתביו של אורי עמירם</p>
      </footer>

      {openEntry && !editor && (
        <EntryReader
          entry={openEntry}
          pending={pendingIds.has(openEntry.id)}
          onClose={closeReader}
          onEdit={(entry) => setEditor({ mode: 'edit', entry })}
          onDelete={(entry) => setEditor({ mode: 'delete', entry })}
        />
      )}
      {(editor?.mode === 'create' || editor?.mode === 'edit') && (
        <EntryForm
          section={editor.mode === 'edit' ? sectionFor(editor.entry.category) : section}
          entry={editor.mode === 'edit' ? editor.entry : undefined}
          session={session}
          onSession={setSession}
          onClose={closeEditor}
          onSaved={(entry, kind) => {
            setEditor(null)
            watch(kind, entry)
          }}
        />
      )}
      {editor?.mode === 'delete' && (
        <DeleteDialog
          section={sectionFor(editor.entry.category)}
          entry={editor.entry}
          session={session}
          onSession={setSession}
          onClose={closeEditor}
          onDeleted={(entry) => {
            setEditor(null)
            if (entryId === entry.id) closeReader()
            watch('delete', entry)
          }}
        />
      )}
    </div>
  )
}
