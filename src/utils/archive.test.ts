import { describe, expect, it } from 'vitest'
import type { ArchiveEntry } from '../types/archive'
import {
  applyPendingChanges,
  formatDate,
  isChangeLive,
  makePreview,
  normalizeForSearch,
  parseArchive,
  parseEntry,
  searchEntries,
  sortEntries,
} from './archive'

const entry = (overrides: Partial<ArchiveEntry>): ArchiveEntry => ({
  id: 'x',
  source: 'tzura',
  category: 'creation',
  author: 'אורי עמירם',
  title: null,
  content: 'תוכן',
  postedAt: null,
  sourceUrl: null,
  sourceId: null,
  scrapedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  attachments: [],
  likes: null,
  ...overrides,
})

describe('parseArchive', () => {
  it('keeps valid entries and preserves poem line breaks exactly', () => {
    const content = 'שורה ראשונה\n  שורה מוזחת\n\nבית שני – "ציטוט" וגֵרֵש׳'
    const result = parseArchive([entry({ id: 'a', content, title: 'כותרת' })])
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe(content)
    expect(result[0].title).toBe('כותרת')
  })

  it('skips malformed, duplicate and wrong-category items', () => {
    const result = parseArchive(
      [
        entry({ id: 'ok' }),
        entry({ id: 'ok' }),
        { ...entry({ id: 'bad-cat' }), category: 'novel' },
        { ...entry({ id: 'bad-source' }), source: 'myspace' },
        entry({ id: 'empty', content: '   ' }),
        entry({ id: 'pal', category: 'palindrome' }),
        null,
        'string',
        { id: 5 },
      ],
      'creation',
    )
    expect(result.map((e) => e.id)).toEqual(['ok'])
  })

  it('fills optional fields with safe defaults', () => {
    const parsed = parseEntry({ id: 'm', source: 'manual', category: 'palindrome', content: 'ילד כותב בתוך דלי' })
    expect(parsed).toMatchObject({ title: null, postedAt: null, sourceUrl: null, attachments: [], author: 'אורי עמירם' })
  })

  it('reads likes and safe image attachments, allowing image-only entries', () => {
    const parsed = parseEntry({
      id: 'facebook-1',
      source: 'facebook',
      category: 'palindrome',
      content: '',
      likes: 7,
      attachments: [
        { type: 'image', path: 'attachments/facebook/1-p.jpg', width: 600, height: 450, alt: null },
        { type: 'image', path: '../../secret.jpg' },
        { type: 'video', path: 'attachments/facebook/v.mp4' },
      ],
    })
    expect(parsed?.likes).toBe(7)
    expect(parsed?.attachments).toEqual([{ type: 'image', path: 'attachments/facebook/1-p.jpg', width: 600, height: 450, alt: null }])
    expect(parseEntry({ id: 'x', source: 'facebook', category: 'palindrome', content: '', attachments: [] })).toBeNull()
  })

  it('throws when the index is not an array', () => {
    expect(() => parseArchive({})).toThrow()
  })
})

describe('searchEntries', () => {
  const list = [
    entry({ id: '1', title: 'הרי את-מקודשת-לי', content: 'אל רכס הטבעת הנִכסף והכסוף' }),
    entry({ id: '2', title: 'על הפרנסה', content: 'אבינו מלכנו\nכותבינו בספר פרנסה' }),
    entry({ id: '3', title: null, content: 'ביל גייטס והצופן התנ"כי' }),
  ]

  it('matches title and content', () => {
    expect(searchEntries(list, 'פרנסה').map((e) => e.id)).toEqual(['2'])
    expect(searchEntries(list, 'מקודשת').map((e) => e.id)).toEqual(['1'])
  })

  it('ignores niqqud in the text and in the query', () => {
    expect(searchEntries(list, 'הנכסף').map((e) => e.id)).toEqual(['1'])
    expect(searchEntries(list, 'הנִכְסָף').map((e) => e.id)).toEqual(['1'])
  })

  it('requires every term and treats quote variants alike', () => {
    expect(searchEntries(list, 'אבינו פרנסה').map((e) => e.id)).toEqual(['2'])
    expect(searchEntries(list, 'אבינו רכס')).toEqual([])
    expect(searchEntries(list, 'התנ״כי').map((e) => e.id)).toEqual(['3'])
  })

  it('returns everything for an empty query', () => {
    expect(searchEntries(list, '   ')).toHaveLength(3)
  })

  it('normalizes whitespace and case', () => {
    expect(normalizeForSearch('  Hello\n\tעוֹלָם ')).toBe('hello עולם')
  })
})

