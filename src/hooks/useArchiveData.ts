import { useCallback, useEffect, useState } from 'react'
import type { ArchiveEntry, Category } from '../types/archive'
import { fetchEntries, fetchVersion } from '../utils/data'

export type LoadState = 'loading' | 'ready' | 'error'

export interface ArchiveData {
  state: LoadState
  entries: Record<Category, ArchiveEntry[]>
  buildId: string | null
  /** Refetch everything; resolves to the buildId now being served. */
  reload: () => Promise<string | null>
}

const EMPTY: Record<Category, ArchiveEntry[]> = { creation: [], palindrome: [] }

export function useArchiveData(): ArchiveData {
  const [state, setState] = useState<LoadState>('loading')
  const [entries, setEntries] = useState(EMPTY)
  const [buildId, setBuildId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const version = await fetchVersion()
      const [creation, palindrome] = await Promise.all([
        fetchEntries('creation', version?.buildId),
        fetchEntries('palindrome', version?.buildId),
      ])
      setEntries({ creation, palindrome })
      setBuildId(version?.buildId ?? null)
      setState('ready')
      return version?.buildId ?? null
    } catch (err) {
      console.error('failed to load archive', err)
      setState((prev) => (prev === 'ready' ? prev : 'error'))
      return null
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { state, entries, buildId, reload }
}
