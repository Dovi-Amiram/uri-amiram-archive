import { describe, expect, it, vi } from 'vitest'
import { issueToken, verifyToken } from '../src/auth'
import { commitMessage, normalizeContent, validateInput } from '../src/entry'
import { utf8ToBase64 } from '../src/github'
import { handleRequest, type Deps, type Env } from '../src/index'

const ORIGIN = 'https://dovi-amiram.github.io'
const NOW = new Date('2026-09-14T12:00:00.000Z')
const UUID = '0b9f7c1e-8d2a-4c47-9a0e-5f3c2b1a9d88'

const env: Env = {
  GITHUB_TOKEN: 'github_pat_test',
  ADMIN_PASSWORD: 'correct horse battery staple',
  GITHUB_OWNER: 'Dovi-Amiram',
  GITHUB_REPO: 'uri-amiram-archive',
  GITHUB_BRANCH: 'main',
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
  SESSION_TTL_SECONDS: '7200',
}

function githubOk() {
  return vi.fn(async () => new Response(JSON.stringify({ commit: { sha: 'abc123' } }), { status: 201 }))
}

function deps(fetchMock: ReturnType<typeof vi.fn> = githubOk()): Deps {
  return { fetch: fetchMock as unknown as typeof fetch, uuid: () => UUID, now: () => NOW }
}

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://api.example.workers.dev${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function validToken() {
  return (await issueToken(env.ADMIN_PASSWORD, 7200, NOW.getTime())).token
}

const validPayload = {
  category: 'creation',
  title: 'שיר חדש',
  content: 'שורה ראשונה\n  שורה שנייה מוזחת\n\nבית שני עם נִקּוּד',
  postedAt: '2026-09-01',
  author: 'אורי עמירם',
}

describe('POST /api/login', () => {
  it('rejects an invalid password', async () => {
    const res = await handleRequest(request('/api/login', { password: 'wrong' }), env, deps())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'הסיסמה שגויה' })
  })

  it('issues a verifiable token for the correct password', async () => {
    const res = await handleRequest(request('/api/login', { password: env.ADMIN_PASSWORD }), env, deps())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; expiresAt: number }
    expect(body.expiresAt).toBe(NOW.getTime() + 7200 * 1000)
    expect(await verifyToken(env.ADMIN_PASSWORD, body.token, NOW.getTime())).toBe(true)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })
})

describe('session tokens', () => {
  it('expire, and are invalidated by a password change or tampering', async () => {
    const token = await validToken()
    expect(await verifyToken(env.ADMIN_PASSWORD, token, NOW.getTime() + 7201 * 1000)).toBe(false)
    expect(await verifyToken('new password', token, NOW.getTime())).toBe(false)
    const [payload, sig] = token.split('.')
    const forged = btoa(JSON.stringify({ exp: 9e15 })).replace(/=+$/, '')
    expect(await verifyToken(env.ADMIN_PASSWORD, `${forged}.${sig}`, NOW.getTime())).toBe(false)
    expect(await verifyToken(env.ADMIN_PASSWORD, `${payload}.x${sig.slice(1)}`, NOW.getTime())).toBe(false)
    expect(await verifyToken(env.ADMIN_PASSWORD, null)).toBe(false)
  })
})