describe('sortEntries', () => {
  const list = [
    entry({ id: 'old', title: 'ב', postedAt: '2003-05-25', likes: 5 }),
    entry({ id: 'undated-b', title: 'ת' }),
    entry({ id: 'new', title: 'ג', postedAt: '2014-08-05', likes: 59 }),
    entry({ id: 'untitled', title: null, postedAt: null, likes: 5 }),
    entry({ id: 'datetime', title: 'א', postedAt: '2026-09-13T17:18:23Z', likes: 0 }),
    entry({ id: 'undated-a', title: 'א' }),
  ]
  const ids = (field: 'date' | 'title' | 'likes', direction: 'asc' | 'desc') => sortEntries(list, field, direction).map((e) => e.id)

  it('by date, newest first, undated last', () => {
    expect(ids('date', 'desc')).toEqual(['datetime', 'new', 'old', 'undated-a', 'undated-b', 'untitled'])
  })

  it('by date reversed, undated still last', () => {
    expect(ids('date', 'asc')).toEqual(['old', 'new', 'datetime', 'undated-a', 'undated-b', 'untitled'])
  })

  it('by title both ways, untitled last', () => {
    expect(ids('title', 'asc')).toEqual(['datetime', 'undated-a', 'old', 'new', 'undated-b', 'untitled'])
    expect(ids('title', 'desc')).toEqual(['undated-b', 'new', 'old', 'datetime', 'undated-a', 'untitled'])
  })

  it('by likes both ways, unknown last, ties newest first', () => {
    expect(ids('likes', 'desc')).toEqual(['new', 'old', 'untitled', 'datetime', 'undated-a', 'undated-b'])
    expect(ids('likes', 'asc')).toEqual(['datetime', 'old', 'untitled', 'new', 'undated-a', 'undated-b'])
  })

  it('does not mutate the input', () => {
    const copy = [...list]
    sortEntries(list, 'title', 'asc')
    expect(list).toEqual(copy)
  })
})

describe('pending changes', () => {
  const a = entry({ id: 'a', updatedAt: '1' })
  const b = entry({ id: 'b', updatedAt: '1' })
  const pal = entry({ id: 'p', category: 'palindrome' })

  it('applies creates, updates and deletes for the right category', () => {
    const changes = [
      { kind: 'create' as const, entry: entry({ id: 'new' }) },
      { kind: 'update' as const, entry: { ...a, content: 'ערוך', updatedAt: '2' } },
      { kind: 'delete' as const, entry: b },
      { kind: 'delete' as const, entry: pal },
    ]
    const result = applyPendingChanges([a, b], changes, 'creation')
    expect(result.map((e) => [e.id, e.content])).toEqual([
      ['a', 'ערוך'],
      ['new', 'תוכן'],
    ])
  })

  it('detects when a deployment reflects a change', () => {
    const updated = { ...a, updatedAt: '2' }
    expect(isChangeLive({ kind: 'create', entry: a }, [a])).toBe(true)
    expect(isChangeLive({ kind: 'create', entry: a }, [])).toBe(false)
    expect(isChangeLive({ kind: 'update', entry: updated }, [a])).toBe(false)
    expect(isChangeLive({ kind: 'update', entry: updated }, [updated])).toBe(true)
    expect(isChangeLive({ kind: 'delete', entry: a }, [a])).toBe(false)
    expect(isChangeLive({ kind: 'delete', entry: a }, [b])).toBe(true)
  })
})

describe('formatDate', () => {
  it('formats plain dates without timezone shift', () => {
    expect(formatDate('2003-08-26')).toBe('26.8.2003')
  })

  it('formats datetimes in Israel time', () => {
    // 22:30 UTC on Sep 13 is already Sep 14 in Israel.
    expect(formatDate('2026-09-13T22:30:00Z')).toMatch(/14\.9\.2026/)
  })

  it('handles missing and invalid values', () => {
    expect(formatDate(null)).toBeNull()
    expect(formatDate('not a date')).toBeNull()
  })
})

describe('makePreview', () => {
  it('keeps short works whole', () => {
    expect(makePreview('א\nב')).toEqual({ text: 'א\nב', truncated: false })
  })

  it('cuts long works by lines', () => {
    const text = Array.from({ length: 20 }, (_, i) => `שורה ${i}`).join('\n')
    const preview = makePreview(text, 8)
    expect(preview.truncated).toBe(true)
    expect(preview.text.split('\n')).toHaveLength(8)
  })

  it('cuts long single-paragraph prose by characters at a word boundary', () => {
    const prose = 'מילה '.repeat(200)
    const preview = makePreview(prose, 8, 100)
    expect(preview.truncated).toBe(true)
    expect(preview.text.length).toBeLessThanOrEqual(100)
    expect(preview.text.endsWith('מילה')).toBe(true)
  })
})
