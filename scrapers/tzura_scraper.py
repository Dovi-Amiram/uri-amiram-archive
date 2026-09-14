#!/usr/bin/env python3
"""Archive אורי עמירם's works from Tzura (https://tzura.co.il/t/artist/1006).

Page structure (inspected 2026-09):

* Artist page /t/artist/<id>
    - left sidebar ``div.page-left-sidebar`` titled "היצירות": the COMPLETE list of the
      artist's works as ``<a href="/t/art/<workId>">title</a>``.
    - middle column: two *random* works (not a full list).
* Work page /T/Art/<workId>
    - ``div.blog article``: the work itself
        - ``h3.title-bg``                       title
        - ``.post-body span``                   body (``white-space: pre-line``, may contain <b>/<br>)
        - ``.post-summary-footer li`` with ``i.icon-calendar``  publication date (d/m/yyyy)
        - ``.post-summary-footer li`` with ``i.icon-user``      author link /T/Artist/<id>
    - ``section.comments`` (sibling AFTER the article): comments - never read.
    - sidebar "לקט יצירות": 5 random works by the same author (used only as a
      cross-check that the artist sidebar list is complete).

Usage:
    python scrapers/tzura_scraper.py --dry-run
    python scrapers/tzura_scraper.py
    python scrapers/tzura_scraper.py --limit 5 --force
"""

from __future__ import annotations

import argparse
import copy
import logging
import random
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

sys.path.insert(0, str(Path(__file__).resolve().parent))
from archive_utils import (  # noqa: E402
    ARCHIVE_DIR,
    DEFAULT_AUTHOR,
    RAW_DIR,
    Checkpoint,
    dumps_json,
    make_entry,
    normalize_content,
    normalize_single_line,
    now_iso,
    parse_dmy_date,
    setup_logging,
    upsert_entry,
    write_text_atomic,
)

BASE_URL = "https://tzura.co.il"
ARTIST_ID = "1006"
USER_AGENT = "UriAmiramArchive/1.0 (family archive of the author's own works; low-rate)"

log = logging.getLogger("tzura")

_WORK_HREF = re.compile(r"/t/art/(\d+)", re.IGNORECASE)
_ARTIST_HREF = re.compile(r"/t/artist/(\d+)", re.IGNORECASE)


class ParseError(Exception):
    """The page did not have the structure we expect."""


@dataclass
class WorkListing:
    work_id: str
    title: str | None


@dataclass
class ParsedWork:
    work_id: str
    title: str | None
    content: str
    author: str
    author_id: str | None
    posted_at: str | None
    source_url: str
    article_html: str
    related_ids: list[str] = field(default_factory=list)


def work_url(work_id: str) -> str:
    return f"{BASE_URL}/T/Art/{work_id}"


def artist_url(artist_id: str) -> str:
    return f"{BASE_URL}/t/artist/{artist_id}"


# --------------------------------------------------------------------------- parsing


def _soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def parse_artist_page(html: str) -> list[WorkListing]:
    """Return every work listed in the artist page's "היצירות" sidebar (in page order)."""
    soup = _soup(html)
    sidebar = soup.select_one("div.page-left-sidebar")
    if sidebar is None:
        raise ParseError("artist page: left sidebar (div.page-left-sidebar) not found")
    works: list[WorkListing] = []
    seen: set[str] = set()
    for link in sidebar.find_all("a", href=_WORK_HREF):
        work_id = _WORK_HREF.search(link["href"]).group(1)  # type: ignore[union-attr]
        if work_id in seen:
            continue
        seen.add(work_id)
        works.append(WorkListing(work_id=work_id, title=normalize_single_line(link.get_text())))
    # The middle column shows a couple of random works as <form action="/T/Art/N">; include
    # them in case they are ever missing from the sidebar.
    for form in soup.find_all("form", action=_WORK_HREF):
        work_id = _WORK_HREF.search(form["action"]).group(1)  # type: ignore[union-attr]
        if work_id not in seen:
            seen.add(work_id)
            heading = form.find("h4")
            works.append(WorkListing(work_id=work_id, title=normalize_single_line(heading.get_text()) if heading else None))
    return works


