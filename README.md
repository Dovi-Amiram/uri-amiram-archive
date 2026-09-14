# היצירות של אורי עמירם — digital archive

A permanent, public, Hebrew (RTL) archive of the writings of **אורי עמירם**:

- **יצירות**: poems, songs and other writings, originally published on [Tzura](https://tzura.co.il/t/artist/1006).
- **פלינדרומים**: his palindrome posts in a [Facebook group](https://www.facebook.com/groups/1435021850049747/user/659364624).
- New entries can be added directly on the site.

**Public site:** <https://dovi-amiram.github.io/uri-amiram-archive/>

The site is fully static. Readers load files from GitHub Pages; no application server runs.

---

## 1. What is in this repository

```text
archive/                    ← THE ARCHIVE (canonical data, one JSON file per work)
  creations/*.json            tzura-<id>.json, manual-<uuid>.json
  palindromes/*.json          facebook-<postId>.json, manual-<uuid>.json
  attachments/facebook/       images attached to Facebook posts (downloaded; Facebook links expire)
  raw/tzura/                  original HTML of each Tzura work (article only, no comments)
  raw/facebook/               raw extracted Facebook records (optional)
scrapers/                   local Python scrapers (Tzura: requests+BeautifulSoup, Facebook: Playwright)
scripts/build_archive_indexes.py   validates archive/ and generates public/data/*.json
src/                        React + TypeScript + Vite frontend (Hebrew, RTL)
worker/                     Cloudflare Worker: the tiny authenticated write API
tests/python/               Python tests
.github/workflows/          validation + GitHub Pages deployment
```

## 2. Architecture

```text
            local, manual                         GitHub                               readers
┌──────────────────────────────┐    git push   ┌──────────────────────────┐  Actions  ┌──────────────────┐
│ scrapers/tzura_scraper.py    │──────────────▶│ archive/**/*.json        │──────────▶│ GitHub Pages     │
│ scrapers/facebook_scraper.py │               │ (canonical archive)      │  build    │ static React app │
└──────────────────────────────┘               └──────────────────────────┘           └──────────────────┘
                                                        ▲                                   │
                                                        │ commit via GitHub REST API        │ POST /api/entries
                                               ┌────────┴─────────────────┐                 │ (password → token)
                                               │ Cloudflare Worker        │◀────────────────┘
                                               │ secrets: GITHUB_TOKEN,   │
                                               │          ADMIN_PASSWORD  │
                                               └──────────────────────────┘
```

- **Canonical data** is the individual JSON files in `archive/`. Everything else is derived.
- **Build**: `scripts/build_archive_indexes.py` validates every entry and writes
  `public/data/creations.json`, `public/data/palindromes.json` (newest first) and
  `public/data/version.json`. Vite bundles the app; the indexes are static files next to it.
- **Deploy**: every push to `main` runs `.github/workflows/deploy-pages.yml` → GitHub Pages.
- **Writes**: the browser never holds a GitHub credential. It sends the password to the Worker,
  receives a short-lived signed token, and posts the entry. The Worker (holding a fine-grained
  GitHub token as a secret) commits the file, which triggers the normal deploy.

### Entry format

```json
{
  "id": "tzura-7313",
  "source": "tzura",
  "category": "creation",
  "author": "אורי עמירם",
  "title": "הרי את-מקודשת-לי",
  "content": "הרי את-מקודשת-לי תמירים ונישאים\nמכל פסגות תבל ורכסים גבוהים.\n…",
  "postedAt": "2003-08-26",
  "sourceUrl": "https://tzura.co.il/T/Art/7313",
  "sourceId": "7313",
  "scrapedAt": "2026-09-14T10:52:00Z",
  "createdAt": "2026-09-14T10:52:00Z",
  "updatedAt": "2026-09-14T10:52:00Z",
  "attachments": []
}
```

| Field | Notes |
| --- | --- |
| `source` | `tzura` \| `facebook` \| `manual` |
| `category` | `creation` \| `palindrome`, and must match the directory |
| `title` | `null` when there is none (Facebook posts) |
| `content` | full text; line breaks, stanza breaks, niqqud and punctuation preserved exactly |
| `postedAt` | original publication date (`YYYY-MM-DD` or ISO datetime) or `null`; never invented |
| `sourceUrl`, `sourceId` | original location, `null` for manual entries |
| `attachments` | images: `{ "type": "image", "path": "attachments/facebook/<postId>-<photoId>.jpg", "width", "height", "alt" }`; `path` is relative to `archive/`. Content may be empty when there is an image |
| `likes` | *optional*: total reactions on the Facebook post when last scraped (or set by hand). Refreshing it does not change `updatedAt` |
| `editedAt`, `editedFields` | *optional*: set when an entry is edited on the website. Scrapers never overwrite the fields listed in `editedFields` (`title`, `content`, `postedAt`, `author`, `likes`, `sourceUrl`) |

`archive/excluded.json` lists scraped items deleted on the website
(`{"entries": [{"id", "source", "sourceId", "deletedAt", "title"}]}`). Scrapers skip them, and the
build fails if an excluded id is still present in the archive. To restore a deleted item, remove it
from this file and restore its JSON file from git history.

Types: `src/types/archive.ts` (frontend), `worker/src/entry.ts` (Worker), `scrapers/archive_utils.py` (Python).

## 3. Local frontend development

Requirements: Node 22+, Python 3.10+.

```bash
npm ci
npm run dev        # regenerates public/data/*.json, then starts Vite at http://localhost:5173/uri-amiram-archive/
npm test           # frontend unit tests
npm run build      # indexes + typecheck + production build into dist/
npm run preview    # serve dist/ locally
```

`public/data/*.json` are generated and git-ignored; run `npm run data` after changing archive files.

## 4. Python setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r scrapers/requirements.txt
.venv/bin/playwright install chromium       # Facebook scraper only
.venv/bin/python -m pytest -q tests/python  # Python tests
```

## 5. Running the Tzura scraper

```bash
.venv/bin/python scrapers/tzura_scraper.py --dry-run   # parse everything, write nothing, print examples
.venv/bin/python scrapers/tzura_scraper.py             # create/update archive/creations/tzura-*.json
```

Useful flags: `--limit N`, `--resume`, `--force`, `--delay 2`. It is safe to rerun; unchanged
works are left untouched and changed ones are updated in place. Details and selectors:
[scrapers/README.md](scrapers/README.md).

As of the initial scrape (September 2026) Tzura lists **100 works** (2003–2014); 98 have a
publication date, and 2 show an empty date on Tzura and are stored with `postedAt: null`.

## 6. Running the Facebook scraper

```bash
.venv/bin/python scrapers/facebook_scraper.py --dry-run --max-posts 5   # preview a few posts
.venv/bin/python scrapers/facebook_scraper.py                           # full historical scroll
```

As of the initial scrape (September 2026) this saved **663 posts** (2016–2026). The run
skipped content by other authors that he had shared, and 2 image-only posts without text.

A post belongs in the palindromes archive because it is his post in this group; there is no
automatic "is this a palindrome" filtering.

It scrolls the "posts by this member in this group" page, saves only top-level posts whose
author id is `659364624`, and never stores comments or interacts with Facebook. Treat it as
best-effort browser automation: Facebook changes its pages. See
[scrapers/README.md → When Facebook changes](scrapers/README.md#when-facebook-changes).

### Monthly update: `update-palindromes`

One command archives new palindrome posts and publishes them:

```bash
update-palindromes                 # pull, scrape new posts, validate, commit, push
update-palindromes --dry-run       # only list the posts it would add
update-palindromes --login         # log in to Facebook by hand (visible browser), then exit
update-palindromes --no-push       # commit locally only
update-palindromes --full-history  # scan the whole history for missed posts (slow)
```

**Install the command once** (it is a small wrapper around `scripts/update_facebook.py` that uses
the project's `.venv`):

```bash
ln -sf "$PWD/bin/update-palindromes" ~/.local/bin/update-palindromes   # run in the repository root
```

**What counts as a new post.** A post is saved only if all of these hold:

1. its Facebook post id is not archived yet,
2. it was not deleted on the website (`archive/excluded.json`),
3. it is dated after the newest archived Facebook post (`--full-history` drops this rule to fill gaps),
4. it is a top-level post by Uri Amiram (id `659364624`), read from
   <https://www.facebook.com/groups/1435021850049747/user/659364624/> — the only page scraped.

New posts are saved with their photos (downloaded into `archive/attachments/facebook/`) and like
counts. Existing entries, including anything edited on the website, are never modified.

**Steps and output.** The terminal shows each step: repository check and `git pull`, the scrape
(one progress line per scroll), result checks and archive validation, the commit (listing each new
post) and the push. It ends with a summary. Problems are printed in a red block, with a terminal
bell and a desktop notification (`notify-send`):

| Alert | Meaning / what to do |
| --- | --- |
| Facebook logged the session out / not logged in | Run `update-palindromes --login`, or add credentials (below) |
| Facebook asks for a security check or 2FA code | Run `update-palindromes --login` and complete it by hand |
| Facebook showed no posts at all | The page layout probably changed; run `update-palindromes --dry-run --headed` and see the scrapers README |
| Posts found, but none by Uri Amiram | Author detection broke; do not commit, investigate |
| Scrolling ended before reaching archived posts | Possibly missed posts; run `--full-history` |
| Photo(s) could not be downloaded | Retried automatically next run |
| Archive validation failed | Nothing was committed; the message names the file |

Warnings (yellow) do not stop the update; errors (red) mean nothing was committed. The exit code is
non-zero on errors, so the command can also be scheduled.

**Automatic Facebook login (optional).** Normally the saved browser session (`.facebook-profile/`)
is reused. If Facebook ends it, the command can log in by itself:

```bash
cp .facebook.env.example .facebook.env
chmod 600 .facebook.env
# edit .facebook.env: FACEBOOK_EMAIL=... and FACEBOOK_PASSWORD=...
```

`.facebook.env` is git-ignored and read only by the scraper, and the values are never logged. The
script warns if the file is readable by other users. It never tries to get past Facebook security
checks, two-factor codes or CAPTCHAs; it stops and asks for `update-palindromes --login` instead.

To refresh like counts on all existing posts, run the full scraper
(`.venv/bin/python scrapers/facebook_scraper.py`) and commit the result; fields edited on the website
are still left alone.

## 7. First-time Facebook login

```bash
.venv/bin/python scrapers/facebook_scraper.py --login
```

1. A visible Chromium window opens on facebook.com.
2. Log in manually (2FA works as usual). Credentials are never typed into a terminal or saved in a file.
3. Once the session cookie appears, the scraper exits. The session is kept in `.facebook-profile/`
   (git-ignored), and later runs reuse it headlessly.
4. If Facebook logs the session out, run `--login` again. To wipe it, delete `.facebook-profile/`.

## 8. Where data is stored

- `archive/creations/` and `archive/palindromes/`: one pretty-printed UTF-8 JSON file per
  work, readable without any software from this project.
- `archive/raw/`: supporting raw snapshots from the sources.
- Git history: every change, including who or what added it (manual entries appear as commits
  like `Add creation: <title>`).

## 9. Generated indexes

```bash
python3 scripts/build_archive_indexes.py          # validate + write public/data/*.json
python3 scripts/build_archive_indexes.py --check  # validate only (used in CI)
```

Validation fails the build on: invalid JSON, missing fields, bad `category`/`source`, invalid
dates, duplicate ids, the same source item stored twice, a file in the wrong category directory,
or a filename that differs from the id.

The build also copies `archive/attachments/` to `public/attachments/` (git-ignored) so images are
served with the site, and fails if an entry references a missing image file.

Sorting: dated entries newest first; undated entries after them by title, then `createdAt`.
On the site, creations can be sorted by newest / oldest / title and palindromes by newest /
oldest / most likes.
`version.json` contains `buildId` (content hash + commit) and `generatedAt`; the site polls it
after a save to detect the new deployment.

## 10. GitHub Pages deployment

Automatic on every push to `main` (`.github/workflows/deploy-pages.yml`): checkout → Python →
generate and validate indexes → Node → `npm ci` → build → upload `dist/` → deploy with
`actions/deploy-pages`. `.github/workflows/validate-data.yml` runs on every push and pull request
(archive validation, Python tests, frontend tests and build, Worker typecheck and tests).
Scrapers never run in Actions.

Pages settings: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
The app is served under `/uri-amiram-archive/` (Vite `base`). For a custom domain or root
hosting, build with `BASE_PATH=/`. Navigation uses URL hashes (`#creations`, `#palindromes`,
`#creations/tzura-7313`), so direct links work on Pages without server rewrites.

## 11. Cloudflare Worker setup

```bash
cd worker
npm ci
npx wrangler login        # opens the browser to authorize your Cloudflare account (free plan is enough)
```

Non-secret settings are in `worker/wrangler.toml`: repository owner/name/branch and
`ALLOWED_ORIGINS` (`https://dovi-amiram.github.io,http://localhost:5173`). Only those exact
origins get CORS headers; other origins are refused.

## 12. Creating the fine-grained GitHub token

1. GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*.
2. **Resource owner**: `Dovi-Amiram`. **Expiration**: choose one (e.g. 1 year), and set a calendar reminder to rotate it.
3. **Repository access**: *Only select repositories* → `uri-amiram-archive`.
4. **Repository permissions**: **Contents → Read and write**. (Metadata → Read-only is added
   automatically.) Nothing else.
5. Generate and copy the token (`github_pat_…`). Don't save it anywhere except the Worker secret.

This token can only read and write files in this one repository.

## 13. Adding Worker secrets

```bash
cd worker
npx wrangler secret put GITHUB_TOKEN      # paste the token at the prompt (not stored in shell history)
```

## 14. Setting the admin password

```bash
npx wrangler secret put ADMIN_PASSWORD    # choose a long passphrase and share it only with the family
```

The site asks for this password the first time you save in a browser tab. After that it keeps
a 2-hour signed session token **in memory only** (nothing in localStorage). To change the
password, run the same command again; existing sessions stop working immediately.

## 15. Deploying the Worker

```bash
cd worker
npm run deploy
curl https://uri-amiram-archive-api.uri-amiram-archive-api.workers.dev/api/health   # → {"ok":true}
```

## 16. Connecting the Worker URL to the frontend

The Worker URL is public (not a secret). It is stored in `.env.production`:

```text
VITE_WRITE_API_URL=https://uri-amiram-archive-api.uri-amiram-archive-api.workers.dev
```

Commit and push; the next deploy enables the add buttons. If the Pages origin ever changes,
update `ALLOWED_ORIGINS` in `worker/wrangler.toml` and redeploy the Worker.

## 17. Adding, editing and deleting entries on the site

1. On the site, choose a tab and click **הוספת יצירה** / **הוספת פלינדרום**.
2. Fill in the form (title optional, content required, optional date, author defaults to אורי עמירם), plus the password the first time.
3. The browser sends the password to `POST /api/login`, then the entry to `POST /api/entries` with the token.
4. The Worker validates it and commits `archive/<category>/manual-<uuid>.json` to `main`.
5. The push triggers GitHub Actions, which regenerates the indexes, builds and deploys Pages (usually 1–3 minutes).
6. Meanwhile the site shows the entry marked **ממתין לפרסום** and the message "היצירה נשמרה. האתר מתעדכן כעת."
7. The page polls `data/version.json` every 10 seconds for up to 3 minutes. Once the new
   deployment contains the entry, the data reloads. If it takes longer, the site shows
   "היצירה נשמרה בהצלחה. ייתכן שיחלפו מספר רגעים עד שתופיע באתר." This is not an error.

**Adding several at once:** in the add dialog, **הוסף עוד פריט** moves the filled item into a
list and clears the form (the author is kept). **סקירה ושמירה** shows all items; each can be edited
or removed. **שמור הכל** saves up to 30 items in a single commit, so the site rebuilds once. The list
and the item being typed are kept in the browser (localStorage) until saved, so a closed tab or
reload does not lose them. Nothing sensitive is stored there.

**Login:** the password is asked once and a 2-hour session is kept in the tab's memory (never on
disk); **התנתקות** ends it immediately, and closing or reloading the tab ends it too.

