#!/usr/bin/env python3
"""Archive אורי עמירם's palindrome posts from a Facebook group (best-effort browser automation).

Target (Facebook's own "posts by this member in this group" view):
    https://www.facebook.com/groups/1435021850049747/user/659364624

Security model
--------------
* No credentials anywhere. The first run opens a visible Chromium window; you log in by hand.
* The logged-in session lives in a persistent browser profile at ``.facebook-profile/``
  (git-ignored) and is reused on later runs.
* The scraper only navigates, scrolls, and expands truncated text ("See more"). It never
  reacts, comments, shares, or changes anything.

How extraction works (and why it is split in two)
-------------------------------------------------
Facebook's DOM class names are obfuscated and change often, so this scraper relies on:

1. **Structured data** (preferred): the page and its ``/api/graphql/`` responses carry JSON
   "story" objects with ``post_id``, ``creation_time``, ``message.text`` and ``actors``.
   ``collect_stories_from_json`` walks any JSON for such objects. This gives exact timestamps
   and the untruncated text.
2. **DOM** (fallback / cross-check): ``DOM_EXTRACT_JS`` finds top-level ``[role="article"]``
   elements (articles nested in another article are comments and are skipped), their
   permalink, author links and message text via ``data-ad-*="message"`` attributes.

Both are merged by post id. A post is stored only if its author is the target user
(by numeric id when available, otherwise by the author's display name).
All selectors live in the "Facebook-specific extraction" section below.

Usage:
    python scrapers/facebook_scraper.py --login              # first time: log in manually
    python scrapers/facebook_scraper.py --dry-run --max-posts 5
    python scrapers/facebook_scraper.py                      # full historical scroll
    python scrapers/facebook_scraper.py --debug              # save screenshots/HTML on problems
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent))
from archive_utils import (  # noqa: E402
    ARCHIVE_DIR,
    ATTACHMENTS_DIR,
    DEFAULT_AUTHOR,
    RAW_DIR,
    REPO_ROOT,
    STATE_DIR,
    Checkpoint,
    dumps_json,
    load_exclusions,
    make_entry,
    normalize_content,
    normalize_single_line,
    now_iso,
    setup_logging,
    slugify_id_part,
    upsert_entry,
    write_json_atomic,
)

GROUP_ID = "1435021850049747"
USER_ID = "659364624"
TARGET_URL = f"https://www.facebook.com/groups/{GROUP_ID}/user/{USER_ID}"
PROFILE_DIR = REPO_ROOT / ".facebook-profile"
DEBUG_DIR = REPO_ROOT / "scrapers" / ".debug" / "facebook"

log = logging.getLogger("facebook")


# =========================================================================== data


@dataclass
class FbPhoto:
    photo_id: str
    uri: str
    width: int | None = None
    height: int | None = None
    alt: str | None = None


@dataclass
class FbPost:
    post_id: str
    text: str | None = None
    created_at: str | None = None  # ISO UTC
    permalink: str | None = None
    author_id: str | None = None
    author_name: str | None = None
    likes: int | None = None  # total reactions, as shown next to the post
    photos: list["FbPhoto"] = field(default_factory=list)
    origin: set[str] = field(default_factory=set)  # {"json", "dom"}

    def merge(self, other: "FbPost") -> None:
        # JSON text is untruncated, so it wins over DOM text; otherwise only fill gaps.
        other_is_json_text = bool(other.text) and "json" in other.origin
        if other.text and (not self.text or (other_is_json_text and "json" not in self.origin)):
            self.text = other.text
        self.created_at = self.created_at or other.created_at
        self.permalink = self.permalink or other.permalink
        self.author_id = self.author_id or other.author_id
        self.author_name = self.author_name or other.author_name
        if other.likes is not None and (self.likes is None or "json" in other.origin):
            self.likes = other.likes
        known = {ph.photo_id for ph in self.photos}
        self.photos.extend(ph for ph in other.photos if ph.photo_id not in known)
        self.origin |= other.origin


# =========================================================================== Facebook-specific extraction
#
# Everything that knows about Facebook's page structure is in this section.

_POST_URL_PATTERNS = [
    re.compile(r"/groups/[^/]+/posts/(\d+)"),
    re.compile(r"/groups/[^/]+/permalink/(\d+)"),
    re.compile(r"[?&]story_fbid=(\d+)"),
    re.compile(r"/posts/(\d+)"),
    re.compile(r"[?&]multi_permalinks=(\d+)"),
]


def post_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    for pattern in _POST_URL_PATTERNS:
        m = pattern.search(url)
        if m:
            return m.group(1)
    return None


def canonical_permalink(post_id: str) -> str:
    return f"https://www.facebook.com/groups/{GROUP_ID}/posts/{post_id}/"


def _iso_from_epoch(value: Any) -> str | None:
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return None
    if not 946684800 <= seconds <= 4102444800:  # 2000..2100: guards against non-timestamps
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _walk(obj: Any) -> Iterator[dict]:
    stack = [obj]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            yield cur
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)


def _first(obj: Any, predicate) -> Any:
    for d in _walk(obj):
        found = predicate(d)
        if found is not None:
            return found
    return None


def _story_message(story: dict) -> str | None:
    """The post's own text. Nested/attached stories (shares) are not searched first."""
    message = story.get("message")
    if isinstance(message, dict) and isinstance(message.get("text"), str):
        return message["text"]
    # comet_sections.content.story.message.text (the usual feed layout)
    return _first(
        story.get("comet_sections", {}),
        lambda d: d["message"]["text"]
        if isinstance(d.get("message"), dict) and isinstance(d["message"].get("text"), str)
        and "comments" not in d and "comment_rendering_instance" not in d
        else None,
    )


