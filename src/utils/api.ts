import type { Category } from '../types/archive'
import type { EntryPayload } from './validation'

/**
 * Public URL of the Cloudflare Worker write API (not a secret), set at build time in
 * .env.production. No credentials of any kind are ever part of the frontend bundle.
 */
export const WRITE_API_URL = (import.meta.env.VITE_WRITE_API_URL ?? '').replace(/\/+$/, '')

export const isWriteApiConfigured = () => WRITE_API_URL !== ''

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${WRITE_API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'לא ניתן להתחבר לשרת. בדקו את החיבור לאינטרנט ונסו שוב.')
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) throw new ApiError(res.status, json.error || 'אירעה שגיאה')
  return json
}

export interface SessionToken {
  token: string
  expiresAt: number
}

export const isSessionValid = (s: SessionToken | null): s is SessionToken => !!s && s.expiresAt - 30_000 > Date.now()

export async function login(password: string): Promise<SessionToken> {
  return request<SessionToken>('POST', '/api/login', { password })
}

export interface SavedEntryResponse {
  /** Raw entry as committed; parsed with parseEntry before use. */
  entry: unknown
  path: string
  commitSha: string | null
}

/** Several new entries saved as one commit. */
export async function createEntries(token: string, payloads: EntryPayload[]): Promise<{ entries: unknown[]; commitSha: string | null }> {
  return request('POST', '/api/entries/batch', { entries: payloads }, token)
}

export async function updateEntry(token: string, id: string, payload: EntryPayload): Promise<SavedEntryResponse & { changed: string[] }> {
  return request('PUT', `/api/entries/${encodeURIComponent(id)}`, payload, token)
}

export async function deleteEntry(token: string, id: string, category: Category): Promise<{ id: string; deleted: boolean }> {
  return request('DELETE', `/api/entries/${encodeURIComponent(id)}?category=${category}`, undefined, token)
}