def _body_text(node: Tag) -> str:
    """Text of the poem body. Inline tags (<b>, <i>, <span>) are kept inline; <br>/<p>/<div> become line breaks."""
    node = copy.copy(node)
    for hidden in node.select('[style*="display:none"], [style*="display: none"], script, style'):
        hidden.decompose()
    blocks = node.find_all(["p", "div"])
    if blocks:
        # Newer works use one <p> per line (empty <p> = stanza break). The editor also left
        # CRLFs between the tags, which inside a pre-line span are only source formatting.
        for text in node.find_all(string=True):
            if not text.strip() and any(isinstance(s, Tag) and s.name in ("p", "div") for s in (text.previous_sibling, text.next_sibling)):
                text.extract()
    for br in node.find_all("br"):
        br.replace_with(NavigableString("\n"))
    for block in blocks:
        block.insert_after(NavigableString("\n"))
    text = node.get_text()
    if blocks:
        text = text.lstrip(" \t\r\n\xa0")  # editor artifact: "&nbsp;" before the first word
    return text


def parse_work_page(html: str, work_id: str) -> ParsedWork:
    soup = _soup(html)
    article = soup.select_one("div.blog article") or soup.find("article")
    if article is None:
        raise ParseError(f"work {work_id}: <article> not found")

    title_el = article.select_one("h3.title-bg") or article.find(["h1", "h2", "h3"])
    title = normalize_single_line(title_el.get_text()) if title_el else None

    body = article.select_one(".post-body span") or article.select_one(".post-body")
    if body is None:
        raise ParseError(f"work {work_id}: .post-body not found")
    content = normalize_content(_body_text(body))
    if not content:
        raise ParseError(f"work {work_id}: empty body")

    posted_at = None
    author = None
    author_id = None
    # Only look inside the article's own footer - comment dates live in section.comments.
    for li in article.select(".post-summary-footer li"):
        if li.find("i", class_="icon-calendar"):
            posted_at = parse_dmy_date(li.get_text())
        elif li.find("i", class_="icon-user"):
            link = li.find("a", href=_ARTIST_HREF)
            if link:
                author = normalize_single_line(link.get_text())
                author_id = _ARTIST_HREF.search(link["href"]).group(1)  # type: ignore[union-attr]

    related: list[str] = []
    heading = soup.find(lambda t: t.name in ("h4", "h5") and "לקט יצירות" in t.get_text())
    if heading:
        listing = heading.find_next("ul")
        if listing:
            related = [_WORK_HREF.search(a["href"]).group(1) for a in listing.find_all("a", href=_WORK_HREF)]  # type: ignore[union-attr]

    return ParsedWork(
        work_id=work_id,
        title=title,
        content=content,
        author=author or DEFAULT_AUTHOR,
        author_id=author_id,
        posted_at=posted_at,
        source_url=work_url(work_id),
        article_html=str(article),
        related_ids=related,
    )


def to_entry(work: ParsedWork, scraped_at: str):
    return make_entry(
        source="tzura",
        category="creation",
        source_id=work.work_id,
        title=work.title,
        content=work.content,
        author=work.author,
        posted_at=work.posted_at,
        source_url=work.source_url,
        scraped_at=scraped_at,
    )


# --------------------------------------------------------------------------- http


class Fetcher:
    def __init__(self, delay: float, retries: int = 4, timeout: float = 30.0):
        self.delay = delay
        self.retries = retries
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "he,en;q=0.5"})
        self._last = 0.0

    def get(self, url: str) -> str:
        for attempt in range(1, self.retries + 1):
            wait = self.delay + random.uniform(0, self.delay / 2) - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                resp = self.session.get(url, timeout=self.timeout)
            except (requests.ConnectionError, requests.Timeout) as exc:
                error: Exception = exc
            else:
                if resp.status_code == 200:
                    resp.encoding = resp.encoding or "utf-8"
                    return resp.text
                error = requests.HTTPError(f"HTTP {resp.status_code} for {url}", response=resp)
                if resp.status_code not in (429, 500, 502, 503, 504):
                    raise error  # e.g. 404: retrying will not help
            if attempt == self.retries:
                raise error
            else:
                exc = error
                backoff = min(60.0, 2.0**attempt + random.uniform(0, 1))
                log.warning("GET %s failed (%s); retry %d/%d in %.1fs", url, exc, attempt, self.retries, backoff)
                time.sleep(backoff)
        raise RuntimeError("unreachable")


# --------------------------------------------------------------------------- main flow