# Sub-trees of a story that belong to someone/something else: comments, the shared original of
# a share, and the author's avatar. Likes and photos are never taken from these.
_FOREIGN_KEYS = frozenset(
    {"attached_story", "interesting_top_level_comments", "comment", "comments", "comment_list_renderer",
     "actor_photo", "actors", "profile_picture", "owning_profile", "to", "group"}
)


def _walk_own(obj: Any) -> Iterator[dict]:
    """Like _walk, but does not descend into _FOREIGN_KEYS."""
    stack = [obj]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            yield cur
            stack.extend(v for k, v in cur.items() if k not in _FOREIGN_KEYS)
        elif isinstance(cur, list):
            stack.extend(cur)


def _story_likes(story: dict) -> int | None:
    """Total reaction count of the post itself (the number shown beside the reaction icons)."""
    for d in _walk_own(story):
        renderer = d.get("comet_ufi_summary_and_actions_renderer")
        if not isinstance(renderer, dict):
            continue
        feedback = renderer.get("feedback") or {}
        for f in _walk_own(feedback):
            rc = f.get("reaction_count")
            if isinstance(rc, dict) and isinstance(rc.get("count"), int):
                return rc["count"]
        edges = (feedback.get("top_reactions") or {}).get("edges") or []
        counts = [e.get("reaction_count") for e in edges if isinstance(e, dict)]
        if counts and all(isinstance(c, int) for c in counts):
            return sum(counts)
    return None


_PLACEHOLDER_ALT = re.compile(r"no photo description|אין תיאור", re.IGNORECASE)
_IMAGE_KEYS = ("photo_image", "viewer_image", "image", "massive_image", "large_image", "blurred_image")


def _story_photos(story: dict) -> list[FbPhoto]:
    """Photos attached to the post itself (largest available rendition of each)."""
    photos: dict[str, FbPhoto] = {}
    for d in _walk_own(story):
        if d.get("__typename") != "Photo" or not d.get("id"):
            continue
        best = None
        for key in _IMAGE_KEYS:
            img = d.get(key)
            if isinstance(img, dict) and isinstance(img.get("uri"), str) and img["uri"].startswith("https://"):
                if best is None or (img.get("width") or 0) > (best.get("width") or 0):
                    best = img
        if best is None:
            continue
        photo_id = str(d["id"])
        current = photos.get(photo_id)
        if current is None or (best.get("width") or 0) > (current.width or 0):
            alt = d.get("accessibility_caption")
            if not isinstance(alt, str) or _PLACEHOLDER_ALT.search(alt):
                alt = None  # Facebook's "No photo description available." is not a description
            photos[photo_id] = FbPhoto(photo_id, best["uri"], best.get("width"), best.get("height"), alt)
    return list(photos.values())


