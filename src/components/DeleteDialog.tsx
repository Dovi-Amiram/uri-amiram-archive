import { useRef, useState } from 'react'
import type { ArchiveEntry, SectionInfo } from '../types/archive'
import { deleteEntry, isSessionValid, type SessionToken } from '../utils/api'
import { makePreview } from '../utils/archive'
import { WrongPasswordError, withSession } from '../utils/session'
import { Dialog } from './Dialog'
import { PasswordField } from './PasswordField'

interface DeleteDialogProps {
  section: SectionInfo
  entry: ArchiveEntry
  session: SessionToken | null
  onSession: (session: SessionToken | null) => void
  onClose: () => void
  onDeleted: (entry: ArchiveEntry) => void
}

export function DeleteDialog({ section, entry, session, onSession, onClose, onDeleted }: DeleteDialogProps) {
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const needsPassword = !isSessionValid(session)
  const preview = makePreview(entry.content, 3, 160)

  async function confirm() {
    setError(null)
    if (needsPassword && !password) {
      setPasswordError('יש להזין סיסמה')
      passwordRef.current?.focus()
      return
    }
    setDeleting(true)
    try {
      await withSession(session, password, onSession, (token) => deleteEntry(token, entry.id, entry.category))
      onDeleted(entry)
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        setPasswordError(err.message)
        passwordRef.current?.focus()
      } else {
        setError(err instanceof Error ? err.message : 'אירעה שגיאה')
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog title="מחיקה" onClose={onClose} className="dialog--confirm">
      <p className="confirm__question">{section.deleteQuestion}</p>
      <blockquote className="confirm__preview work-text">
        {entry.title && <strong>{entry.title}</strong>}
        {entry.title && preview.text && '\n'}
        {preview.text}
        {preview.truncated && '…'}
      </blockquote>
      {entry.source !== 'manual' && (
        <p className="form-note">הפריט לא יתווסף שוב בעדכונים הבאים מהמקור. גרסאות קודמות נשמרות בהיסטוריה של המאגר.</p>
      )}
      {needsPassword && (
        <PasswordField
          ref={passwordRef}
          value={password}
          error={passwordError}
          onChange={(v) => {
            setPassword(v)
            setPasswordError(null)
          }}
        />
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button button--danger" onClick={() => void confirm()} disabled={deleting}>
          {deleting ? 'מוחק…' : 'מחיקה'}
        </button>
        <button type="button" className="button" onClick={onClose} disabled={deleting} autoFocus>
          ביטול
        </button>
      </div>
    </Dialog>
  )
}
