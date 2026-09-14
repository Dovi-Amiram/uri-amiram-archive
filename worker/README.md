# Write API (Cloudflare Worker)

The only server-side code in the project. It accepts a new entry from the site and commits one
JSON file to GitHub. It has no database; GitHub is the storage.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/login` `{ "password": "…" }` | — | Returns `{ token, expiresAt }`, a 2-hour HMAC-signed session token |
| `POST /api/entries` | `Authorization: Bearer <token>` | Validates and commits `archive/<creations|palindromes>/manual-<uuid>.json` |
| `POST /api/entries/batch` `{ "entries": [ … ] }` | `Authorization: Bearer <token>` | Validates 1–30 entries (request ≤ 1 MB) and commits them all in **one** commit; any invalid item rejects the whole batch |
| `PUT /api/entries/:id` | `Authorization: Bearer <token>` | Edits title/content/postedAt/author/likes/sourceUrl of an existing entry (body includes `category`); records `editedAt`/`editedFields` |
| `DELETE /api/entries/:id?category=…` | `Authorization: Bearer <token>` | Deletes the entry, its images and raw snapshot in one commit; scraped items are added to `archive/excluded.json` |
| `GET /api/health` | — | `{ "ok": true }` |

Entry body:

```json
{ "category": "creation", "title": "…", "content": "…", "postedAt": "2026-09-14", "author": "אורי עמירם", "likes": 12, "sourceUrl": "https://…" }
```

Server-side rules: `category` must be `creation` or `palindrome`; `content` required
(≤ 20,000 chars, line breaks preserved); `title` ≤ 200; `author` ≤ 100 (defaults to
אורי עמירם); `postedAt` optional `YYYY-MM-DD` or full ISO datetime; request body ≤ 64 KB;
`likes` optional non-negative integer; `sourceUrl` optional http(s) URL; JSON only. New ids are
server-generated UUIDs and creation never overwrites an existing file. Edits and deletions are
single commits made with the Git Data API (retried automatically if the branch moved meanwhile).

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
