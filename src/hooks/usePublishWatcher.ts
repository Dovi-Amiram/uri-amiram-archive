import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArchiveEntry, Category, ChangeKind } from '../types/archive'
import { isChangeLive, type PendingChange } from '../utils/archive'
import { fetchEntries, fetchVersion } from '../utils/data'

export const POLL_INTERVAL_MS = 10_000
export const POLL_TIMEOUT_MS = 3 * 60_000

export interface PublishStatus {
  kind: 'publishing' | 'published' | 'delayed'
  change: ChangeKind
  category: Category
  /** Number of entries in the change (a batch save has several). */
  count: number
}

/**
 * A saved change (create / update / delete) is committed to GitHub, but the site only reflects
 * it after GitHub Actions rebuilds and Pages deploys. Until then the change is applied locally
 * ("pending") and version.json is polled for a limited time.
 */
export function usePublishWatcher(currentBuildId: string | null, reload: () => Promise<string | null>) {
  const [pending, setPending] = useState<PendingChange[]>([])
  const [status, setStatus] = useState<PublishStatus | null>(null)
  const timers = useRef(new Set<number>())
  const buildRef = useRef(currentBuildId)
  buildRef.current = currentBuildId

  useEffect(() => {
    const active = timers.current
    return () => active.forEach((t) => window.clearTimeout(t))
  }, [])

  const watch = useCallback(
    (kind: ChangeKind, entries: ArchiveEntry[]) => {
      if (entries.length === 0) return
      const changes: PendingChange[] = entries.map((entry) => ({ kind, entry }))
      const ids = new Set(entries.map((e) => e.id))
      const categories = [...new Set(entries.map((e) => e.category))]
      const base = { change: kind, category: entries[0].category, count: entries.length }
      // A newer change to the same entry replaces an older pending one.
      setPending((list) => [...changes, ...list.filter((c) => !ids.has(c.entry.id))])
      setStatus({ kind: 'publishing', ...base })
      const startedAt = Date.now()
      let lastSeenBuild = buildRef.current

      const tick = async () => {
        const version = await fetchVersion()
        if (version && version.buildId !== lastSeenBuild) {
          lastSeenBuild = version.buildId
          try {
            const live = Object.fromEntries(
              await Promise.all(categories.map(async (c) => [c, await fetchEntries(c, version.buildId)] as const)),
            )
            if (changes.every((change) => isChangeLive(change, live[change.entry.category]))) {
              await reload()
              setPending((list) => list.filter((c) => !changes.includes(c)))
              setStatus({ kind: 'published', ...base })
              return
            }
          } catch {
            // A deployment may be mid-rollout; try again next tick.
          }
        }
        if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
          setStatus({ kind: 'delayed', ...base })
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
