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
