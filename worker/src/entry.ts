/** Validation and construction of archive entries (mirrors scrapers/archive_utils.py). */

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
  sourceUrl: 500,
  likes: 10_000_000,
}

/** Fields a person can set on the website. Scrapers never overwrite fields listed in editedFields. */
export const EDITABLE_FIELDS = ['title', 'content', 'postedAt', 'author', 'likes', 'sourceUrl'] as const
export type EditableField = (typeof EDITABLE_FIELDS)[number]

export interface ArchiveEntry {
  id: string
  source: 'tzura' | 'facebook' | 'manual'
  category: Category
  author: string
  title: string | null
  content: string
  postedAt: string | null
  sourceUrl: string | null
  sourceId: string | null
  scrapedAt: string | null
  createdAt: string
  updatedAt: string
  attachments: { type: 'image'; path: string; [key: string]: unknown }[]
  likes?: number
  editedAt?: string
  editedFields?: EditableField[]
  [key: string]: unknown
}

export interface ValidInput {
  category: Category
  title: string | null
  content: string
  postedAt: string | null
  author: string
  likes: number | null
  sourceUrl: string | null
}

export type ValidationResult = { ok: true; value: ValidInput } | { ok: false; error: string }

// Control characters except tab (\x09) and newline (\x0A).
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u007F]/g

export const ENTRY_ID = /^(tzura|facebook|manual)-[A-Za-z0-9_-]{1,120}$/

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

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const isBlank = (v: unknown) => v === undefined || v === null || v === ''

/**
 * Validate a create/edit payload. `allowEmptyContent` is used when editing an entry that has
 * images (an image-only Facebook post legitimately has no text).
 */
export function validateInput(body: unknown, options: { allowEmptyContent?: boolean } = {}): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'גוף הבקשה אינו תקין' }
  const b = body as Record<string, unknown>

  if (b.category !== 'creation' && b.category !== 'palindrome') return { ok: false, error: 'קטגוריה לא תקינה' }

  if (typeof b.content !== 'string') return { ok: false, error: 'יש להזין תוכן' }
  const content = normalizeContent(b.content)
  if (!content && !options.allowEmptyContent) return { ok: false, error: 'יש להזין תוכן' }
  if (content.length > LIMITS.content) return { ok: false, error: 'התוכן ארוך מדי' }

  if (!isBlank(b.title) && typeof b.title !== 'string') return { ok: false, error: 'כותרת לא תקינה' }
  const title = typeof b.title === 'string' ? normalizeSingleLine(b.title) || null : null
  if (title && title.length > LIMITS.title) return { ok: false, error: 'הכותרת ארוכה מדי' }

  if (!isBlank(b.author) && typeof b.author !== 'string') return { ok: false, error: 'שם מחבר לא תקין' }
  const author = (typeof b.author === 'string' && normalizeSingleLine(b.author)) || DEFAULT_AUTHOR
  if (author.length > LIMITS.author) return { ok: false, error: 'שם המחבר ארוך מדי' }

  let postedAt: string | null = null
  if (!isBlank(b.postedAt)) {
    if (typeof b.postedAt !== 'string' || !isValidPostedAt(b.postedAt)) return { ok: false, error: 'תאריך לא תקין' }
    postedAt = b.postedAt
  }

  let likes: number | null = null
  if (!isBlank(b.likes)) {
    if (typeof b.likes !== 'number' || !Number.isInteger(b.likes) || b.likes < 0 || b.likes > LIMITS.likes) {
      return { ok: false, error: 'מספר הלייקים אינו תקין' }
    }
    likes = b.likes
  }

  let sourceUrl: string | null = null
  if (!isBlank(b.sourceUrl)) {
    if (typeof b.sourceUrl !== 'string') return { ok: false, error: 'קישור המקור אינו תקין' }
    const trimmed = b.sourceUrl.trim()
    if (trimmed.length > LIMITS.sourceUrl || !isValidHttpUrl(trimmed)) return { ok: false, error: 'קישור המקור אינו תקין' }
    sourceUrl = trimmed
  }

  return { ok: true, value: { category: b.category, title, content, postedAt, author, likes, sourceUrl } }
}

export const isoNow = (now: Date) => now.toISOString().replace(/\.\d{3}Z$/, 'Z')