**Editing:** open an entry (or use the pencil icon on its card) → **עריכה**. Title, content, date, author, like count and source link
can be changed (images are kept). The Worker commits `Edit <kind>: <title>`, marks the changed
fields in `editedFields` so later scrapes don't overwrite them, and the site shows the change as
pending until the new deployment is live. If the date is left unchanged, the original time of day
is kept.

**Deleting:** the trash icon on a card (or **מחיקה** in the open entry) → confirm in the
"האם אתם בטוחים…" dialog. One commit removes the entry, its images and
raw snapshot, and (for Tzura/Facebook items) records it in `archive/excluded.json` so it is never
re-scraped. Everything stays recoverable from git history.

**Sorting:** creations by date or title, palindromes by date or likes; the arrow button reverses
the order. Items without a date/title/like count always appear last.

Editing JSON files directly on GitHub also works; the site rebuilds on every commit.

## 18. If a source website disappears

Nothing on the public site depends on Tzura or Facebook being online: all text is in
`archive/`, and the site is built only from it. `sourceUrl` links will break, but that's all.
If the site or GitHub Pages is ever gone:

1. Clone (or unzip a backup of) the repository.
2. `npm ci && npm run build` produces a complete static site in `dist/`, which can be hosted anywhere
   (Cloudflare Pages, Netlify, any web server; use `BASE_PATH=/` for root hosting).
