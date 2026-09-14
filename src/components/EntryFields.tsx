import { useId, type ReactNode, type Ref } from 'react'
import type { Category } from '../types/archive'
import { LIMITS, type EntryFormValues, type FormErrors } from '../utils/validation'

interface EntryFieldsProps {
  category: Category
  values: EntryFormValues
  errors: FormErrors
  onChange: (field: keyof EntryFormValues, value: string) => void
  contentRef?: Ref<HTMLTextAreaElement>
  /** Entries with images may have empty text. */
  contentOptional?: boolean
  /** Show the likes field even outside palindromes (entry already has likes). */
  forceLikes?: boolean
}

/** The fields shared by the add, add-many and edit dialogs. */
export function EntryFields({ category, values, errors, onChange, contentRef, contentOptional, forceLikes }: EntryFieldsProps) {
  const ids = { title: useId(), content: useId(), postedAt: useId(), author: useId(), likes: useId(), sourceUrl: useId() }
  const optional = <span className="field__optional">(לא חובה)</span>

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
  const bind = (name: keyof EntryFormValues) => ({
    value: values[name],
    onChange: (e: { target: { value: string } }) => onChange(name, e.target.value),
  })

  return (
    <>
      {field('title', <>כותרת {optional}</>, (p) => (
        <input {...p} {...bind('title')} type="text" maxLength={LIMITS.title} />
      ))}

      {field(
        'content',
        contentOptional ? <>תוכן {optional}</> : <>תוכן <span aria-hidden="true">*</span></>,
        (p) => (
          <textarea
            {...p}
            {...bind('content')}
            ref={contentRef}
            className="work-text"
            rows={9}
            required={!contentOptional}
            aria-required={!contentOptional}
            data-autofocus
          />
        ),
        contentOptional ? 'לפריט זה מצורפות תמונות, ולכן אפשר להשאיר את התוכן ריק.' : undefined,
      )}

      <div className="field-row">
        {field('postedAt', <>תאריך {optional}</>, (p) => (
          <input {...p} {...bind('postedAt')} type="date" />
        ))}
        {field('author', 'שם המחבר', (p) => (
          <input {...p} {...bind('author')} type="text" maxLength={LIMITS.author} />
        ))}
      </div>

      <div className="field-row">
        {(category === 'palindrome' || forceLikes) &&
          field('likes', <>מספר לייקים {optional}</>, (p) => (
            <input {...p} {...bind('likes')} type="text" inputMode="numeric" pattern="[0-9]*" dir="ltr" />
          ))}
        {field('sourceUrl', <>קישור למקור {optional}</>, (p) => (
          <input {...p} {...bind('sourceUrl')} type="url" dir="ltr" placeholder="https://" />
        ))}
      </div>
    </>
  )
}
