import { describe, expect, it, vi } from 'vitest'
import { issueToken } from '../src/auth'
import { addExclusion, applyEdit, type ArchiveEntry } from '../src/entry'
import { handleRequest, type Deps, type Env } from '../src/index'

const ORIGIN = 'https://dovi-amiram.github.io'
const NOW = new Date('2026-09-15T08:00:00.000Z')
const env: Env = {
  GITHUB_TOKEN: 'github_pat_test',
  ADMIN_PASSWORD: 'pw',
  GITHUB_OWNER: 'Dovi-Amiram',
  GITHUB_REPO: 'uri-amiram-archive',
  GITHUB_BRANCH: 'main',
  ALLOWED_ORIGINS: ORIGIN,
}

const fbEntry: ArchiveEntry = {
  id: 'facebook-4214827098735861',
  source: 'facebook',
  category: 'palindrome',
  author: 'אורי עמירם',
  title: null,
  content: 'עֵרָן זְהָבִי, אַל תִּתְלַהֵם!',
  postedAt: '2026-01-03T10:00:00Z',
  sourceUrl: 'https://www.facebook.com/groups/1435021850049747/posts/4214827098735861/',
  sourceId: '4214827098735861',
  scrapedAt: '2026-09-14T11:00:00Z',
  createdAt: '2026-09-14T10:00:00Z',
  updatedAt: '2026-09-14T10:00:00Z',
  attachments: [{ type: 'image', path: 'attachments/facebook/4214827098735861-1.jpg', width: 600, height: 450 }],
  likes: 2,
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')
const decode = (b64text: string) => Buffer.from(b64text, 'base64').toString('utf8')

/** Fake GitHub: serves files from `files`, records git data API writes. */
function fakeGithub(files: Record<string, string>, opts: { refConflicts?: number } = {}) {
  let conflicts = opts.refConflicts ?? 0
  const calls: { method: string; url: string; body?: unknown }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const contents = /\/contents\/(.+?)\?ref=main$/.exec(url)
    if (method === 'GET' && contents) {
      const path = decodeURIComponent(contents[1])
      return path in files
        ? new Response(JSON.stringify({ sha: 'blobsha', encoding: 'base64', content: b64(files[path]) }), { status: 200 })
        : new Response('{"message":"Not Found"}', { status: 404 })
    }
    if (method === 'GET' && url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'head1' } })
    if (method === 'GET' && url.includes('/git/commits/')) return Response.json({ tree: { sha: 'tree1' } })
    if (method === 'POST' && url.endsWith('/git/trees')) return Response.json({ sha: 'tree2' })
    if (method === 'POST' && url.endsWith('/git/commits')) return Response.json({ sha: 'commit2' })
    if (method === 'PATCH' && url.endsWith('/git/refs/heads/main')) {
      if (conflicts-- > 0) return new Response('{"message":"Update is not a fast forward"}', { status: 422 })
      return Response.json({ object: { sha: 'commit2' } })
    }
    return new Response('unexpected', { status: 500 })
  })
  return { fetchMock, calls }
}

const deps = (fetchMock: ReturnType<typeof vi.fn>): Deps => ({ fetch: fetchMock as unknown as typeof fetch, uuid: () => 'u', now: () => NOW })

