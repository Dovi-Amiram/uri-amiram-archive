/** Minimal client for GitHub's "Create or update file contents" endpoint. */

export interface GitHubConfig {
  token: string
  owner: string
  repo: string
  branch: string
}

export class GitHubError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** UTF-8 safe base64 (btoa alone would break on Hebrew). */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function contentsUrl(config: GitHubConfig, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`
}

/**
 * Create a new file in one commit. Because no `sha` is sent, GitHub refuses to overwrite an
 * existing file (422), so an id collision can never clobber archive data.
 */
export async function createFile(
  config: GitHubConfig,
  path: string,
  content: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ commitSha: string | null }> {
  const response = await fetchImpl(contentsUrl(config, path), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'uri-amiram-archive-worker',
    },
    body: JSON.stringify({ message, content: utf8ToBase64(content), branch: config.branch }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new GitHubError(response.status, `GitHub API ${response.status}: ${detail.slice(0, 300)}`)
  }
  const json = (await response.json().catch(() => ({}))) as { commit?: { sha?: string } }
  return { commitSha: json.commit?.sha ?? null }
}

const apiHeaders = (config: GitHubConfig) => ({
  Authorization: `Bearer ${config.token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
  'User-Agent': 'uri-amiram-archive-worker',
})

const repoUrl = (config: GitHubConfig) =>
  `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`

function base64ToUtf8(b64: string): string {
  const binary = atob(b64.replace(/\s+/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

async function githubJson<T>(config: GitHubConfig, fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchImpl(url, { ...init, headers: apiHeaders(config) })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new GitHubError(response.status, `GitHub API ${response.status} ${init.method ?? 'GET'} ${url}: ${detail.slice(0, 300)}`)
  }
  return (await response.json()) as T
}

/** Read a text file from the branch. Returns null when it does not exist. */
export async function getFile(config: GitHubConfig, path: string, fetchImpl: typeof fetch = fetch): Promise<{ sha: string; text: string } | null> {
  try {
    const json = await githubJson<{ sha: string; content?: string; encoding?: string }>(
      config,
      fetchImpl,
      `${contentsUrl(config, path)}?ref=${encodeURIComponent(config.branch)}`,
    )
    if (json.encoding !== 'base64' || typeof json.content !== 'string') throw new GitHubError(500, `unexpected contents response for ${path}`)
    return { sha: json.sha, text: base64ToUtf8(json.content) }
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null
    throw err
  }
}

/** A file to write (content) or delete (content: null) in one commit. */
export interface FileChange {
  path: string
  content: string | null
}

/**
 * Apply several file writes/deletions as ONE commit using the Git Data API
 * (ref -> commit -> new tree -> new commit -> fast-forward ref). If the branch moved in the
 * meantime (e.g. a deploy commit), the whole sequence is retried on the new head.
 */
export async function commitChanges(
  config: GitHubConfig,
  changes: FileChange[],
  message: string,
  fetchImpl: typeof fetch = fetch,
  attempts = 3,
): Promise<{ commitSha: string }> {
  const base = repoUrl(config)
  const branch = encodeURIComponent(config.branch)
  for (let attempt = 1; ; attempt++) {
    const ref = await githubJson<{ object: { sha: string } }>(config, fetchImpl, `${base}/git/ref/heads/${branch}`)
    const parent = await githubJson<{ tree: { sha: string } }>(config, fetchImpl, `${base}/git/commits/${ref.object.sha}`)
    const tree = await githubJson<{ sha: string }>(config, fetchImpl, `${base}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: changes.map((c) =>
          c.content === null
            ? { path: c.path, mode: '100644', type: 'blob', sha: null }
            : { path: c.path, mode: '100644', type: 'blob', content: c.content },
        ),
      }),
    })
    const commit = await githubJson<{ sha: string }>(config, fetchImpl, `${base}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }),
    })
    try {
      await githubJson(config, fetchImpl, `${base}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      })
      return { commitSha: commit.sha }
    } catch (err) {
      // 422 = not a fast-forward: someone pushed meanwhile. Rebuild on the new head.
      if (err instanceof GitHubError && err.status === 422 && attempt < attempts) continue
      throw err
    }
  }
}
