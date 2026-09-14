import { describe, expect, it } from 'vitest'
import { emptyForm, LIMITS, toPayload, validateEntryForm } from './validation'

describe('validateEntryForm', () => {
  it('requires content', () => {
    expect(validateEntryForm(emptyForm()).content).toBe('יש להזין תוכן')
    expect(validateEntryForm({ ...emptyForm(), content: ' \n\t ' }).content).toBeDefined()
  })

  it('accepts a minimal valid form (title and date optional)', () => {
    expect(validateEntryForm({ ...emptyForm(), content: 'ילד כותב בתוך דלי' })).toEqual({})
  })

  it('rejects invalid dates', () => {
    const base = { ...emptyForm(), content: 'x' }
    expect(validateEntryForm({ ...base, postedAt: '2024-02-30' }).postedAt).toBeDefined()
    expect(validateEntryForm({ ...base, postedAt: 'yesterday' }).postedAt).toBeDefined()
    expect(validateEntryForm({ ...base, postedAt: '2024-02-29' }).postedAt).toBeUndefined()
  })

  it('enforces length limits', () => {
    const errors = validateEntryForm({
      title: 'א'.repeat(LIMITS.title + 1),
      content: 'ב'.repeat(LIMITS.content + 1),
      postedAt: '',
      author: 'ג'.repeat(LIMITS.author + 1),
    })
    expect(Object.keys(errors).sort()).toEqual(['author', 'content', 'title'])
  })
})

describe('toPayload', () => {
  it('normalizes empty optional fields to null and keeps line structure', () => {
    const payload = toPayload({ title: '  ', content: '\r\n  שורה א\r\n\r\n  שורה ב  \n\n', postedAt: '', author: '' }, 'palindrome')
    expect(payload).toEqual({
      category: 'palindrome',
      title: null,
      content: '  שורה א\n\n  שורה ב',
      postedAt: null,
      author: 'אורי עמירם',
    })
  })
})
