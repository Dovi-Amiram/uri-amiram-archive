import { DEFAULT_AUTHOR, type ArchiveEntry, type Category } from '../types/archive'

/** Must match the Worker's limits (worker/src/entry.ts). */
export const LIMITS = {
  title: 200,
  author: 100,
  content: 20000,
  sourceUrl: 500,
  likes: 10_000_000,
} as const

export interface EntryFormValues {
  title: string
  content: string
  /** YYYY-MM-DD from the date input, or '' */
  postedAt: string
  author: string
  /** Digits from the likes input, or '' */
  likes: string
  sourceUrl: string
}

export interface EntryPayload {
  category: Category
  title: string | null
  content: string
  postedAt: string | null
  author: string
  likes: number | null
  sourceUrl: string | null
}

export type FormErrors = Partial<Record<keyof EntryFormValues, string>>

export const emptyForm = (): EntryFormValues => ({ title: '', content: '', postedAt: '', author: DEFAULT_AUTHOR, likes: '', sourceUrl: '' })

/** Form values for editing an existing entry. */
export const formFromEntry = (entry: ArchiveEntry): EntryFormValues => ({
  title: entry.title ?? '',
  content: entry.content,
  postedAt: entry.postedAt ? entry.postedAt.slice(0, 10) : '',
  author: entry.author || DEFAULT_AUTHOR,
  likes: entry.likes === null ? '' : String(entry.likes),
  sourceUrl: entry.sourceUrl ?? '',
})

function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 1900 && y <= 2100
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function validateEntryForm(values: EntryFormValues, options: { allowEmptyContent?: boolean } = {}): FormErrors {
  const errors: FormErrors = {}
  if (!values.content.trim() && !options.allowEmptyContent) errors.content = 'יש להזין תוכן'
  else if (values.content.length > LIMITS.content) errors.content = `התוכן ארוך מדי (עד ${LIMITS.content.toLocaleString('he-IL')} תווים)`
  if (values.title.trim().length > LIMITS.title) errors.title = `הכותרת ארוכה מדי (עד ${LIMITS.title} תווים)`
  if (values.author.trim().length > LIMITS.author) errors.author = `שם המחבר ארוך מדי (עד ${LIMITS.author} תווים)`
  if (values.postedAt && !isValidDate(values.postedAt)) errors.postedAt = 'התאריך אינו תקין'
  const likes = values.likes.trim()
  if (likes && (!/^\d+$/.test(likes) || Number(likes) > LIMITS.likes)) errors.likes = 'יש להזין מספר שלם (0 ומעלה)'
  const url = values.sourceUrl.trim()
  if (url && (url.length > LIMITS.sourceUrl || !isHttpUrl(url))) errors.sourceUrl = 'יש להזין קישור מלא שמתחיל ב-https://'
  return errors
}

/**
 * Build the API payload. When editing, a date that was not changed keeps its original value,
 * including the time of day that the date input cannot show (e.g. Facebook post times).
 */
export function toPayload(values: EntryFormValues, category: Category, original?: ArchiveEntry): EntryPayload {
  const unchangedDate = original?.postedAt && values.postedAt === original.postedAt.slice(0, 10)
  const likes = values.likes.trim()
  return {
    category,
    title: values.title.trim() || null,
    // Keep the writer's line breaks and indentation; only trim blank edges.
    content: values.content.replace(/\r\n?/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, ''),
    postedAt: unchangedDate ? original.postedAt : values.postedAt || null,
    author: values.author.trim() || DEFAULT_AUTHOR,
    likes: likes ? Number(likes) : null,
    sourceUrl: values.sourceUrl.trim() || null,
  }
}
