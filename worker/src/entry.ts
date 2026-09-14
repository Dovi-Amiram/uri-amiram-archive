/** Validation and construction of manual archive entries (mirrors scrapers/archive_utils.py). */

export type Category = 'creation' | 'palindrome'

export const CATEGORY_DIRS: Record<Category, string> = {
  creation: 'creations',
  palindrome: 'palindromes',
}

export const DEFAULT_AUTHOR = 'אורי עמירם'

/** Keep in sync with src/utils/validation.ts in the frontend. */
export const LIMITS = {
  bodyBytes: 64 * 1024,
  title: 200,
  author: 100,
  content: 20000,
}

export interface ArchiveEntry {
  id: string
  source: 'manual'
  category: Category
  author: string
  title: string | null
  content: string
  postedAt: string | null
  sourceUrl: null
  sourceId: null
  scrapedAt: null
  createdAt: string
  updatedAt: string
  attachments: []
}

export interface ValidInput {
  category: Category
  title: string | null
  content: string
  postedAt: string | null
  author: string
}

export type ValidationResult = { ok: true; value: ValidInput } | { ok: false; error: string }

// Control characters except tab (\x09) and newline (\x0A).
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u007F]/g

/** Same rules as the Python normalize_content: keep inner layout, trim blank edges. */
export function normalizeContent(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.join('\n')
}

export function normalizeSingleLine(text: string): string {
  return text.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim()
}

function isValidPostedAt(value: string): boolean {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const [y, m, d] = [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])]
    const date = new Date(Date.UTC(y, m - 1, d))
    return y >= 1900 && y <= 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
}

export function validateInput(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'גוף הבקשה אינו תקין' }
  const b = body as Record<string, unknown>

  if (b.category !== 'creation' && b.category !== 'palindrome') return { ok: false, error: 'קטגוריה לא תקינה' }

  if (typeof b.content !== 'string') return { ok: false, error: 'יש להזין תוכן' }
  const content = normalizeContent(b.content)
  if (!content) return { ok: false, error: 'יש להזין תוכן' }
  if (content.length > LIMITS.content) return { ok: false, error: 'התוכן ארוך מדי' }

  if (b.title !== undefined && b.title !== null && typeof b.title !== 'string') return { ok: false, error: 'כותרת לא תקינה' }
  const title = typeof b.title === 'string' ? normalizeSingleLine(b.title) || null : null
  if (title && title.length > LIMITS.title) return { ok: false, error: 'הכותרת ארוכה מדי' }

  if (b.author !== undefined && b.author !== null && typeof b.author !== 'string') return { ok: false, error: 'שם מחבר לא תקין' }
  const author = (typeof b.author === 'string' && normalizeSingleLine(b.author)) || DEFAULT_AUTHOR
  if (author.length > LIMITS.author) return { ok: false, error: 'שם המחבר ארוך מדי' }

  let postedAt: string | null = null
  if (b.postedAt !== undefined && b.postedAt !== null && b.postedAt !== '') {
    if (typeof b.postedAt !== 'string' || !isValidPostedAt(b.postedAt)) return { ok: false, error: 'תאריך לא תקין' }
    postedAt = b.postedAt
  }

  return { ok: true, value: { category: b.category, title, content, postedAt, author } }
}

export function buildEntry(input: ValidInput, uuid: string, now: Date): ArchiveEntry {
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return {
    id: `manual-${uuid}`,
    source: 'manual',
    category: input.category,
    author: input.author,
    title: input.title,
    content: input.content,
    postedAt: input.postedAt,
    sourceUrl: null,
    sourceId: null,
    scrapedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    attachments: [],
  }
}

export const entryPath = (entry: ArchiveEntry) => `archive/${CATEGORY_DIRS[entry.category]}/${entry.id}.json`

export function commitMessage(entry: ArchiveEntry): string {
  const kind = entry.category === 'creation' ? 'creation' : 'palindrome'
  if (!entry.title) return `Add ${kind} entry`
  const title = entry.title.length > 72 ? `${entry.title.slice(0, 69)}...` : entry.title
  return `Add ${kind}: ${title}`
}

/** Pretty JSON with readable Hebrew and a trailing newline, like the Python writer. */
export const serializeEntry = (entry: ArchiveEntry) => `${JSON.stringify(entry, null, 2)}\n`