3. Even without this code, every `archive/**/*.json` file is plain readable JSON, and
   `archive/raw/tzura/*.html` opens in any browser.

## 19. Backups

- **GitHub** holds the repository and its full history.
- **Every local clone** is another complete copy (`git pull` regularly).
- **Periodic ZIP export** of the archive, e.g. every few months:

  ```bash
  git archive --format=zip -o "uri-amiram-archive-$(date +%Y-%m-%d).zip" HEAD archive/
  ```

  Copy the ZIP to an independent provider (Google Drive, an external disk, another family member's computer).
  The site never depends on these copies.

## 20. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Deploy workflow fails at "Generate archive indexes" | The log lists the invalid file and field. Fix the JSON on GitHub and commit. |
| Site shows old content | Pages deploys in 1–3 min and caches for ~10 min; the app bypasses the cache via `version.json`. Check the *Actions* tab for a failed run. |
| Add button shows "הוספת פריטים עדיין אינה זמינה" | `VITE_WRITE_API_URL` is missing from `.env.production` at build time. |
| "הסיסמה שגויה" | Wrong password; reset with `npx wrangler secret put ADMIN_PASSWORD`. |
| "השמירה נכשלה" | Run `npx wrangler tail` while saving. A 401/403 from GitHub means the token expired or lacks *Contents: read and write* on this repo; create a new one and `wrangler secret put GITHUB_TOKEN`. |
| Browser console shows a CORS error | The page origin is not in `ALLOWED_ORIGINS` (worker/wrangler.toml); add it and `npm run deploy`. |
| "השרת אינו מוגדר כראוי" | A Worker secret is missing: `npx wrangler secret list`. |
| Facebook scraper says not logged in / redirected to login | `python scrapers/facebook_scraper.py --login`. |
| Facebook scraper finds 0 posts | Run with `--headed --debug`, inspect `scrapers/.debug/facebook/`, see scrapers/README.md. |
| Tzura scraper errors | Rerun with `--resume`; `-v` for details; the site may have changed its HTML (see selectors table). |
| Pages 404 after first push | *Settings → Pages → Source* must be *GitHub Actions*; rerun the deploy workflow. |

Rate limiting: the login endpoint delays failed attempts, but a Worker without storage cannot
count attempts. For extra protection add a free Cloudflare *Rate limiting rule* for
`/api/login` in the dashboard (Security → WAF), and always use a long password.
