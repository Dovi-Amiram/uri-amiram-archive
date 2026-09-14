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

export type SortField = 'date' | 'title' | 'likes'
export type SortDirection = 'desc' | 'asc'

/** A saved change that may not be deployed yet. */
export type ChangeKind = 'create' | 'update' | 'delete'

export interface SectionInfo {
  category: Category
  hash: string
  dataFile: string
  label: string
  addLabel: string
  editLabel: string
  deleteQuestion: string
  /** Status messages after saving (Hebrew verbs agree with the noun's gender). */
  messages: Record<ChangeKind, { publishing: string; published: string; delayed: string }>
}

export const SECTIONS: readonly SectionInfo[] = [
  {
    category: 'creation',
    hash: 'creations',
    dataFile: 'creations.json',
    label: 'יצירות',
    addLabel: 'הוספת יצירה',
    editLabel: 'עריכת יצירה',
    deleteQuestion: 'האם אתם בטוחים שברצונכם למחוק את היצירה? היא תוסר מהאתר.',
    messages: {
      create: {
        publishing: 'היצירה נשמרה. האתר מתעדכן כעת.',
        published: 'היצירה פורסמה באתר.',
        delayed: 'היצירה נשמרה בהצלחה. ייתכן שיחלפו מספר רגעים עד שתופיע באתר.',
      },
      update: {
        publishing: 'השינויים ביצירה נשמרו. האתר מתעדכן כעת.',
        published: 'השינויים ביצירה פורסמו באתר.',
        delayed: 'השינויים נשמרו בהצלחה. ייתכן שיחלפו מספר רגעים עד שיופיעו באתר.',
      },
      delete: {
        publishing: 'היצירה נמחקה. האתר מתעדכן כעת.',
        published: 'היצירה הוסרה מהאתר.',
        delayed: 'היצירה נמחקה בהצלחה. ייתכן שיחלפו מספר רגעים עד שתוסר מהאתר.',
      },
    },
  },
  {
    category: 'palindrome',
    hash: 'palindromes',
    dataFile: 'palindromes.json',
    label: 'פלינדרומים',
    addLabel: 'הוספת פלינדרום',
    editLabel: 'עריכת פלינדרום',
    deleteQuestion: 'האם אתם בטוחים שברצונכם למחוק את הפלינדרום? הוא יוסר מהאתר.',
    messages: {
      create: {
        publishing: 'הפלינדרום נשמר. האתר מתעדכן כעת.',
        published: 'הפלינדרום פורסם באתר.',
        delayed: 'הפלינדרום נשמר בהצלחה. ייתכן שיחלפו מספר רגעים עד שיופיע באתר.',
      },
      update: {
        publishing: 'השינויים בפלינדרום נשמרו. האתר מתעדכן כעת.',
        published: 'השינויים בפלינדרום פורסמו באתר.',
        delayed: 'השינויים נשמרו בהצלחה. ייתכן שיחלפו מספר רגעים עד שיופיעו באתר.',
      },
      delete: {
        publishing: 'הפלינדרום נמחק. האתר מתעדכן כעת.',
        published: 'הפלינדרום הוסר מהאתר.',
        delayed: 'הפלינדרום נמחק בהצלחה. ייתכן שיחלפו מספר רגעים עד שיוסר מהאתר.',
      },
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
