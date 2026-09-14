import { describe, expect, it } from 'vitest'
import { SECTIONS } from '../types/archive'
import { buildHash, parseHash } from './useHashRoute'

describe('hash routing', () => {
  it('defaults to creations', () => {
    expect(parseHash('').section.category).toBe('creation')
    expect(parseHash('#unknown').section.category).toBe('creation')
    expect(parseHash('#unknown/tzura-1').entryId).toBeNull()
  })

  it('parses section and entry', () => {
    expect(parseHash('#palindromes')).toEqual({ section: SECTIONS[1], entryId: null })
    expect(parseHash('#creations/tzura-7313')).toEqual({ section: SECTIONS[0], entryId: 'tzura-7313' })
  })

  it('round-trips', () => {
    const hash = buildHash(SECTIONS[1], 'manual-1234')
    expect(hash).toBe('#palindromes/manual-1234')
    expect(parseHash(hash).entryId).toBe('manual-1234')
  })
})
