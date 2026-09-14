import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArchiveEntry, Category } from '../types/archive'
import { fetchEntries, fetchVersion } from '../utils/data'

export const POLL_INTERVAL_MS = 10_000
export const POLL_TIMEOUT_MS = 3 * 60_000

export interface PublishStatus {
  kind: 'publishing' | 'published' | 'delayed'
  category: Category
}

/**
 * After a successful save the entry is committed to GitHub, but the site only shows it once
 * GitHub Actions has rebuilt and GitHub Pages has deployed. Meanwhile the entry is shown
 * locally as "pending", and version.json is polled for a limited time.
 */
export function usePublishWatcher(currentBuildId: string | null, reload: () => Promise<string | null>) {
  const [pending, setPending] = useState<ArchiveEntry[]>([])
  const [status, setStatus] = useState<PublishStatus | null>(null)
  const timers = useRef(new Set<number>())
  const buildRef = useRef(currentBuildId)
  buildRef.current = currentBuildId

  useEffect(() => {
    const active = timers.current
    return () => active.forEach((t) => window.clearTimeout(t))
  }, [])

  const watch = useCallback(
    (entry: ArchiveEntry) => {
      setPending((list) => [entry, ...list.filter((e) => e.id !== entry.id)])
      setStatus({ kind: 'publishing', category: entry.category })
      const startedAt = Date.now()
      let lastSeenBuild = buildRef.current

      const tick = async () => {
        const version = await fetchVersion()
        if (version && version.buildId !== lastSeenBuild) {
          lastSeenBuild = version.buildId
          try {
            const live = await fetchEntries(entry.category, version.buildId)
            if (live.some((e) => e.id === entry.id)) {
              await reload()
              setPending((list) => list.filter((e) => e.id !== entry.id))
              setStatus({ kind: 'published', category: entry.category })
              return
            }
          } catch {
            // A deployment may be mid-rollout; try again next tick.
          }
        }
        if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
          setStatus({ kind: 'delayed', category: entry.category })
          return
        }
        schedule()
      }
      const schedule = () => {
        const id = window.setTimeout(() => {
          timers.current.delete(id)
          void tick()
        }, POLL_INTERVAL_MS)
        timers.current.add(id)
      }
      schedule()
    },
    [reload],
  )

  const dismiss = useCallback(() => setStatus(null), [])

  return { pending, status, watch, dismiss }
}