def collect_stories_from_json(payload: Any) -> list[FbPost]:
    """Find top-level post objects in any Facebook JSON payload.

    A story is a dict with a numeric ``post_id``. Comments use ``Comment`` objects with
    ``body`` (not ``message``) and have no ``post_id``, so they are never collected.
    """
    posts: dict[str, FbPost] = {}
    for d in _walk(payload):
        post_id = d.get("post_id")
        if not (isinstance(post_id, str) and post_id.isdigit()):
            continue
        if d.get("__typename") not in (None, "Story"):
            continue
        actors = d.get("actors") or _first(d, lambda x: x.get("actors") if isinstance(x.get("actors"), list) else None) or []
        actor = actors[0] if actors and isinstance(actors[0], dict) else {}
        created = _first(d, lambda x: _iso_from_epoch(x["creation_time"]) if "creation_time" in x else None)
        url = d.get("url") if isinstance(d.get("url"), str) else None
        found = FbPost(
            post_id=post_id,
            text=_story_message(d),
            created_at=created,
            permalink=url,
            author_id=str(actor["id"]) if actor.get("id") else None,
            author_name=actor.get("name"),
            likes=_story_likes(d),
            photos=_story_photos(d),
            origin={"json"},
        )
        if post_id in posts:
            posts[post_id].merge(found)
        else:
            posts[post_id] = found
    return list(posts.values())


def parse_graphql_body(body: str) -> list[Any]:
    """GraphQL responses are often several JSON documents separated by newlines."""
    docs = []
    body = body.removeprefix("for (;;);")
    for line in body.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            docs.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return docs


# Runs inside the page. Returns one record per top-level post article.
DOM_EXTRACT_JS = r"""
() => {
  const postRe = [/\/groups\/[^/]+\/posts\/(\d+)/, /\/groups\/[^/]+\/permalink\/(\d+)/, /[?&]story_fbid=(\d+)/, /[?&]multi_permalinks=(\d+)/];
  const idFrom = (href) => { for (const r of postRe) { const m = href && href.match(r); if (m) return m[1]; } return null; };
  const feed = document.querySelector('[role="feed"]') || document.body;
  const out = [];
  for (const art of feed.querySelectorAll('[role="article"]')) {
    // Articles nested inside another article are comments / replies.
    if (art.parentElement && art.parentElement.closest('[role="article"]')) continue;
    const label = art.getAttribute('aria-label') || '';
    const links = [...art.querySelectorAll('a[href]')];
    let postId = null, permalink = null, timeText = null;
    for (const a of links) {
      const id = idFrom(a.href);
      if (id) { postId = id; permalink = a.href.split('?')[0]; timeText = (a.getAttribute('aria-label') || a.innerText || '').trim(); break; }
    }
    const authorLinks = links
      .filter(a => /\/user\/(\d+)|profile\.php\?id=(\d+)/.test(a.href) && a.innerText.trim())
      .map(a => ({ href: a.href, name: a.innerText.trim() }));
    const msgEl = art.querySelector('[data-ad-rendering-role="story_message"]')
      || art.querySelector('[data-ad-comet-preview="message"]')
      || art.querySelector('[data-ad-preview="message"]');
    const text = msgEl ? msgEl.innerText : null;
    out.push({ postId, permalink, timeText, label, authorLinks, text,
               hasSeeMore: !!art.querySelector('[role="button"]') && /(See more|עוד|הצג עוד)/.test(msgEl ? msgEl.innerText : '') });
  }
  return out;
}
"""

