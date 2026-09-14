import { useCallback, useEffect, useState } from 'react'
import { SECTIONS, type SectionInfo } from '../types/archive'

export interface HashRoute {
  section: SectionInfo
  /** Open entry, from "#creations/tzura-7313". */
  entryId: string | null
}

export function parseHash(hash: string): HashRoute {
  const [sectionPart, ...rest] = decodeURIComponent(hash.replace(/^#\/?/, '')).split('/')
  const section = SECTIONS.find((s) => s.hash === sectionPart) ?? SECTIONS[0]
  const entryId = section.hash === sectionPart && rest.length ? rest.join('/') || null : null
  return { section, entryId }
}

export const buildHash = (section: SectionInfo, entryId?: string | null) =>
  `#${section.hash}${entryId ? `/${encodeURIComponent(entryId)}` : ''}`

/** Hash-based routing: works on GitHub Pages without server rewrites. */
export function useHashRoute() {
  const [route, setRoute] = useState<HashRoute>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((section: SectionInfo, entryId?: string | null, replace = false) => {
    const hash = buildHash(section, entryId)
    if (replace) window.history.replaceState(null, '', hash)
    else window.history.pushState(null, '', hash)
    setRoute(parseHash(hash))
  }, [])

  return { route, navigate }
}
