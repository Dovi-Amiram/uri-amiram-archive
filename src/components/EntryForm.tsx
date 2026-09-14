import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ArchiveEntry, SectionInfo } from '../types/archive'
import { createEntry, isSessionValid, isWriteApiConfigured, updateEntry, type SessionToken } from '../utils/api'
import { parseEntry } from '../utils/archive'
import { WrongPasswordError, withSession } from '../utils/session'
import { emptyForm, formFromEntry, LIMITS, toPayload, validateEntryForm, type EntryFormValues, type FormErrors } from '../utils/validation'
import { Dialog } from './Dialog'
import { PasswordField } from './PasswordField'

interface EntryFormProps {
  section: SectionInfo
  /** Present when editing an existing entry. */
  entry?: ArchiveEntry
  session: SessionToken | null
  onSession: (session: SessionToken | null) => void
  onClose: () => void
  onSaved: (entry: ArchiveEntry, kind: 'create' | 'update') => void
}

export function EntryForm({ section, entry, session, onSession, onClose, onSaved }: EntryFormProps) {
  const editing = !!entry
  const hasImages = !!entry && entry.attachments.length > 0
  const [values, setValues] = useState<EntryFormValues>(() => (entry ? formFromEntry(entry) : emptyForm()))
  const [errors, setErrors] = useState<FormErrors>({})
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const needsPassword = !isSessionValid(session)
  const ids = {
    title: useId(),
    content: useId(),
    postedAt: useId(),
    author: useId(),
    likes: useId(),
    sourceUrl: useId(),
  }
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const showLikes = section.category === 'palindrome' || (entry?.likes ?? null) !== null

  const update = (field: keyof EntryFormValues) => (event: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [field]: event.target.value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

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
      const payload = toPayload(values, section.category, entry)
      const result = await withSession(session, password, onSession, (token) =>
        entry ? updateEntry(token, entry.id, payload) : createEntry(token, payload),
      )
      const saved = parseEntry(result.entry)
      if (!saved) throw new Error('אירעה שגיאה')
      onSaved(saved, editing ? 'update' : 'create')
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

  const title = editing ? section.editLabel : section.addLabel

  if (!isWriteApiConfigured()) {
    return (
      <Dialog title={title} onClose={onClose}>
        <p className="form-note">עריכת פריטים עדיין אינה זמינה באתר זה.</p>
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            סגירה
          </button>
        </div>
      </Dialog>
    )
  }

  const field = (
    name: keyof EntryFormValues,
    label: ReactNode,
    input: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode,
    hint?: string,
  ) => {
    const id = ids[name]
    const describedBy = [errors[name] ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        {input({ id, 'aria-invalid': !!errors[name], 'aria-describedby': describedBy })}
        {hint && (
          <p className="field__hint" id={`${id}-hint`}>
            {hint}
          </p>
        )}
        {errors[name] && (
          <p className="field__error" id={`${id}-error`}>
            {errors[name]}
          </p>
        )}
      </div>
    )
  }
  const optional = <span className="field__optional">(לא חובה)</span>

  return (
    <Dialog title={title} onClose={onClose} className="dialog--form">
      <form className="entry-form" onSubmit={handleSubmit} noValidate>
        {field('title', <>כותרת {optional}</>, (p) => (
          <input {...p} type="text" value={values.title} onChange={update('title')} maxLength={LIMITS.title} />
        ))}

        {field(
          'content',
          hasImages ? <>תוכן {optional}</> : <>תוכן <span aria-hidden="true">*</span></>,
          (p) => (
            <textarea
              {...p}
              ref={contentRef}
              className="work-text"
              value={values.content}
              onChange={update('content')}
              rows={10}
              required={!hasImages}
              aria-required={!hasImages}
              data-autofocus
            />
          ),
          hasImages ? 'לפריט זה מצורפות תמונות, ולכן אפשר להשאיר את התוכן ריק.' : undefined,
        )}

        <div className="field-row">
          {field('postedAt', <>תאריך {optional}</>, (p) => (
            <input {...p} type="date" value={values.postedAt} onChange={update('postedAt')} />
          ))}
          {field('author', 'שם המחבר', (p) => (
            <input {...p} type="text" value={values.author} onChange={update('author')} maxLength={LIMITS.author} />
          ))}
        </div>

        <div className="field-row">
          {showLikes &&
            field('likes', <>מספר לייקים {optional}</>, (p) => (
              <input {...p} type="text" inputMode="numeric" pattern="[0-9]*" dir="ltr" value={values.likes} onChange={update('likes')} />
            ))}
          {field('sourceUrl', <>קישור למקור {optional}</>, (p) => (
            <input {...p} type="url" dir="ltr" placeholder="https://" value={values.sourceUrl} onChange={update('sourceUrl')} />
          ))}
        </div>

        {editing && entry.source !== 'manual' && (
          <p className="form-note">שדות שישונו כאן יישמרו גם אם הנתונים ייאספו שוב מהמקור.</p>
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