# Expands truncated post text. Only buttons inside a post's message element are clicked.
EXPAND_SEE_MORE_JS = r"""
() => {
  let clicked = 0;
  const msgs = document.querySelectorAll('[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]');
  for (const msg of msgs) {
    if (msg.closest('[role="article"]') && msg.closest('[role="article"]').parentElement.closest('[role="article"]')) continue;
    for (const b of msg.querySelectorAll('[role="button"]')) {
      const t = (b.innerText || '').trim();
      if (t === 'See more' || t === 'עוד' || t === 'הצג עוד' || t === 'ראה עוד') { b.click(); clicked++; }
    }
  }
  return clicked;
}
"""

SCRIPT_JSON_JS = r"""
() => [...document.querySelectorAll('script[type="application/json"]')]
        .map(s => s.textContent).filter(t => t && t.includes('post_id'))
"""


def dom_record_to_post(record: dict) -> FbPost | None:
    post_id = record.get("postId") or post_id_from_url(record.get("permalink"))
    if not post_id:
        return None
    author_id = None
    author_name = None
    for link in record.get("authorLinks") or []:
        m = re.search(r"/user/(\d+)|profile\.php\?id=(\d+)", link.get("href", ""))
        if m:
            author_id = m.group(1) or m.group(2)
            author_name = link.get("name")
            break
    return FbPost(
        post_id=post_id,
        text=record.get("text"),
        permalink=record.get("permalink"),
        author_id=author_id,
        author_name=author_name,
        origin={"dom"},
    )


def is_target_author(post: FbPost, expected_names: set[str]) -> bool:
    if post.author_id:
        return post.author_id == USER_ID
    return bool(post.author_name) and normalize_single_line(post.author_name) in expected_names


def to_entry(post: FbPost, scraped_at: str, attachments: list[dict] | None = None):
    return make_entry(
        source="facebook",
        category="palindrome",
        source_id=post.post_id,
        title=None,
        content=post.text or "",
        author=DEFAULT_AUTHOR,
        posted_at=post.created_at,
        source_url=canonical_permalink(post.post_id),
        scraped_at=scraped_at,
        attachments=attachments,
        likes=post.likes,
    )


_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}


def download_photos(post: FbPost, request_context) -> list[dict]:
    """Download the post's photos into archive/attachments/facebook/ (Facebook CDN links expire).

    Already-downloaded files are reused. Returns canonical attachment objects.
    """
    folder = ATTACHMENTS_DIR / "facebook"
    attachments = []
    for index, photo in enumerate(post.photos, start=1):
        stem = f"{post.post_id}-{slugify_id_part(photo.photo_id)}"
        existing = sorted(folder.glob(f"{stem}.*")) if folder.is_dir() else []
        if existing:
            path = existing[0]
        else:
            try:
                response = request_context.get(photo.uri, timeout=60_000)
            except Exception as exc:
                log.warning("post %s photo %s: download failed (%s)", post.post_id, photo.photo_id, exc)
                continue
            content_type = (response.headers.get("content-type") or "").split(";")[0].strip()
            if not response.ok or content_type not in _EXTENSIONS:
                log.warning("post %s photo %s: HTTP %s %s", post.post_id, photo.photo_id, response.status, content_type)
                continue
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"{stem}{_EXTENSIONS[content_type]}"
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_bytes(response.body())
            tmp.replace(path)
            time.sleep(random.uniform(0.3, 0.8))
        attachments.append(
            {
                "type": "image",
                "path": path.relative_to(ARCHIVE_DIR).as_posix(),
                "width": photo.width,
                "height": photo.height,
                "alt": photo.alt,
                "sourceId": photo.photo_id,
                "order": index,
            }
        )
    return attachments


# =========================================================================== browser flow


def is_logged_in(context) -> bool:
    return any(c["name"] == "c_user" for c in context.cookies("https://www.facebook.com"))


