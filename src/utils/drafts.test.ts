import { describe, expect, it } from 'vitest'
import { isFormBlank, loadDrafts, saveDrafts, type Draft } from './drafts'
import { emptyForm } from './validation'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  }
}

describe('drafts storage', () => {
  it('round-trips drafts and clears storage when empty', () => {
    const storage = memoryStorage()
    const drafts: Draft[] = [
      { key: 'a', category: 'creation', values: { ...emptyForm(), title: 'שיר', content: 'שורה\nשורה' } },
      { key: 'b', category: 'palindrome', values: { ...emptyForm(), content: 'ילד כותב בתוך דלי', likes: '4' } },
    ]
    saveDrafts(drafts, storage)
    expect(loadDrafts(storage)).toEqual(drafts)
    saveDrafts([], storage)
    expect(storage.data.size).toBe(0)
  })

  it('ignores corrupt or foreign data', () => {
    const storage = memoryStorage()
    storage.setItem('uri-amiram-archive:drafts:v1', '{not json')
    expect(loadDrafts(storage)).toEqual([])
    storage.setItem('uri-amiram-archive:drafts:v1', JSON.stringify([{ key: 1 }, { key: 'x', category: 'novel', values: { content: '' } }]))
    expect(loadDrafts(storage)).toEqual([])
    expect(loadDrafts(null)).toEqual([])
  })

  it('detects a blank form (author alone does not count)', () => {
    expect(isFormBlank(emptyForm())).toBe(true)
    expect(isFormBlank({ ...emptyForm(), title: 'x' })).toBe(false)
    expect(isFormBlank({ ...emptyForm(), content: '  ' })).toBe(true)
  })
})

describe('working form', () => {
  it('keeps an unfinished form and forgets it when blank', async () => {
    const { loadWorkingForm, saveWorkingForm } = await import('./drafts')
    const storage = memoryStorage()
    saveWorkingForm({ ...emptyForm(), content: 'שיר שהודבק' }, storage)
    expect(loadWorkingForm(storage)?.content).toBe('שיר שהודבק')
    saveWorkingForm(emptyForm(), storage)
    expect(loadWorkingForm(storage)).toBeNull()
  })
})
