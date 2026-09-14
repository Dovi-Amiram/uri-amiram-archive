import { useRef, useState, type FormEvent } from 'react'
import type { ArchiveEntry, SectionInfo } from '../types/archive'
import { isSessionValid, isWriteApiConfigured, updateEntry, type SessionToken } from '../utils/api'
import { parseEntry } from '../utils/archive'
import { WrongPasswordError, withSession } from '../utils/session'
import { formFromEntry, toPayload, validateEntryForm, type EntryFormValues, type FormErrors } from '../utils/validation'
import { Dialog } from './Dialog'
import { EntryFields } from './EntryFields'
import { PasswordField } from './PasswordField'

interface EntryFormProps {
  section: SectionInfo
  entry: ArchiveEntry
  session: SessionToken | null
  onSession: (session: SessionToken | null) => void
  onClose: () => void
  onSaved: (entry: ArchiveEntry) => void
}

/** Edit one existing entry. (Adding uses AddEntriesDialog, which supports many at once.) */
export function EntryForm({ section, entry, session, onSession, onClose, onSaved }: EntryFormProps) {
  const hasImages = entry.attachments.length > 0
  const [values, setValues] = useState<EntryFormValues>(() => formFromEntry(entry))
  const [errors, setErrors] = useState<FormErrors>({})
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const needsPassword = !isSessionValid(session)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitError(null)
    const found = validateEntryForm(values, { allowEmptyContent: hasImages })
    const pwMissing = needsPassword && !password
    setErrors(found)
    setPasswordError(pwMissing ? 'יש להזין סיסמה' : null)
    if (Object.keys(found).length > 0) {
      if (found.content) contentRef.current?.focus()
      return
    }
    if (pwMissing) {
      passwordRef.current?.focus()
      return
    }

    setSaving(true)
    try {
      const payload = toPayload(values, entry.category, entry)
      const result = await withSession(session, password, onSession, (token) => updateEntry(token, entry.id, payload))
      const saved = parseEntry(result.entry)
      if (!saved) throw new Error('אירעה שגיאה')
      onSaved(saved)
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        setPasswordError(err.message)
        passwordRef.current?.focus()
      } else {
        setSubmitError(err instanceof Error ? err.message : 'אירעה שגיאה')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isWriteApiConfigured()) {
    return (
      <Dialog title={section.editLabel} onClose={onClose}>
        <p className="form-note">עריכת פריטים עדיין אינה זמינה באתר זה.</p>
      </Dialog>
    )
  }

  return (
    <Dialog title={section.editLabel} onClose={onClose} className="dialog--form">
      <form className="entry-form" onSubmit={handleSubmit} noValidate>
        <EntryFields
          category={entry.category}
          values={values}
          errors={errors}
          onChange={(field, value) => {
            setValues((v) => ({ ...v, [field]: value }))
            if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
          }}
          contentRef={contentRef}
          contentOptional={hasImages}
          forceLikes={entry.likes !== null}
        />

        {entry.source !== 'manual' && <p className="form-note">שדות שישונו כאן יישמרו גם אם הנתונים ייאספו שוב מהמקור.</p>}

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

        {submitError && (
          <p className="form-error" role="alert">
            {submitError}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={saving}>
            {saving ? 'שומר…' : 'שמור'}
          </button>
          <button type="button" className="button" onClick={onClose} disabled={saving}>
            ביטול
          </button>
        </div>
      </form>
    </Dialog>
  )
}
