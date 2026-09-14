# Scrapers

Local, manually-run tools that copy אורי עמירם's own works into the canonical archive
(`archive/<category>/<id>.json`). They never run in GitHub Actions and never archive comments.

```bash
python3 -m venv .venv
.venv/bin/pip install -r scrapers/requirements.txt
.venv/bin/playwright install chromium      # only needed for Facebook
```

All commands below assume the repository root as working directory and the venv's Python
(`.venv/bin/python` or an activated venv).

## Shared helpers — `archive_utils.py`

Stable ids (`tzura-7313`, `facebook-<postId>`), UTF-8 JSON with readable Hebrew
(`ensure_ascii=False`), atomic writes, text normalization that keeps poem layout and niqqud,
validation, dedupe, upsert (creates / updates / leaves unchanged, keeps `createdAt`), and
checkpoints in `scrapers/.state/` (git-ignored runtime state).

## Tzura — `tzura_scraper.py`

```bash
python scrapers/tzura_scraper.py --dry-run     # fetch + parse everything, write nothing, print examples
python scrapers/tzura_scraper.py               # save/update all works
python scrapers/tzura_scraper.py --limit 5     # only the first 5 works
python scrapers/tzura_scraper.py --resume      # continue an interrupted run
python scrapers/tzura_scraper.py --force       # rewrite files even if unchanged
```

Other options: `--delay SECONDS` (default 1.5 + jitter), `--no-raw`, `--artist ID`, `-v`.

### How Tzura pages are read (inspected September 2026)

| What | Where |
| --- | --- |
| Complete list of works | artist page `/t/artist/1006`, left sidebar `div.page-left-sidebar` titled "היצירות", links `/t/art/<id>` |
| Title | work page `/T/Art/<id>`, `div.blog article h3.title-bg` |
| Body | `article .post-body span` (`white-space: pre-line`). Older works: plain text lines; newer works: one `<p>` per line (empty `<p>` = stanza break) |
| Publication date | `article .post-summary-footer li` containing `i.icon-calendar`, format `d/m/yyyy`. Empty on some works → `postedAt: null` |
| Author | `article .post-summary-footer li` containing `i.icon-user` → link `/T/Artist/<id>`; works by other artists are skipped |
| Comments | `section.comments`, *after* the article — never read |

The middle column of the artist page shows only 2 random works, and each work page has a
"לקט יצירות" box with 5 random works by the same author. The scraper uses those random links
only as a completeness cross-check: any work found there but missing from the sidebar list is
reported and fetched too.

Raw snapshots of each work's `<article>` element (no comments) are stored in
`archive/raw/tzura/tzura-<id>.html`, preserving original formatting such as bold text.

## Facebook — `facebook_scraper.py`

Target: <https://www.facebook.com/groups/1435021850049747/user/659364624> (posts by this member in this group).

### First-time login (manual, no credentials in any file)

```bash
python scrapers/facebook_scraper.py --login
```

A visible Chromium window opens. Log in by hand. The scraper detects the session cookie,
stores the browser profile in `.facebook-profile/` (git-ignored) and exits. Never commit or
share that folder: it is a logged-in session.

### Scraping

```bash
python scrapers/facebook_scraper.py --dry-run --max-posts 5   # print a few parsed posts, write nothing
python scrapers/facebook_scraper.py                           # full historical scroll, saves every post
python scrapers/facebook_scraper.py --headed --debug          # watch it; save diagnostics
```

Options: `--max-stale-scrolls N` (stop after N scrolls without new posts, default 12),
`--scroll-pause-ms`, `--save-raw` (store merged raw records in `archive/raw/facebook/`),
`--author-name NAME` (accept an extra display name if no numeric id is available), `--force`.

Rerunning is safe: entries are keyed by Facebook post id (`facebook-<postId>.json`), unchanged
posts are left alone, and progress is saved every 10 scrolls.

The scraper only navigates, scrolls, and expands "See more" inside post text. It never reacts,
comments, shares or edits.

### How extraction works

All Facebook-specific logic is in the "Facebook-specific extraction" section of the file:

1. **Structured data** — `collect_stories_from_json()` walks JSON from the page's
   `<script type="application/json">` tags and from `/api/graphql/` responses. A post is any
   object with a numeric `post_id`; it provides `creation_time` (exact timestamp),
   `message.text` (untruncated text) and `actors[0].id` (author). Comments are `Comment`
   objects without `post_id`, so they are never collected.
2. **DOM** — `DOM_EXTRACT_JS` reads top-level `[role="article"]` elements inside
   `[role="feed"]` (articles nested in another article are comments and are skipped): permalink
   `a[href*="/groups/<id>/posts/<postId>"]`, author links `/user/<id>`, message text from
   `[data-ad-rendering-role="story_message"]` / `[data-ad-comet-preview="message"]` /
   `[data-ad-preview="message"]`.

Both are merged by post id; JSON wins for text and time. Posts whose author id is not
`659364624` are skipped and listed in the summary. Posts without text (image-only) are skipped
and counted.

### When Facebook changes

1. Run `python scrapers/facebook_scraper.py --dry-run --max-posts 5 --headed --debug`.
2. Look in `scrapers/.debug/facebook/`: screenshots, page HTML, and `last-run-posts.json`
   (every record found, with `origin` = json/dom).
3. If `json` records disappear, search the saved HTML for a known post text to find the new
   key names and update `collect_stories_from_json` / `_story_message`.
4. If only `dom` breaks, update `DOM_EXTRACT_JS` (prefer roles, aria labels and URL patterns
   over class names).
5. Never "fix" by relaxing the author check — it is what keeps other people's posts out.
