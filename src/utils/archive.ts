import type { ArchiveEntry, Category, ImageAttachment, SortMode, Source } from '../types/archive'

const SOURCES: readonly Source[] = ['tzura', 'facebook', 'manual']
const CATEGORIES: readonly Category[] = ['creation', 'palindrome']

const isString = (v: unknown): v is string => typeof v === 'string'
const isNullableString = (v: unknown): v is string | null => v === null || v === undefined || typeof v === 'string'
const numberOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function parseAttachments(raw: unknown): ImageAttachment[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a) => {
    if (!a || typeof a !== 'object') return []
    const r = a as Record<string, unknown>
    // Only relative paths inside attachments/ are allowed.
    if (r.type !== 'image' || !isString(r.path) || !/^attachments\/[\w./-]+$/.test(r.path) || r.path.includes('..')) return []
    return [{ type: 'image' as const, path: r.path, width: numberOrNull(r.width), height: numberOrNull(r.height), alt: isString(r.alt) ? r.alt : null }]
  })
}

/** Validate one raw object from a generated index. Returns null when it is not a usable entry. */
export function parseEntry(raw: unknown): ArchiveEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isString(r.id) || !r.id) return null
  if (!SOURCES.includes(r.source as Source)) return null
  if (!CATEGORIES.includes(r.category as Category)) return null
  const attachments = parseAttachments(r.attachments)
  if (!isString(r.content) || (!r.content.trim() && attachments.length === 0)) return null
  for (const key of ['title', 'postedAt', 'sourceUrl', 'sourceId', 'scrapedAt'] as const) {
    if (!isNullableString(r[key])) return null
  }
  return {
    id: r.id,
    source: r.source as Source,
    category: r.category as Category,
    author: isString(r.author) && r.author ? r.author : 'אורי עמירם',
    title: (r.title as string | null | undefined) || null,
    content: r.content,
    postedAt: (r.postedAt as string | null | undefined) || null,
    sourceUrl: (r.sourceUrl as string | null | undefined) || null,
    sourceId: (r.sourceId as string | null | undefined) || null,
    scrapedAt: (r.scrapedAt as string | null | undefined) || null,
    createdAt: isString(r.createdAt) ? r.createdAt : '',
    updatedAt: isString(r.updatedAt) ? r.updatedAt : '',
    attachments,
    likes: typeof r.likes === 'number' && r.likes >= 0 ? r.likes : null,
  }
}

/** Parse a generated index file (an array of entries), skipping malformed items. */
export function parseArchive(json: unknown, category?: Category): ArchiveEntry[] {
  if (!Array.isArray(json)) throw new Error('archive index is not an array')
  const seen = new Set<string>()
  const entries: ArchiveEntry[] = []
  for (const raw of json) {
    const entry = parseEntry(raw)
    if (!entry || seen.has(entry.id) || (category && entry.category !== category)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries
}

const hebrewCollator = new Intl.Collator('he')

/** Dated entries by date (newest or oldest first), undated entries always afterwards. */
export function sortEntries(entries: readonly ArchiveEntry[], mode: SortMode): ArchiveEntry[] {
  const byTitle = (a: ArchiveEntry, b: ArchiveEntry) => {
    if (!a.title !== !b.title) return a.title ? -1 : 1
    return hebrewCollator.compare(a.title ?? '', b.title ?? '') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  }
  const list = [...entries]
  if (mode === 'title') return list.sort(byTitle)
  if (mode === 'likes') {
    const newestFirst = sortEntries(entries, 'newest')
    const rank = new Map(newestFirst.map((e, i) => [e.id, i]))
    // Most reactions first; entries without a count last; ties keep newest-first order.
    return list.sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1) || rank.get(a.id)! - rank.get(b.id)!)
  }
  const direction = mode === 'newest' ? -1 : 1
  return list.sort((a, b) => {
    if (a.postedAt && b.postedAt) {
      return direction * a.postedAt.localeCompare(b.postedAt) || a.id.localeCompare(b.id)
    }
    if (a.postedAt || b.postedAt) return a.postedAt ? -1 : 1
    return byTitle(a, b)
  })
}

// Hebrew cantillation + niqqud marks, so "הנכסף" finds "הנִכסף".
const HEBREW_MARKS = /[\u0591-\u05C7]/g
// Hebrew geresh/gershayim and quote variants are treated alike.
const QUOTES = /[\u05F3'`\u00B4]/g
const DOUBLE_QUOTES = /[\u05F4"\u201C\u201D\u201E]/g

export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(HEBREW_MARKS, '')
    .replace(QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every whitespace-separated term must appear in the title or the content. */
export function searchEntries(entries: readonly ArchiveEntry[], query: string): ArchiveEntry[] {
  const terms = normalizeForSearch(query).split(' ').filter(Boolean)
  if (terms.length === 0) return [...entries]
  return entries.filter((entry) => {
    const haystack = normalizeForSearch(`${entry.title ?? ''}\n${entry.content}`)
    return terms.every((term) => haystack.includes(term))
  })
}

/** Israeli-style date, e.g. 26.8.2003. Plain dates are shown without timezone shifts. */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return `${Number(d)}.${Number(m)}.${y}`
  }
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Jerusalem' }).format(parsed)
}

export interface Preview {
  text: string
  truncated: boolean
}

/** First lines of a work for the listing, cut at a stanza/line boundary where possible. */
export function makePreview(content: string, maxLines = 8, maxChars = 420): Preview {
  const lines = content.split('\n')
  let text = lines.slice(0, maxLines).join('\n')
  let truncated = lines.length > maxLines
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars)
    const lastSpace = cut.lastIndexOf(' ')
    text = `${cut.slice(0, lastSpace > maxChars * 0.6 ? lastSpace : maxChars)}`
    truncated = true
  }
  return { text: text.replace(/\s+$/, ''), truncated }
}
