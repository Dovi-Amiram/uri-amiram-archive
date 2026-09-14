import { useEffect, useRef, useState } from 'react'
import { DEFAULT_AUTHOR, sectionFor, type ArchiveEntry, type SectionInfo } from '../types/archive'
import { createEntries, isSessionValid, isWriteApiConfigured, type SessionToken } from '../utils/api'
import { formatDate, makePreview, parseEntry } from '../utils/archive'
import { isFormBlank, loadDrafts, loadWorkingForm, MAX_BATCH, newDraftKey, saveDrafts, saveWorkingForm, type Draft } from '../utils/drafts'
import { WrongPasswordError, withSession } from '../utils/session'
import { emptyForm, toPayload, validateEntryForm, type EntryFormValues, type FormErrors } from '../utils/validation'
import { Dialog } from './Dialog'
import { EntryFields } from './EntryFields'
import { PasswordField } from './PasswordField'

interface AddEntriesDialogProps {
  /** Tab the dialog was opened from: new items get this category. */
  section: SectionInfo
  session: SessionToken | null
  onSession: (session: SessionToken | null) => void
  onClose: () => void
  onSaved: (entries: ArchiveEntry[]) => void
}

/**
 * Add one or many entries. "הוסף עוד פריט" moves the filled form into a list of drafts; the
 * review screen shows everything, and "שמור הכל" saves all of them in ONE commit.
 */
