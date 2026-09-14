import type { NewEntryPayload } from './validation'

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

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${WRITE_API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
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

export async function login(password: string): Promise<SessionToken> {
  return post<SessionToken>('/api/login', { password })
}

export interface CreateEntryResponse {
  /** Raw entry as committed; parsed with parseEntry before use. */
  entry: unknown
  path: string
  commitSha: string | null
}

export async function createEntry(token: string, payload: NewEntryPayload): Promise<CreateEntryResponse> {
  return post<CreateEntryResponse>('/api/entries', payload, token)
}
