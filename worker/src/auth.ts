/**
 * Lightweight auth: one shared admin password (a Worker secret) is exchanged for a short-lived
 * HMAC-signed session token. The HMAC key is derived from the password itself, so changing
 * ADMIN_PASSWORD immediately invalidates every issued token. No storage is needed.
 */

const encoder = new TextEncoder()

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const b of arr) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function hmac(key: string, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
}

/** Constant-time comparison of two strings via their HMACs (hides length and content timing). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const key = 'compare'
  const [ha, hb] = await Promise.all([hmac(key, a), hmac(key, b)])
  const va = new Uint8Array(ha)
  const vb = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}

const signingKey = (adminPassword: string) => `session-v1:${adminPassword}`

export async function issueToken(adminPassword: string, ttlSeconds: number, now = Date.now()): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + ttlSeconds * 1000
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ exp: expiresAt })))
  const signature = base64UrlEncode(await hmac(signingKey(adminPassword), payload))
  return { token: `${payload}.${signature}`, expiresAt }
}

export async function verifyToken(adminPassword: string, token: string | null, now = Date.now()): Promise<boolean> {
  if (!token) return false
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return false
  const expected = base64UrlEncode(await hmac(signingKey(adminPassword), payload))
  if (!(await safeEqual(expected, signature))) return false
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as { exp?: unknown }
    return typeof exp === 'number' && exp > now
  } catch {
    return false
  }
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match ? match[1] : null
}
