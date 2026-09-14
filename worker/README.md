# Write API (Cloudflare Worker)

The only server-side code in the project. It accepts a new entry from the site and commits one
JSON file to GitHub. It has no database; GitHub is the storage.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/login` `{ "password": "…" }` | — | Returns `{ token, expiresAt }`, a 2-hour HMAC-signed session token |
| `POST /api/entries` | `Authorization: Bearer <token>` | Validates and commits `archive/<creations|palindromes>/manual-<uuid>.json` |
| `GET /api/health` | — | `{ "ok": true }` |

Entry body:

```json
{ "category": "creation", "title": "…", "content": "…", "postedAt": "2026-09-14", "author": "אורי עמירם" }
```

Server-side rules: `category` must be `creation` or `palindrome`; `content` required
(≤ 20,000 chars, line breaks preserved); `title` ≤ 200; `author` ≤ 100 (defaults to
אורי עמירם); `postedAt` optional `YYYY-MM-DD` or full ISO datetime; request body ≤ 64 KB;
JSON only. The id is a server-generated UUID. The GitHub call never sends a `sha`, so an existing
file can never be overwritten.

## Configuration

Non-secret values are in `wrangler.toml` (`[vars]`): `GITHUB_OWNER`, `GITHUB_REPO`,
`GITHUB_BRANCH`, `ALLOWED_ORIGINS` (exact origins for CORS, no `*`), `SESSION_TTL_SECONDS`.

Secrets (never in files or git):

```bash
npx wrangler secret put GITHUB_TOKEN     # fine-grained PAT, this repo only, Contents: read and write
npx wrangler secret put ADMIN_PASSWORD   # the password typed on the site
```

Changing `ADMIN_PASSWORD` immediately invalidates all issued session tokens.

## Commands

```bash
npm ci
npm test            # unit tests (GitHub API mocked)
npm run typecheck
npx wrangler login  # once, opens the browser
npm run deploy
npx wrangler tail   # live logs
```

For local development create `worker/.dev.vars` (git-ignored):

```
GITHUB_TOKEN=github_pat_...
ADMIN_PASSWORD=some-local-password
```

then `npm run dev` and point the frontend at it with `VITE_WRITE_API_URL=http://localhost:8787 npm run dev`
in the repository root. Note that local development commits to the real repository.
