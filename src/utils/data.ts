import type { ArchiveEntry, BuildVersion, Category } from '../types/archive'
import { sectionFor } from '../types/archive'
import { parseArchive } from './archive'

/** Every public file is resolved against Vite's base, e.g. /uri-amiram-archive/data/... */
export const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`

/**
 * GitHub Pages caches files for ~10 minutes. version.json is always fetched with a unique
 * query string; the indexes are fetched with the buildId so a new deployment is never
 * hidden behind a stale cached copy.
 */
export async function fetchVersion(): Promise<BuildVersion | null> {
  try {
    const res = await fetch(`${dataUrl('version.json')}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as Partial<BuildVersion>
    return typeof json.buildId === 'string' ? { buildId: json.buildId, generatedAt: String(json.generatedAt ?? '') } : null
  } catch {
    return null
  }
}

export async function fetchEntries(category: Category, buildId: string | undefined): Promise<ArchiveEntry[]> {
  const file = sectionFor(category).dataFile
  const res = await fetch(`${dataUrl(file)}?v=${encodeURIComponent(buildId ?? String(Date.now()))}`, { cache: buildId ? 'default' : 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${file}`)
  return parseArchive(await res.json(), category)
}