def wait_for_manual_login(context, page, timeout_s: int) -> bool:
    page.goto("https://www.facebook.com/", wait_until="domcontentloaded")
    print("\n>>> Log in to Facebook in the opened browser window. Waiting up to", timeout_s // 60, "minutes...\n", flush=True)
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if is_logged_in(context):
            # Give Facebook a moment to finish writing session storage.
            page.wait_for_timeout(4000)
            return True
        page.wait_for_timeout(2000)
    return False


class DebugSink:
    def __init__(self, enabled: bool):
        self.enabled = enabled
        self.counter = 0

    def dump(self, page, reason: str, extra: Any = None) -> None:
        if not self.enabled:
            return
        self.counter += 1
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        stem = DEBUG_DIR / f"{datetime.now():%Y%m%d-%H%M%S}-{self.counter:03d}-{re.sub(r'[^a-z0-9]+', '-', reason.lower())[:40]}"
        try:
            page.screenshot(path=f"{stem}.png", full_page=False)
            Path(f"{stem}.html").write_text(page.content(), encoding="utf-8")
            if extra is not None:
                Path(f"{stem}.json").write_text(dumps_json(extra), encoding="utf-8")
            log.info("debug snapshot saved: %s.*", stem)
        except Exception as exc:  # debugging must never break scraping
            log.warning("could not save debug snapshot: %s", exc)


def human_pause(base_ms: int) -> int:
    return int(base_ms * random.uniform(0.7, 1.5))


def saved_post_ids(archive_dir=ARCHIVE_DIR) -> set[str]:
    """Facebook post ids that already have an archive entry."""
    folder = archive_dir / "palindromes"
    return {path.stem.removeprefix("facebook-") for path in folder.glob("facebook-*.json")} if folder.is_dir() else set()


def should_stop_new_only(mine_ids: list[str], saved: set[str], rounds_without_new: int, stop_after_known: int) -> bool:
    """In --new-only mode, stop once enough already-archived posts were seen and scrolling
    further keeps yielding nothing new. The group page lists newest posts first, so everything
    below that point is already archived. stop_after_known=0 disables early stopping."""
    if not stop_after_known:
        return False
    known_seen = sum(1 for pid in mine_ids if pid in saved)
    return known_seen >= stop_after_known and rounds_without_new >= 3


def run(args: argparse.Namespace) -> int:
    from playwright.sync_api import sync_playwright

    checkpoint = Checkpoint.load("facebook")
    if args.force:
        checkpoint.reset()
    saved_before = checkpoint.done_set()
    debug = DebugSink(args.debug)
    expected_names = {DEFAULT_AUTHOR, *(args.author_name or [])}

    collected: dict[str, FbPost] = {}
    # Posts deleted on the website are never re-added.
    excluded_ids = {i.removeprefix("facebook-") for i in load_exclusions() if i.startswith("facebook-")}
    # In --new-only mode archived posts are neither re-saved nor refreshed.
    skip_ids = saved_post_ids() if args.new_only else set()
    if args.new_only:
        log.info("new-only mode: %d posts already archived, %d excluded", len(skip_ids), len(excluded_ids))

    def absorb(posts: list[FbPost]) -> None:
        for post in posts:
            if post.post_id in collected:
                collected[post.post_id].merge(post)
            else:
                collected[post.post_id] = post

    PROFILE_DIR.mkdir(exist_ok=True)
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=not args.headed,
            locale="he-IL",
            viewport={"width": 1280, "height": 900},
        )
        page = context.pages[0] if context.pages else context.new_page()

        if args.login or not is_logged_in(context):
            if not args.headed:
                log.error("not logged in. Run once with --login (opens a visible browser).")
                context.close()
                return 2
            if not wait_for_manual_login(context, page, args.login_timeout):
                log.error("login not detected before timeout")
                context.close()
                return 2
            log.info("login detected; session saved in %s", PROFILE_DIR)
            if args.login:
                context.close()
                return 0

        def on_response(response) -> None:
            if "/api/graphql" not in response.url:
                return
            try:
                body = response.text()
            except Exception:
                return
            for doc in parse_graphql_body(body):
                absorb(collect_stories_from_json(doc))

        page.on("response", on_response)
        log.info("opening %s", TARGET_URL)
        page.goto(TARGET_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(human_pause(5000))
        if "login" in page.url:
            log.error("Facebook redirected to login; session expired. Run with --login.")
            debug.dump(page, "redirected-to-login")
            context.close()
            return 2

        for raw in page.evaluate(SCRIPT_JSON_JS):
            try:
                absorb(collect_stories_from_json(json.loads(raw)))
            except json.JSONDecodeError:
                continue

        stale_rounds = 0
        rounds = 0
        last_count = -1
        last_new_count = 0
        rounds_without_new = 0
        while stale_rounds < args.max_stale_scrolls:
            rounds += 1
            expanded = page.evaluate(EXPAND_SEE_MORE_JS)
            if expanded:
                page.wait_for_timeout(human_pause(1200))
            records = page.evaluate(DOM_EXTRACT_JS)
            dom_posts = [p for p in (dom_record_to_post(r) for r in records) if p]
            absorb(dom_posts)
            if records and not dom_posts:
                log.warning("found %d articles but no post ids - selectors may be outdated", len(records))
                debug.dump(page, "articles-without-ids", records[:5])

            mine = [p for p in collected.values() if is_target_author(p, expected_names) and (p.text or p.photos)]
            with_photos = sum(1 for p in mine if p.photos)
            log.info("scroll %d: %d posts seen, %d by target author (%d with photos)", rounds, len(collected), len(mine), with_photos)
            if len(collected) > last_count:
                stale_rounds = 0
                last_count = len(collected)
            else:
                stale_rounds += 1
            if args.max_posts and len(mine) >= args.max_posts:
                break
            if args.new_only:
                new_count = sum(1 for p in mine if p.post_id not in skip_ids and p.post_id not in excluded_ids)
                rounds_without_new = 0 if new_count > last_new_count else rounds_without_new + 1
                last_new_count = new_count
                if should_stop_new_only([p.post_id for p in mine], skip_ids | excluded_ids, rounds_without_new, args.stop_after_known):
                    log.info("reached already-archived posts (%d new found); stopping", new_count)
                    break
            if rounds % 10 == 0 and not args.dry_run:
                _save_posts(collected, expected_names, checkpoint, args, final=False, request_context=context.request, skip_ids=skip_ids, excluded_ids=excluded_ids)
            page.mouse.wheel(0, random.randint(600, 1100))
            page.wait_for_timeout(human_pause(args.scroll_pause_ms))

        if args.debug:
            write_json_atomic(DEBUG_DIR / "last-run-posts.json", [_record(p) for p in collected.values()])
        # Save while the browser is still open: photo downloads use its session.
        result = _save_posts(
            collected, expected_names, checkpoint, args, final=True, saved_before=saved_before,
            request_context=context.request, skip_ids=skip_ids, excluded_ids=excluded_ids,
        )
        context.close()
    return result


def _record(post: FbPost) -> dict:
    return vars(post) | {"origin": sorted(post.origin), "photos": [vars(ph) for ph in post.photos]}


def _save_posts(collected, expected_names, checkpoint, args, final: bool, saved_before=None, request_context=None, skip_ids=frozenset(), excluded_ids=frozenset()) -> int:
    scraped_at = now_iso()
    stats = {"created": 0, "updated": 0, "refreshed": 0, "unchanged": 0, "alreadyArchived": 0, "excluded": 0, "otherAuthor": 0, "noText": 0, "withPhotos": 0}
    examples = []
    others = []
    ordered = sorted(collected.values(), key=lambda p: p.created_at or "", reverse=True)
    if args.max_posts:
        ordered = [p for p in ordered if is_target_author(p, expected_names)][: args.max_posts] + [
            p for p in ordered if not is_target_author(p, expected_names)
        ]
    for post in ordered:
        if not is_target_author(post, expected_names):
            stats["otherAuthor"] += 1
            others.append((post.post_id, post.author_id, post.author_name))
            continue
        if post.post_id in excluded_ids:
            stats["excluded"] += 1  # deleted on the website
            continue
        if post.post_id in skip_ids:
            stats["alreadyArchived"] += 1
            continue
        has_text = bool(post.text and normalize_content(post.text))
        if not has_text and not post.photos:
            stats["noText"] += 1  # e.g. a share of content that is no longer available
            continue
        if post.photos:
            stats["withPhotos"] += 1
        if args.dry_run:
            entry = to_entry(post, scraped_at)
            examples.append({"entry": entry, "photos": [vars(ph) for ph in post.photos], "extractedFrom": sorted(post.origin)})
            continue
        attachments = download_photos(post, request_context) if (post.photos and request_context) else []
        if post.photos and not attachments and not has_text:
            continue  # image-only post whose image could not be downloaded; retry next run
        entry = to_entry(post, scraped_at, attachments)
        if args.save_raw:
            write_json_atomic(RAW_DIR / "facebook" / f"facebook-{post.post_id}.json", _record(post))
        stats[upsert_entry(entry, ARCHIVE_DIR)] += 1
        checkpoint.mark_done(post.post_id)
    if not args.dry_run:
        checkpoint.save()
    if not final:
        return 0

    print("\n==== Facebook summary ====")
    print(f"posts seen            : {len(collected)}")
    for key, value in stats.items():
        print(f"  {key:<12}: {value}")
    if saved_before is not None and not args.dry_run:
        print(f"previously saved      : {len(saved_before)}")
    if others:
        print(f"skipped (not target author): {others[:10]}")
    if args.new_only and not args.dry_run:
        # Periodic saves may already have created some files, so compare against the archive.
        new_ids = sorted(saved_post_ids() - skip_ids)
        print(f"new posts archived    : {len(new_ids)} {new_ids}")
        write_json_atomic(STATE_DIR / "facebook-last-new.json", {"finishedAt": now_iso(), "newPostIds": new_ids})
    if args.dry_run:
        print("\n==== parsed posts (dry run, not saved) ====")
        for example in examples:
            print(dumps_json(example))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--login", action="store_true", help="open a visible browser for manual login, then exit")
    parser.add_argument("--headed", action="store_true", default=None, help="show the browser (default when logging in)")
    parser.add_argument("--headless", dest="headed", action="store_false", help="hide the browser")
    parser.add_argument("--dry-run", action="store_true", help="extract and print, write nothing")
    parser.add_argument("--max-posts", type=int, default=0, help="stop after N posts by the author (0 = all)")
    parser.add_argument("--max-stale-scrolls", type=int, default=12, help="stop after N scrolls with no new posts")
    parser.add_argument("--scroll-pause-ms", type=int, default=2500, help="base pause between scrolls")
    parser.add_argument("--login-timeout", type=int, default=600, help="seconds to wait for manual login")
    parser.add_argument("--author-name", action="append", help="extra display name accepted as the author (repeatable)")
    parser.add_argument("--save-raw", action="store_true", help="also store raw extracted records in archive/raw/facebook")
    parser.add_argument("--force", action="store_true", help="ignore the checkpoint")
    parser.add_argument(
        "--new-only",
        action="store_true",
        help="only save posts whose id is not archived yet (existing entries are not touched)",
    )
    parser.add_argument(
        "--stop-after-known",
        type=int,
        default=30,
        help="with --new-only: stop after seeing N already-archived posts and no new ones (0 = scan full history)",
    )
    parser.add_argument("--debug", action="store_true", help="save screenshots / HTML / records under scrapers/.debug/")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    if args.headed is None:
        # Headed by default until a session exists, headless afterwards.
        args.headed = args.login or not (PROFILE_DIR / "Default").exists()
    setup_logging(args.verbose)
    try:
        return run(args)
    except KeyboardInterrupt:
        log.warning("interrupted; already-saved posts are kept, rerun to continue")
        return 130


if __name__ == "__main__":
    sys.exit(main())