describe('POST /api/entries', () => {
  it('rejects requests without a valid token', async () => {
    const fetchMock = githubOk()
    const noAuth = await handleRequest(request('/api/entries', validPayload), env, deps(fetchMock))
    expect(noAuth.status).toBe(401)
    const badAuth = await handleRequest(request('/api/entries', validPayload, { Authorization: 'Bearer nope.nope' }), env, deps(fetchMock))
    expect(badAuth.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty content', async () => {
    const fetchMock = githubOk()
    const res = await handleRequest(
      request('/api/entries', { ...validPayload, content: '  \n\t\n ' }, { Authorization: `Bearer ${await validToken()}` }),
      env,
      deps(fetchMock),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'יש להזין תוכן' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid category', async () => {
    const res = await handleRequest(
      request('/api/entries', { ...validPayload, category: 'novel' }, { Authorization: `Bearer ${await validToken()}` }),
      env,
      deps(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'קטגוריה לא תקינה' })
  })

  it('rejects oversized bodies and non-JSON', async () => {
    const auth = { Authorization: `Bearer ${await validToken()}` }
    const huge = await handleRequest(request('/api/entries', { ...validPayload, content: 'א'.repeat(70000) }, auth), env, deps())
    expect(huge.status).toBe(413)
    const notJson = await handleRequest(request('/api/entries', '{oops', auth), env, deps())
    expect(notJson.status).toBe(400)
  })

  it('commits a valid payload to the expected GitHub path with the expected body', async () => {
    const fetchMock = githubOk()
    const res = await handleRequest(
      request('/api/entries', validPayload, { Authorization: `Bearer ${await validToken()}` }),
      env,
      deps(fetchMock),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { path: string; commitSha: string; entry: Record<string, unknown> }
    expect(body.path).toBe(`archive/creations/manual-${UUID}.json`)
    expect(body.commitSha).toBe('abc123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.github.com/repos/Dovi-Amiram/uri-amiram-archive/contents/archive/creations/manual-${UUID}.json`)
    expect(init.method).toBe('PUT')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer github_pat_test')

    const sent = JSON.parse(init.body as string) as { message: string; content: string; branch: string; sha?: string }
    expect(sent.message).toBe('Add creation: שיר חדש')
    expect(sent.branch).toBe('main')
    expect(sent.sha).toBeUndefined() // never overwrite an existing file

    const decoded = new TextDecoder().decode(Uint8Array.from(atob(sent.content), (c) => c.charCodeAt(0)))
    const committed = JSON.parse(decoded)
    expect(decoded.endsWith('\n')).toBe(true)
    expect(decoded).toContain('שיר חדש') // readable Hebrew in the file
    expect(committed).toEqual({
      id: `manual-${UUID}`,
      source: 'manual',
      category: 'creation',
      author: 'אורי עמירם',
      title: 'שיר חדש',
      content: validPayload.content,
      postedAt: '2026-09-01',
      sourceUrl: null,
      sourceId: null,
      scrapedAt: null,
      createdAt: '2026-09-14T12:00:00Z',
      updatedAt: '2026-09-14T12:00:00Z',
      attachments: [],
    })
    expect(body.entry).toEqual(committed)
  })

  it('stores palindromes under archive/palindromes with a generic message when untitled', async () => {
    const fetchMock = githubOk()
    const res = await handleRequest(
      request('/api/entries', { category: 'palindrome', content: 'ילד כותב בתוך דלי' }, { Authorization: `Bearer ${await validToken()}` }),
      env,
      deps(fetchMock),
    )
    expect(res.status).toBe(201)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain(`/contents/archive/palindromes/manual-${UUID}.json`)
    expect(JSON.parse(init.body as string).message).toBe('Add palindrome entry')
  })

  it('handles GitHub errors without leaking details', async () => {
    const failing = vi.fn(async () => new Response('{"message":"Bad credentials"}', { status: 401 }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleRequest(
      request('/api/entries', validPayload, { Authorization: `Bearer ${await validToken()}` }),
      env,
      deps(failing),
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('השמירה נכשלה. נסו שוב בעוד מספר רגעים.')
    expect(JSON.stringify(body)).not.toContain('Bad credentials')
    spy.mockRestore()
  })

  it('maps a GitHub conflict (file exists) to 409', async () => {
    const conflict = vi.fn(async () => new Response('{}', { status: 422 }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleRequest(request('/api/entries', validPayload, { Authorization: `Bearer ${await validToken()}` }), env, deps(conflict))
    expect(res.status).toBe(409)
    spy.mockRestore()
  })

  it('reports missing server configuration', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleRequest(request('/api/entries', validPayload), { ...env, GITHUB_TOKEN: '' }, deps())
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})

describe('CORS', () => {
  it('answers preflight only for allowed origins', async () => {
    const ok = await handleRequest(new Request('https://x/api/entries', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }), env, deps())
    expect(ok.status).toBe(204)
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(ok.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')

    const evil = await handleRequest(new Request('https://x/api/entries', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env, deps())
    expect(evil.status).toBe(403)
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('refuses POSTs from other origins before checking the password', async () => {
    const res = await handleRequest(request('/api/login', { password: env.ADMIN_PASSWORD }, { Origin: 'https://evil.example' }), env, deps())
    expect(res.status).toBe(403)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('does not use wildcard CORS', async () => {
    const res = await handleRequest(request('/api/login', { password: 'x' }), env, deps())
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
  })
})

describe('entry helpers', () => {
  it('normalizes content like the Python archive tools', () => {
    expect(normalizeContent('\r\n\r\n  שורה א  \r\n\r\n  שורה ב\r\n\r\n')).toBe('  שורה א\n\n  שורה ב')
  })

  it('validates optional fields', () => {
    expect(validateInput({ category: 'creation', content: 'x', postedAt: '2024-02-30' })).toEqual({ ok: false, error: 'תאריך לא תקין' })
    expect(validateInput({ category: 'creation', content: 'x', postedAt: '2024-02-29T10:00:00Z' }).ok).toBe(true)
    expect(validateInput({ category: 'creation', content: 'x', title: 5 })).toEqual({ ok: false, error: 'כותרת לא תקינה' })
    expect(validateInput([])).toMatchObject({ ok: false })
    const result = validateInput({ category: 'palindrome', content: 'x', title: '   ', author: '  ' })
    expect(result).toEqual({ ok: true, value: { category: 'palindrome', title: null, content: 'x', postedAt: null, author: 'אורי עמירם' } })
  })

  it('truncates very long titles in commit messages', () => {
    const msg = commitMessage({ category: 'creation', title: 'א'.repeat(100) } as never)
    expect(msg.length).toBeLessThanOrEqual('Add creation: '.length + 72)
  })

  it('base64-encodes UTF-8 correctly', () => {
    expect(utf8ToBase64('שלום')).toBe(Buffer.from('שלום', 'utf8').toString('base64'))
  })
})
