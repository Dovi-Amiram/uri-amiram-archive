import { useId, useRef, useState, type FormEvent } from 'react'
import type { ArchiveEntry, SectionInfo } from '../types/archive'
import { ApiError, createEntry, isWriteApiConfigured, login, type SessionToken } from '../utils/api'
import { parseEntry } from '../utils/archive'
import { emptyForm, LIMITS, toPayload, validateEntryForm, type EntryFormValues, type FormErrors } from '../utils/validation'
import { Dialog } from './Dialog'

interface EntryFormProps {
  section: SectionInfo
  /** Short-lived session token, kept only in memory (never localStorage). */
  session: SessionToken | null
  onSession: (session: SessionToken | null) => void
  onClose: () => void
  onSaved: (entry: ArchiveEntry) => void
}

const isSessionValid = (s: SessionToken | null) => !!s && s.expiresAt - 30_000 > Date.now()

export function EntryForm({ section, session, onSession, onClose, onSaved }: EntryFormProps) {
  const [values, setValues] = useState<EntryFormValues>(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const needsPassword = !isSessionValid(session)
  const ids = { title: useId(), content: useId(), postedAt: useId(), author: useId(), password: useId() }
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const update = (field: keyof EntryFormValues) => (event: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [field]: event.target.value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitError(null)
    const found = validateEntryForm(values)
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
      let active = session
      if (needsPassword) {
        try {
          active = await login(password)
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            setPasswordError('הסיסמה שגויה')
            passwordRef.current?.focus()
            return
          }
          throw err
        }
        onSession(active)
        setPassword('')
      }
      const result = await createEntry(active!.token, toPayload(values, section.category))
      const saved = parseEntry(result.entry)
      if (!saved) throw new Error('אירעה שגיאה')
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSession(null) // session expired: ask for the password again
        setSubmitError('פג תוקף ההתחברות. יש להזין את הסיסמה שוב.')
      } else {
        setSubmitError(err instanceof Error ? err.message : 'אירעה שגיאה')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isWriteApiConfigured()) {
    return (
      <Dialog title={section.addLabel} onClose={onClose}>
        <p className="form-note">הוספת פריטים עדיין אינה זמינה באתר זה.</p>
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            סגירה
          </button>
        </div>
      </Dialog>
    )
  }

  const describedBy = (field: keyof EntryFormValues, hint?: string) =>
    [errors[field] ? `${ids[field]}-error` : null, hint].filter(Boolean).join(' ') || undefined

  return (
    <Dialog title={section.addLabel} onClose={onClose} className="dialog--form">
      <form className="entry-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor={ids.title}>
            כותרת <span className="field__optional">(לא חובה)</span>
          </label>
          <input
            id={ids.title}
            type="text"
            value={values.title}
            onChange={update('title')}
            maxLength={LIMITS.title}
            aria-invalid={!!errors.title}
            aria-describedby={describedBy('title')}
          />
          {errors.title && <p className="field__error" id={`${ids.title}-error`}>{errors.title}</p>}
        </div>

        <div className="field">
          <label htmlFor={ids.content}>
            תוכן <span aria-hidden="true">*</span>
          </label>
          <textarea
            id={ids.content}
            ref={contentRef}
            className="work-text"
            value={values.content}
            onChange={update('content')}
            rows={10}
            required
            aria-required="true"
            aria-invalid={!!errors.content}
            aria-describedby={describedBy('content')}
            autoFocus
          />
          {errors.content && <p className="field__error" id={`${ids.content}-error`}>{errors.content}</p>}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={ids.postedAt}>
              תאריך <span className="field__optional">(לא חובה)</span>
            </label>
            <input
              id={ids.postedAt}
              type="date"
              value={values.postedAt}
              onChange={update('postedAt')}
              aria-invalid={!!errors.postedAt}
              aria-describedby={describedBy('postedAt')}
            />
            {errors.postedAt && <p className="field__error" id={`${ids.postedAt}-error`}>{errors.postedAt}</p>}
          </div>
          <div className="field">
            <label htmlFor={ids.author}>שם המחבר</label>
            <input
              id={ids.author}
              type="text"
              value={values.author}
              onChange={update('author')}
              maxLength={LIMITS.author}
              aria-invalid={!!errors.author}
              aria-describedby={describedBy('author')}
            />
            {errors.author && <p className="field__error" id={`${ids.author}-error`}>{errors.author}</p>}
          </div>
        </div>

        {needsPassword && (
          <div className="field field--password">
            <label htmlFor={ids.password}>סיסמת עריכה</label>
            <input
              id={ids.password}
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setPasswordError(null)
              }}
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? `${ids.password}-error` : undefined}
            />
            {passwordError && <p className="field__error" id={`${ids.password}-error`}>{passwordError}</p>}
          </div>
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