export function AddEntriesDialog({ section, session, onSession, onClose, onSaved }: AddEntriesDialogProps) {
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts())
  // An unfinished form (e.g. after an accidental reload) reopens in the form view.
  const [values, setValues] = useState<EntryFormValues>(() => loadWorkingForm() ?? emptyForm())
  const [view, setView] = useState<'form' | 'review'>(() => (loadDrafts().length > 0 && !loadWorkingForm() ? 'review' : 'form'))
  /** Draft being edited from the review screen, if any. */
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const needsPassword = !isSessionValid(session)

  useEffect(() => saveDrafts(drafts), [drafts])
  // Only new items are auto-saved; edits of a listed item already live in the list.
  useEffect(() => {
    if (!editingKey) saveWorkingForm(values)
  }, [values, editingKey])

  const editingDraft = editingKey ? drafts.find((d) => d.key === editingKey) : undefined
  const formCategory = editingDraft?.category ?? section.category

  const change = (field: keyof EntryFormValues, value: string) => {
    setValues((v) => ({ ...v, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
    setNotice(null)
  }

  /** Validate the form and put it into the draft list. Returns false when invalid. */
  function commitFormToDrafts(): boolean {
    const found = validateEntryForm(values)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      contentRef.current?.focus()
      return false
    }
    if (editingKey) {
      setDrafts((list) => list.map((d) => (d.key === editingKey ? { ...d, values } : d)))
    } else {
      if (drafts.length >= MAX_BATCH) {
        setErrors({ content: `אפשר לשמור עד ${MAX_BATCH} פריטים בבת אחת. שמרו את הרשימה והמשיכו אחר כך.` })
        return false
      }
      setDrafts((list) => [...list, { key: newDraftKey(), category: section.category, values }])
    }
    return true
  }

  function resetForm() {
    // Keep the author: a batch is usually by the same person.
    setValues({ ...emptyForm(), author: values.author || DEFAULT_AUTHOR })
    setEditingKey(null)
    setErrors({})
  }

  function addAnother() {
    if (!isFormBlank(values) || editingKey) {
      if (!commitFormToDrafts()) return
      setNotice(editingKey ? 'הפריט עודכן ברשימה.' : `הפריט נוסף לרשימה (${drafts.length + 1}). אפשר למלא את הפריט הבא.`)
    }
    resetForm()
    setView('form')
    requestAnimationFrame(() => contentRef.current?.focus())
  }

  function goToReview() {
    if (!isFormBlank(values) || editingKey) {
      if (!commitFormToDrafts()) return
    }
    resetForm()
    setNotice(null)
    setView('review')
  }

  function editDraft(draft: Draft) {
    setValues(draft.values)
    setEditingKey(draft.key)
    setErrors({})
    setNotice(null)
    setView('form')
  }

  async function saveAll(items: Draft[]) {
    setSubmitError(null)
    if (items.length === 0) return
    if (needsPassword && !password) {
      setPasswordError('יש להזין סיסמה')
      passwordRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      const payloads = items.map((d) => toPayload(d.values, d.category))
      const result = await withSession(session, password, onSession, (token) => createEntries(token, payloads))
      const saved = result.entries.map(parseEntry).filter((e): e is ArchiveEntry => e !== null)
      setDrafts([])
      saveDrafts([])
      setValues(emptyForm())
      saveWorkingForm(null)
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

  /** "שמור" on the form with an empty list: save just this one item. */
  function saveSingle() {
    const found = validateEntryForm(values)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      contentRef.current?.focus()
      return
    }
    void saveAll([{ key: 'single', category: section.category, values }])
  }

  if (!isWriteApiConfigured()) {
    return (
      <Dialog title={section.addLabel} onClose={onClose}>
        <p className="form-note">הוספת פריטים עדיין אינה זמינה באתר זה.</p>
      </Dialog>
    )
  }

  const passwordField = needsPassword && (
    <PasswordField
      ref={passwordRef}
      value={password}
      error={passwordError}
      onChange={(v) => {
        setPassword(v)
        setPasswordError(null)
      }}
    />
  )
  const errorBox = submitError && (
    <p className="form-error" role="alert">
      {submitError}
    </p>
  )
  const mixedCategories = new Set(drafts.map((d) => d.category)).size > 1

  if (view === 'review') {
    return (
      <Dialog title={`סקירה לפני שמירה (${drafts.length})`} onClose={onClose} className="dialog--form">
        {drafts.length === 0 ? (
          <p className="form-note">אין פריטים ברשימה.</p>
        ) : (
          <>
            <p className="form-note">בדקו את הפריטים. כולם יישמרו יחד, בפעולה אחת.</p>
            <ol className="draft-list">
              {drafts.map((draft, index) => {
                const preview = makePreview(draft.values.content, 3, 180)
                const date = formatDate(draft.values.postedAt || null)
                return (
                  <li key={draft.key} className="draft">
                    <div className="draft__body">
                      <p className="draft__heading">
                        <span className="draft__index">{index + 1}.</span>
                        {draft.values.title.trim() ? <strong>{draft.values.title.trim()}</strong> : <span className="draft__untitled">ללא כותרת</span>}
                        {mixedCategories && <span className="badge">{sectionFor(draft.category).label}</span>}
                      </p>
                      <p className="draft__meta">
                        {date && <span>{date}</span>}
                        {draft.values.likes.trim() && <span>👍 {draft.values.likes.trim()}</span>}
                        {draft.values.author.trim() && draft.values.author.trim() !== DEFAULT_AUTHOR && <span>{draft.values.author.trim()}</span>}
                        {draft.values.sourceUrl.trim() && <span>קישור למקור</span>}
                      </p>
                      <p className="draft__preview work-text">
                        {preview.text}
                        {preview.truncated && '…'}
                      </p>
                    </div>
                    <div className="draft__actions">
                      <button type="button" className="button button--small" onClick={() => editDraft(draft)}>
                        עריכה
                      </button>
                      <button
                        type="button"
                        className="button button--small button--danger-outline"
                        onClick={() => setDrafts((list) => list.filter((d) => d.key !== draft.key))}
                        aria-label={`הסרה מהרשימה: פריט ${index + 1}`}
                      >
                        הסרה
                      </button>
                    </div>
                  </li>
                )
              })}
            </ol>
            {passwordField}
          </>
        )}
        {errorBox}
        <div className="form-actions">
          {drafts.length > 0 && (
            <button type="button" className="button button--primary" onClick={() => void saveAll(drafts)} disabled={saving}>
              {saving ? 'שומר…' : `שמור הכל (${drafts.length})`}
            </button>
          )}
          <button type="button" className="button" onClick={addAnother} disabled={saving || drafts.length >= MAX_BATCH} data-autofocus>
            ＋ הוסף עוד פריט
          </button>
          <button type="button" className="button" onClick={onClose} disabled={saving}>
            סגירה
          </button>
        </div>
        {drafts.length > 0 && <p className="field__hint">הרשימה נשמרת בדפדפן זה עד לשמירה, גם אם החלון נסגר.</p>}
      </Dialog>
    )
  }

  const hasDrafts = drafts.length > 0
  return (
    <Dialog
      title={editingKey ? 'עריכת פריט ברשימה' : hasDrafts ? `${section.addLabel} (פריט ${drafts.length + 1})` : section.addLabel}
      onClose={onClose}
      className="dialog--form"
    >
      <form
        className="entry-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (hasDrafts || editingKey) goToReview()
          else saveSingle()
        }}
      >
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <EntryFields category={formCategory} values={values} errors={errors} onChange={change} contentRef={contentRef} />
        {!hasDrafts && !editingKey && passwordField}
        {errorBox}
        <div className="form-actions">
          {editingKey ? (
            <button type="submit" className="button button--primary">
              עדכון ברשימה
            </button>
          ) : hasDrafts ? (
            <button type="submit" className="button button--primary">
              סקירה ושמירה ({drafts.length + (isFormBlank(values) ? 0 : 1)})
            </button>
          ) : (
            <button type="submit" className="button button--primary" disabled={saving}>
              {saving ? 'שומר…' : 'שמור'}
            </button>
          )}
          {!editingKey && (
            <button type="button" className="button" onClick={addAnother} disabled={saving}>
              ＋ הוסף עוד פריט
            </button>
          )}
          <button
            type="button"
            className="button"
            onClick={() => {
              if (editingKey) {
                resetForm()
                setView('review')
              } else if (hasDrafts && isFormBlank(values)) {
                setView('review')
              } else {
                // "ביטול" discards the item being typed (closing with × keeps it for later).
                saveWorkingForm(null)
                onClose()
              }
            }}
            disabled={saving}
          >
            {editingKey || (hasDrafts && isFormBlank(values)) ? 'חזרה לרשימה' : 'ביטול'}
          </button>
        </div>
        {!hasDrafts && !editingKey && <p className="field__hint">רוצים להוסיף כמה פריטים? לחצו „הוסף עוד פריט״, ובסוף שומרים את כולם יחד.</p>}
      </form>
    </Dialog>
  )
}