export function buildEntry(input: ValidInput, uuid: string, now: Date): ArchiveEntry {
  const timestamp = isoNow(now)
  const entry: ArchiveEntry = {
    id: `manual-${uuid}`,
    source: 'manual',
    category: input.category,
    author: input.author,
    title: input.title,
    content: input.content,
    postedAt: input.postedAt,
    sourceUrl: input.sourceUrl,
    sourceId: null,
    scrapedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    attachments: [],
  }
  if (input.likes !== null) entry.likes = input.likes
  return entry
}

/** Minimal shape check for an entry file read back from the repository. */
export function parseStoredEntry(text: string): ArchiveEntry | null {
  try {
    const value = JSON.parse(text) as Partial<ArchiveEntry>
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.content !== 'string') return null
    if (value.category !== 'creation' && value.category !== 'palindrome') return null
    return { attachments: [], ...value } as ArchiveEntry
  } catch {
    return null
  }
}

/**
 * Apply an edit. Only editable fields change; id, source, sourceId, attachments, createdAt, etc.
 * are kept. Changed fields are added to `editedFields` so scrapers will not overwrite them.
 */
export function applyEdit(existing: ArchiveEntry, input: ValidInput, now: Date): { entry: ArchiveEntry; changed: EditableField[] } {
  const next: Record<EditableField, unknown> = {
    title: input.title,
    content: input.content,
    postedAt: input.postedAt,
    author: input.author,
    likes: input.likes,
    sourceUrl: input.sourceUrl,
  }
  const current = (field: EditableField) => (field === 'likes' ? (existing.likes ?? null) : (existing[field] ?? null))
  const changed = EDITABLE_FIELDS.filter((field) => next[field] !== current(field))
  if (changed.length === 0) return { entry: existing, changed }

  const entry: ArchiveEntry = { ...existing }
  for (const field of changed) {
    if (field === 'likes') {
      if (input.likes === null) delete entry.likes
      else entry.likes = input.likes
    } else {
      ;(entry as Record<string, unknown>)[field] = next[field]
    }
  }
  const timestamp = isoNow(now)
  entry.updatedAt = timestamp
  entry.editedAt = timestamp
  entry.editedFields = EDITABLE_FIELDS.filter((f) => changed.includes(f) || existing.editedFields?.includes(f))
  return { entry, changed }
}

export const entryPath = (entry: Pick<ArchiveEntry, 'id' | 'category'>) => `archive/${CATEGORY_DIRS[entry.category]}/${entry.id}.json`

/** Raw source snapshot stored next to scraped entries, if any. */
export function rawSnapshotPath(entry: ArchiveEntry): string | null {
  if (entry.source === 'tzura') return `archive/raw/tzura/${entry.id}.html`
  if (entry.source === 'facebook') return `archive/raw/facebook/${entry.id}.json`
  return null
}

const kindLabel = (category: Category) => (category === 'creation' ? 'creation' : 'palindrome')
const shortTitle = (title: string) => (title.length > 72 ? `${title.slice(0, 69)}...` : title)

export function commitMessage(entry: ArchiveEntry, action: 'Add' | 'Edit' | 'Delete' = 'Add'): string {
  const kind = kindLabel(entry.category)
  if (entry.title) return `${action} ${kind}: ${shortTitle(entry.title)}`
  return action === 'Add' ? `Add ${kind} entry` : `${action} ${kind} entry ${entry.id}`
}

export interface Exclusion {
  id: string
  source: string
  sourceId: string | null
  deletedAt: string
  title: string | null
}

/**
 * archive/excluded.json lists deleted scraped items so scrapers never re-add them.
 * Returns the updated file text (or null when the entry was manual and needs no record).
 */
export function addExclusion(existingText: string | null, entry: ArchiveEntry, now: Date): string | null {
  if (entry.source === 'manual') return null
  let data: { entries: Exclusion[] } = { entries: [] }
  if (existingText) {
    try {
      const parsed = JSON.parse(existingText) as { entries?: unknown }
      if (Array.isArray(parsed.entries)) data = { entries: parsed.entries as Exclusion[] }
    } catch {
      // A corrupt file is replaced; git history keeps the old one.
    }
  }
  if (!data.entries.some((e) => e.id === entry.id)) {
    data.entries.push({ id: entry.id, source: entry.source, sourceId: entry.sourceId, deletedAt: isoNow(now), title: entry.title })
  }
  data.entries.sort((a, b) => a.id.localeCompare(b.id))
  return `${JSON.stringify(data, null, 2)}\n`
}

/** Pretty JSON with readable Hebrew and a trailing newline, like the Python writer. */
export const serializeEntry = (entry: ArchiveEntry) => `${JSON.stringify(entry, null, 2)}\n`
