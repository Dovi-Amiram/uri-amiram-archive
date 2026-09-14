import type { Category } from '../types/archive'
import type { EntryFormValues } from './validation'

/** A new entry filled in but not saved yet. */
export interface Draft {
  key: string
  category: Category
  values: EntryFormValues
}

export const MAX_BATCH = 30
const STORAGE_KEY = 'uri-amiram-archive:drafts:v1'
const WORKING_KEY = 'uri-amiram-archive:working-form:v1'

/**
 * Drafts are kept in localStorage so typed songs survive a closed tab or a crash until they are
 * saved. They contain only the texts being added (never the password or session).
 */
export function loadDrafts(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Draft[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (d): d is Draft =>
        !!d &&
        typeof d.key === 'string' &&
        (d.category === 'creation' || d.category === 'palindrome') &&
        !!d.values &&
        typeof d.values.content === 'string',
    )
  } catch {
    return []
  }
}

export function saveDrafts(drafts: Draft[], storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    if (drafts.length === 0) storage?.removeItem(STORAGE_KEY)
    else storage?.setItem(STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // Storage full or unavailable (private mode): drafts still work for this session.
  }
}

/** The form currently being filled in (so a pasted song survives an accidental reload). */
export function loadWorkingForm(storage: Pick<Storage, 'getItem'> | null = safeStorage()): EntryFormValues | null {
  try {
    const raw = storage?.getItem(WORKING_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<EntryFormValues>) : null
    if (!parsed || typeof parsed.content !== 'string') return null
    const text = (v: unknown) => (typeof v === 'string' ? v : '')
    return {
      title: text(parsed.title),
      content: parsed.content,
      postedAt: text(parsed.postedAt),
      author: text(parsed.author),
      likes: text(parsed.likes),
      sourceUrl: text(parsed.sourceUrl),
    }
  } catch {
    return null
  }
}

export function saveWorkingForm(values: EntryFormValues | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    if (!values || isFormBlank(values)) storage?.removeItem(WORKING_KEY)
    else storage?.setItem(WORKING_KEY, JSON.stringify(values))
  } catch {
    // Unavailable storage only loses crash protection.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export const newDraftKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Whether the form holds anything worth keeping. */
export const isFormBlank = (values: EntryFormValues) =>
  !values.content.trim() && !values.title.trim() && !values.postedAt && !values.likes.trim() && !values.sourceUrl.trim()