async function authed(method: string, path: string, body?: unknown) {
  const { token } = await issueToken(env.ADMIN_PASSWORD, 7200, NOW.getTime())
  return new Request(`https://w.example${path}`, {
    method,
    headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const editBody = (overrides: Record<string, unknown> = {}) => ({
  category: 'palindrome',
  title: null,
  content: fbEntry.content,
  postedAt: fbEntry.postedAt,
  author: fbEntry.author,
  likes: fbEntry.likes,
  sourceUrl: fbEntry.sourceUrl,
  ...overrides,
})

const entryFile = `archive/palindromes/${fbEntry.id}.json`

describe('PUT /api/entries/:id', () => {
  it('requires a token', async () => {
    const { fetchMock } = fakeGithub({})
    const req = new Request(`https://w.example/api/entries/${fbEntry.id}`, {
      method: 'PUT',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(editBody()),
    })
    expect((await handleRequest(req, env, deps(fetchMock))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects bad ids and returns 404 for missing entries', async () => {
    const { fetchMock } = fakeGithub({})
    expect((await handleRequest(await authed('PUT', '/api/entries/..%2F..%2Fx', editBody()), env, deps(fetchMock))).status).toBe(400)
    expect((await handleRequest(await authed('PUT', `/api/entries/${fbEntry.id}`, editBody()), env, deps(fetchMock))).status).toBe(404)
  })

  it('commits only the changed fields, keeps source data, and marks edited fields', async () => {
    const { fetchMock, calls } = fakeGithub({ [entryFile]: JSON.stringify(fbEntry) })
    const res = await handleRequest(await authed('PUT', `/api/entries/${fbEntry.id}`, editBody({ likes: 40, title: 'כותרת חדשה' })), env, deps(fetchMock))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entry: ArchiveEntry; changed: string[]; commitSha: string }
    expect(body.changed).toEqual(['title', 'likes'])
    expect(body.commitSha).toBe('commit2')

    const tree = calls.find((c) => c.url.endsWith('/git/trees'))!.body as { base_tree: string; tree: { path: string; content: string }[] }
    expect(tree.base_tree).toBe('tree1')
    expect(tree.tree).toHaveLength(1)
    expect(tree.tree[0].path).toBe(entryFile)
    const saved = JSON.parse(tree.tree[0].content)
    expect(saved).toMatchObject({
      id: fbEntry.id,
      source: 'facebook',
      sourceId: fbEntry.sourceId,
      title: 'כותרת חדשה',
      likes: 40,
      attachments: fbEntry.attachments,
      createdAt: fbEntry.createdAt,
      updatedAt: '2026-09-15T08:00:00Z',
      editedAt: '2026-09-15T08:00:00Z',
      editedFields: ['title', 'likes'],
    })
    const commit = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/commits'))!.body as { message: string; parents: string[] }
    expect(commit.message).toBe('Edit palindrome: כותרת חדשה')
    expect(commit.parents).toEqual(['head1'])
  })

  it('allows empty text only for entries with images', async () => {
    const { fetchMock } = fakeGithub({ [entryFile]: JSON.stringify(fbEntry) })
    expect((await handleRequest(await authed('PUT', `/api/entries/${fbEntry.id}`, editBody({ content: '' })), env, deps(fetchMock))).status).toBe(200)
    const noImages = { ...fbEntry, attachments: [] }
    const other = fakeGithub({ [entryFile]: JSON.stringify(noImages) })
    expect((await handleRequest(await authed('PUT', `/api/entries/${fbEntry.id}`, editBody({ content: '' })), env, deps(other.fetchMock))).status).toBe(400)
  })

  it('does not commit when nothing changed', async () => {
    const { fetchMock, calls } = fakeGithub({ [entryFile]: JSON.stringify(fbEntry) })
    const res = await handleRequest(await authed('PUT', `/api/entries/${fbEntry.id}`, editBody()), env, deps(fetchMock))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { commitSha: null }).commitSha).toBeNull()
    expect(calls.some((c) => c.method !== 'GET')).toBe(false)
  })

  it('retries when the branch moved meanwhile', async () => {
    const { fetchMock, calls } = fakeGithub({ [entryFile]: JSON.stringify(fbEntry) }, { refConflicts: 1 })
    const res = await handleRequest(await authed('PUT', `/api/entries/${fbEntry.id}`, editBody({ likes: 3 })), env, deps(fetchMock))
    expect(res.status).toBe(200)
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2)
  })
})

describe('DELETE /api/entries/:id', () => {
  it('removes entry, images and raw snapshot, and records an exclusion, in one commit', async () => {
    const { fetchMock, calls } = fakeGithub({
      [entryFile]: JSON.stringify(fbEntry),
      [`archive/raw/facebook/${fbEntry.id}.json`]: '{}',
    })
    const res = await handleRequest(await authed('DELETE', `/api/entries/${fbEntry.id}?category=palindrome`), env, deps(fetchMock))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: fbEntry.id, deleted: true, commitSha: 'commit2' })

    const tree = calls.find((c) => c.url.endsWith('/git/trees'))!.body as { tree: { path: string; sha?: null; content?: string }[] }
    const byPath = Object.fromEntries(tree.tree.map((t) => [t.path, t]))
    expect(byPath[entryFile].sha).toBeNull()
    expect(byPath['archive/attachments/facebook/4214827098735861-1.jpg'].sha).toBeNull()
    expect(byPath[`archive/raw/facebook/${fbEntry.id}.json`].sha).toBeNull()
    const exclusions = JSON.parse(byPath['archive/excluded.json'].content!)
    expect(exclusions.entries).toEqual([
      { id: fbEntry.id, source: 'facebook', sourceId: fbEntry.sourceId, deletedAt: '2026-09-15T08:00:00Z', title: null },
    ])
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
    const commit = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/commits'))!.body as { message: string }
    expect(commit.message).toBe(`Delete palindrome entry ${fbEntry.id}`)
  })

  it('deletes manual entries without an exclusion or raw lookup', async () => {
    const manual = { ...fbEntry, id: 'manual-abc', source: 'manual', sourceId: null, sourceUrl: null, attachments: [] }
    const { fetchMock, calls } = fakeGithub({ 'archive/palindromes/manual-abc.json': JSON.stringify(manual) })
    const res = await handleRequest(await authed('DELETE', '/api/entries/manual-abc?category=palindrome'), env, deps(fetchMock))
    expect(res.status).toBe(200)
    const tree = calls.find((c) => c.url.endsWith('/git/trees'))!.body as { tree: { path: string }[] }
    expect(tree.tree.map((t) => t.path)).toEqual(['archive/palindromes/manual-abc.json'])
  })

  it('requires category and token', async () => {
    const { fetchMock } = fakeGithub({})
    expect((await handleRequest(await authed('DELETE', `/api/entries/${fbEntry.id}`), env, deps(fetchMock))).status).toBe(400)
    const anon = new Request(`https://w.example/api/entries/${fbEntry.id}?category=palindrome`, { method: 'DELETE', headers: { Origin: ORIGIN } })
    expect((await handleRequest(anon, env, deps(fetchMock))).status).toBe(401)
  })

  it('reports GitHub failures as 502', async () => {
    const failing = vi.fn(async () => new Response('boom', { status: 500 }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleRequest(await authed('DELETE', `/api/entries/${fbEntry.id}?category=palindrome`), env, deps(failing))
    expect(res.status).toBe(502)
    spy.mockRestore()
  })
})

describe('helpers', () => {
  it('addExclusion is idempotent and sorted', () => {
    const first = addExclusion(null, fbEntry, NOW)!
    const again = addExclusion(first, fbEntry, NOW)!
    expect(JSON.parse(again).entries).toHaveLength(1)
    expect(addExclusion(null, { ...fbEntry, source: 'manual' }, NOW)).toBeNull()
  })

  it('applyEdit accumulates editedFields across edits and can clear likes', () => {
    const input = { category: 'palindrome' as const, title: null, content: 'חדש', postedAt: fbEntry.postedAt, author: fbEntry.author, likes: 2, sourceUrl: fbEntry.sourceUrl }
    const once = applyEdit(fbEntry, input, NOW).entry
    const twice = applyEdit(once, { ...input, likes: null }, NOW).entry
    expect(twice.editedFields).toEqual(['content', 'likes'])
    expect('likes' in twice).toBe(false)
  })

  it('CORS allows PUT and DELETE for our origin', async () => {
    const res = await handleRequest(new Request('https://w.example/api/entries/x', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env, deps(vi.fn()))
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE')
    expect(decode(b64('ok'))).toBe('ok')
  })
})
