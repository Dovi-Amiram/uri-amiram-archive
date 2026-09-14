import { describe, expect, it } from 'vitest'
import type { ArchiveEntry } from '../types/archive'
import { emptyForm, formFromEntry, LIMITS, toPayload, validateEntryForm } from './validation'

const fbEntry: ArchiveEntry = {
  id: 'facebook-1',
  source: 'facebook',
  category: 'palindrome',
  author: 'אורי עמירם',
  title: null,
  content: 'ילד כותב בתוך דלי',
  postedAt: '2026-09-13T17:18:23Z',
  sourceUrl: 'https://www.facebook.com/groups/1/posts/1/',
  sourceId: '1',
  scrapedAt: null,
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:00Z',
  attachments: [],
  likes: 22,
}

describe('validateEntryForm', () => {
  it('requires content unless allowed empty (entries with images)', () => {
    expect(validateEntryForm(emptyForm()).content).toBe('יש להזין תוכן')
    expect(validateEntryForm({ ...emptyForm(), content: ' \n\t ' }).content).toBeDefined()
    expect(validateEntryForm(emptyForm(), { allowEmptyContent: true }).content).toBeUndefined()
  })

  it('accepts a minimal valid form (everything but content optional)', () => {
    expect(validateEntryForm({ ...emptyForm(), content: 'ילד כותב בתוך דלי' })).toEqual({})
  })

  it('rejects invalid dates', () => {
    const base = { ...emptyForm(), content: 'x' }
    expect(validateEntryForm({ ...base, postedAt: '2024-02-30' }).postedAt).toBeDefined()
    expect(validateEntryForm({ ...base, postedAt: 'yesterday' }).postedAt).toBeDefined()
    expect(validateEntryForm({ ...base, postedAt: '2024-02-29' }).postedAt).toBeUndefined()
  })

  it('validates likes and source links', () => {
    const base = { ...emptyForm(), content: 'x' }
    expect(validateEntryForm({ ...base, likes: '12' }).likes).toBeUndefined()
    expect(validateEntryForm({ ...base, likes: '-3' }).likes).toBeDefined()
    expect(validateEntryForm({ ...base, likes: '2.5' }).likes).toBeDefined()
    expect(validateEntryForm({ ...base, sourceUrl: 'https://tzura.co.il/T/Art/7313' }).sourceUrl).toBeUndefined()
    expect(validateEntryForm({ ...base, sourceUrl: 'tzura.co.il' }).sourceUrl).toBeDefined()
    expect(validateEntryForm({ ...base, sourceUrl: 'javascript:alert(1)' }).sourceUrl).toBeDefined()
  })

  it('enforces length limits', () => {
    const errors = validateEntryForm({
      ...emptyForm(),
      title: 'א'.repeat(LIMITS.title + 1),
      content: 'ב'.repeat(LIMITS.content + 1),
      author: 'ג'.repeat(LIMITS.author + 1),
    })
    expect(Object.keys(errors).sort()).toEqual(['author', 'content', 'title'])
  })
})

describe('toPayload', () => {
  it('normalizes empty optional fields to null and keeps line structure', () => {
    const payload = toPayload({ ...emptyForm(), title: '  ', content: '\r\n  שורה א\r\n\r\n  שורה ב  \n\n', author: '' }, 'palindrome')
    expect(payload).toEqual({
      category: 'palindrome',
      title: null,
      content: '  שורה א\n\n  שורה ב',
      postedAt: null,
      author: 'אורי עמירם',
      likes: null,
      sourceUrl: null,
    })
  })

  it('round-trips an entry for editing, keeping the original time when the date is unchanged', () => {
    const values = formFromEntry(fbEntry)
    expect(values).toMatchObject({ postedAt: '2026-09-13', likes: '22', title: '' })
    expect(toPayload(values, 'palindrome', fbEntry)).toEqual({
      category: 'palindrome',
      title: null,
      content: fbEntry.content,
      postedAt: '2026-09-13T17:18:23Z',
      author: 'אורי עמירם',
      likes: 22,
      sourceUrl: fbEntry.sourceUrl,
    })
    expect(toPayload({ ...values, postedAt: '2026-09-01', likes: '30' }, 'palindrome', fbEntry)).toMatchObject({
      postedAt: '2026-09-01',
      likes: 30,
    })
  })
})