def run(args: argparse.Namespace) -> int:
    fetcher = Fetcher(delay=args.delay)
    checkpoint = Checkpoint.load("tzura")
    if args.force or not args.resume:
        checkpoint.reset()
    done = checkpoint.done_set()

    log.info("fetching artist page %s", artist_url(args.artist))
    listings = parse_artist_page(fetcher.get(artist_url(args.artist)))
    log.info("artist page lists %d works", len(listings))
    queue = [w.work_id for w in listings]
    listed_titles = {w.work_id: w.title for w in listings}

    stats = {"created": 0, "updated": 0, "unchanged": 0, "skipped": 0, "failed": 0, "notAuthor": 0}
    parsed_examples: list[dict] = []
    missing_fields: dict[str, list[str]] = {"title": [], "postedAt": []}
    extra_found: list[str] = []
    processed = 0
    i = 0
    while i < len(queue):
        work_id = queue[i]
        i += 1
        if args.limit and processed >= args.limit:
            break
        if work_id in done and not args.dry_run:
            stats["skipped"] += 1
            continue
        processed += 1
        url = work_url(work_id)
        try:
            work = parse_work_page(fetcher.get(url), work_id)
        except (ParseError, requests.RequestException) as exc:
            stats["failed"] += 1
            log.error("[%d/%d] %s: %s", i, len(queue), work_id, exc)
            continue

        # Cross-check: the random "לקט יצירות" list must not contain works absent from the full list.
        for rid in work.related_ids:
            if rid not in listed_titles and rid not in queue:
                log.warning("work %s found via random sidebar but not in the artist list; queuing it", rid)
                queue.append(rid)
                extra_found.append(rid)

        if work.author_id != args.artist:
            stats["notAuthor"] += 1
            log.warning("work %s belongs to artist %s (%s), skipping", work_id, work.author_id, work.author)
            continue

        entry = to_entry(work, now_iso())
        for key, bucket in missing_fields.items():
            if not entry[key]:  # type: ignore[literal-required]
                bucket.append(work_id)
        lines = entry["content"].count("\n") + 1

        if args.dry_run:
            if len(parsed_examples) < args.examples:
                parsed_examples.append(entry)  # type: ignore[arg-type]
            log.info("[%d/%d] %s  %s  (%s, %d lines)  [dry-run]", i, len(queue), work_id, entry["title"], entry["postedAt"], lines)
            continue

        if not args.no_raw:
            write_text_atomic(RAW_DIR / "tzura" / f"tzura-{work_id}.html", work.article_html + "\n")
        result = upsert_entry(entry, ARCHIVE_DIR, force=args.force)
        stats[result] += 1
        checkpoint.mark_done(work_id)
        if processed % 10 == 0:
            checkpoint.save()
        log.info("[%d/%d] %s  %s  -> %s", i, len(queue), work_id, entry["title"], result)

    if not args.dry_run:
        checkpoint.save()

    print("\n==== Tzura summary ====")
    print(f"works listed on artist page : {len(listings)}")
    print(f"extra works via random lists: {len(extra_found)} {extra_found or ''}")
    print(f"processed this run          : {processed}")
    for key, value in stats.items():
        print(f"  {key:<10}: {value}")
    for key, ids in missing_fields.items():
        print(f"missing {key:<9}: {len(ids)} {ids[:20] if ids else ''}")
    if args.dry_run and parsed_examples:
        print("\n==== example parsed entries (not saved) ====")
        for example in parsed_examples:
            print(dumps_json(example))
    return 1 if stats["failed"] else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--artist", default=ARTIST_ID, help="Tzura artist id (default: %(default)s)")
    parser.add_argument("--limit", type=int, default=0, help="process at most N works this run")
    parser.add_argument("--resume", action="store_true", help="skip works already saved by an interrupted run")
    parser.add_argument("--force", action="store_true", help="rewrite files even when unchanged (ignores checkpoint)")
    parser.add_argument("--dry-run", action="store_true", help="fetch and parse only; write nothing")
    parser.add_argument("--examples", type=int, default=3, help="number of example entries to print in --dry-run")
    parser.add_argument("--delay", type=float, default=1.5, help="base seconds between requests (default: %(default)s)")
    parser.add_argument("--no-raw", action="store_true", help="do not store raw article HTML snapshots")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    try:
        return run(args)
    except KeyboardInterrupt:
        log.warning("interrupted; rerun with --resume to continue")
        return 130


if __name__ == "__main__":
    sys.exit(main())
