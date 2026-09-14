/**
 * uri-amiram-archive write API (Cloudflare Worker).
 *
 *   POST /api/login    { password }                         -> { token, expiresAt }
 *   POST /api/entries  Authorization: Bearer <token>, entry -> 201 { entry, path, commitSha }
 *   GET  /api/health                                         -> { ok: true }
 *
 * Its only job is committing a new JSON file into the GitHub repository; GitHub Actions then
 * rebuilds and redeploys the static site. GitHub credentials exist only as Worker secrets.
 */

import { bearerToken, issueToken, safeEqual, verifyToken } from './auth'
import { buildEntry, commitMessage, entryPath, LIMITS, serializeEntry, validateInput } from './entry'
import { createFile, GitHubError } from './github'

export interface Env {
  GITHUB_TOKEN: string
  ADMIN_PASSWORD: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
  GITHUB_BRANCH: string
  ALLOWED_ORIGINS: string
  SESSION_TTL_SECONDS?: string
}

export interface Deps {
  fetch: typeof fetch
  uuid: () => string
  now: () => Date
}

const defaultDeps = (): Deps => ({
  fetch: (input, init) => fetch(input, init),
  uuid: () => crypto.randomUUID(),
  now: () => new Date(),
})

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (!origin || !allowedOrigins(env).has(origin)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(request: Request, env: Env, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(request, env),
    },
  })
}

const error = (request: Request, env: Env, status: number, message: string) => json(request, env, status, { error: message })

async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().includes('application/json')) {
    return { ok: false, status: 415, message: 'נדרש תוכן מסוג JSON' }
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > LIMITS.bodyBytes) return { ok: false, status: 413, message: 'הבקשה גדולה מדי' }
  const raw = await request.arrayBuffer()
  if (raw.byteLength > LIMITS.bodyBytes) return { ok: false, status: 413, message: 'הבקשה גדולה מדי' }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(raw)) }
  } catch {
    return { ok: false, status: 400, message: 'גוף הבקשה אינו JSON תקין' }
  }
}

function configProblem(env: Env): string | null {
  const missing = ['GITHUB_TOKEN', 'ADMIN_PASSWORD', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH'].filter(
    (key) => !env[key as keyof Env],
  )
  return missing.length ? `missing configuration: ${missing.join(', ')}` : null
}

export async function handleRequest(request: Request, env: Env, deps: Deps = defaultDeps()): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')

  if (request.method === 'OPTIONS') {
    if (!origin || !allowedOrigins(env).has(origin)) return new Response(null, { status: 403, headers: { Vary: 'Origin' } })
    return new Response(null, { status: 204, headers: corsHeaders(request, env) })
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json(request, env, 200, { ok: true })
  }

  if (request.method !== 'POST' || (url.pathname !== '/api/login' && url.pathname !== '/api/entries')) {
    return error(request, env, 404, 'לא נמצא')
  }

  // Browsers always send Origin on cross-origin POSTs; refuse any site that is not ours.
  // (Requests without Origin, e.g. curl, still need the password/token.)
  if (origin && !allowedOrigins(env).has(origin)) return error(request, env, 403, 'מקור הבקשה אינו מורשה')

  const problem = configProblem(env)
  if (problem) {
    console.error(problem)
    return error(request, env, 500, 'השרת אינו מוגדר כראוי')
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return error(request, env, parsed.status, parsed.message)

  if (url.pathname === '/api/login') {
    const password = (parsed.body as { password?: unknown } | null)?.password
    if (typeof password !== 'string' || !(await safeEqual(password, env.ADMIN_PASSWORD))) {
      // Slow down guessing a little (there is no storage for real rate limiting; see README).
      await new Promise((resolve) => setTimeout(resolve, 750))
      return error(request, env, 401, 'הסיסמה שגויה')
    }
    const ttl = Math.min(Math.max(Number(env.SESSION_TTL_SECONDS) || 7200, 300), 86400)
    return json(request, env, 200, await issueToken(env.ADMIN_PASSWORD, ttl, deps.now().getTime()))
  }

  // POST /api/entries
  if (!(await verifyToken(env.ADMIN_PASSWORD, bearerToken(request), deps.now().getTime()))) {
    return error(request, env, 401, 'נדרשת התחברות')
  }

  const validation = validateInput(parsed.body)
  if (!validation.ok) return error(request, env, 400, validation.error)

  const entry = buildEntry(validation.value, deps.uuid(), deps.now())
  const path = entryPath(entry)
  try {
    const { commitSha } = await createFile(
      { token: env.GITHUB_TOKEN, owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH },
      path,
      serializeEntry(entry),
      commitMessage(entry),
      deps.fetch,
    )
    return json(request, env, 201, { entry, path, commitSha })
  } catch (err) {
    console.error('commit failed', err instanceof Error ? err.message : err)
    const status = err instanceof GitHubError && err.status === 422 ? 409 : 502
    return error(request, env, status, 'השמירה נכשלה. נסו שוב בעוד מספר רגעים.')
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },
} satisfies ExportedHandler<Env>
