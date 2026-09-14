import { DEFAULT_AUTHOR, type Category } from '../types/archive'

/** Must match the Worker's limits (worker/src/entry.ts). */
export const LIMITS = {
  title: 200,
  author: 100,
  content: 20000,
} as const

export interface EntryFormValues {
  title: string
  content: string
  postedAt: string
  author: string
}

export interface NewEntryPayload {
  category: Category
  title: string | null
  content: string
  postedAt: string | null
  author: string
}

export type FormErrors = Partial<Record<keyof EntryFormValues, string>>

export const emptyForm = (): EntryFormValues => ({ title: '', content: '', postedAt: '', author: DEFAULT_AUTHOR })

function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 1900 && y <= 2100
}

export function validateEntryForm(values: EntryFormValues): FormErrors {
  const errors: FormErrors = {}
  if (!values.content.trim()) errors.content = 'יש להזין תוכן'
  else if (values.content.length > LIMITS.content) errors.content = `התוכן ארוך מדי (עד ${LIMITS.content.toLocaleString('he-IL')} תווים)`
  if (values.title.trim().length > LIMITS.title) errors.title = `הכותרת ארוכה מדי (עד ${LIMITS.title} תווים)`
  if (values.author.trim().length > LIMITS.author) errors.author = `שם המחבר ארוך מדי (עד ${LIMITS.author} תווים)`
  if (values.postedAt && !isValidDate(values.postedAt)) errors.postedAt = 'התאריך אינו תקין'
  return errors
}

export function toPayload(values: EntryFormValues, category: Category): NewEntryPayload {
  return {
    category,
    title: values.title.trim() || null,
    // Keep the writer's line breaks and indentation; only trim blank edges.
    content: values.content.replace(/\r\n?/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, ''),
    postedAt: values.postedAt || null,
    author: values.author.trim() || DEFAULT_AUTHOR,
  }
}
