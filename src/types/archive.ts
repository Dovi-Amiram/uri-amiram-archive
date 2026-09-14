export type Source = 'tzura' | 'facebook' | 'manual'
export type Category = 'creation' | 'palindrome'

/** Canonical archive entry. Mirrors scrapers/archive_utils.py and worker/src/entry.ts. */
export interface ArchiveEntry {
  id: string
  source: Source
  category: Category
  author: string
  title: string | null
  content: string
  /** ISO date (YYYY-MM-DD) or datetime, when the original publication date is known. */
  postedAt: string | null
  sourceUrl: string | null
  sourceId: string | null
  scrapedAt: string | null
  createdAt: string
  updatedAt: string
  attachments: ImageAttachment[]
  /** Total reactions on the original post (Facebook), when known. */
  likes: number | null
}

/** An image stored in archive/attachments/, served from the site at BASE_URL + path. */
export interface ImageAttachment {
  type: 'image'
  path: string
  width: number | null
  height: number | null
  alt: string | null
}

export type SortMode = 'newest' | 'oldest' | 'title' | 'likes'

export interface SectionInfo {
  category: Category
  hash: string
  dataFile: string
  label: string
  addLabel: string
  /** Status messages after saving (Hebrew verbs agree with the noun's gender). */
  messages: { publishing: string; published: string; delayed: string }
}

export const SECTIONS: readonly SectionInfo[] = [
  {
    category: 'creation',
    hash: 'creations',
    dataFile: 'creations.json',
    label: 'יצירות',
    addLabel: 'הוספת יצירה',
    messages: {
      publishing: 'היצירה נשמרה. האתר מתעדכן כעת.',
      published: 'היצירה פורסמה באתר.',
      delayed: 'היצירה נשמרה בהצלחה. ייתכן שיחלפו מספר רגעים עד שתופיע באתר.',
    },
  },
  {
    category: 'palindrome',
    hash: 'palindromes',
    dataFile: 'palindromes.json',
    label: 'פלינדרומים',
    addLabel: 'הוספת פלינדרום',
    messages: {
      publishing: 'הפלינדרום נשמר. האתר מתעדכן כעת.',
      published: 'הפלינדרום פורסם באתר.',
      delayed: 'הפלינדרום נשמר בהצלחה. ייתכן שיחלפו מספר רגעים עד שיופיע באתר.',
    },
  },
]

export const DEFAULT_AUTHOR = 'אורי עמירם'

export function sectionFor(category: Category): SectionInfo {
  return SECTIONS.find((s) => s.category === category) ?? SECTIONS[0]
}

export interface BuildVersion {
  buildId: string
  generatedAt: string
}
