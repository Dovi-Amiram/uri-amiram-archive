"""Shared helpers for the archive scrapers and the index builder.

Canonical entry format (camelCase, one JSON file per work):

    {
      "id": "tzura-7313",
      "source": "tzura" | "facebook" | "manual",
      "category": "creation" | "palindrome",
      "author": "אורי עמירם",
      "title": str | None,
      "content": str,
      "postedAt": "YYYY-MM-DD" | full ISO datetime | None,
      "sourceUrl": str | None,
      "sourceId": str | None,
      "scrapedAt": ISO timestamp | None,
      "createdAt": ISO timestamp,
      "updatedAt": ISO timestamp,
      "attachments": []
    }
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Literal, NotRequired, TypedDict

REPO_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = REPO_ROOT / "archive"
RAW_DIR = ARCHIVE_DIR / "raw"
STATE_DIR = REPO_ROOT / "scrapers" / ".state"

DEFAULT_AUTHOR = "אורי עמירם"

Source = Literal["tzura", "facebook", "manual"]
Category = Literal["creation", "palindrome"]

SOURCES: tuple[str, ...] = ("tzura", "facebook", "manual")
CATEGORIES: tuple[str, ...] = ("creation", "palindrome")
CATEGORY_DIRS: dict[str, str] = {"creation": "creations", "palindrome": "palindromes"}

FIELD_ORDER = (
    "id",
    "source",
    "category",
    "author",
    "title",
    "content",
    "postedAt",
    "sourceUrl",
    "sourceId",
    "scrapedAt",
    "createdAt",
    "updatedAt",
    "attachments",
    "likes",
    "editedAt",
    "editedFields",
)
REQUIRED_FIELDS = ("id", "source", "category", "author", "content", "createdAt", "updatedAt")
# Fields that describe the work itself; a change in these means the entry was really updated.
CONTENT_FIELDS = ("source", "category", "author", "title", "content", "postedAt", "sourceUrl", "sourceId", "attachments")
# Source metadata that changes over time (e.g. Facebook reactions). Refreshed without moving updatedAt.
METADATA_FIELDS = ("likes",)
# Optional fields: may be absent from older files.
OPTIONAL_FIELDS = ("likes", "editedAt", "editedFields")
# Fields a person may change on the website (worker/src/entry.ts EDITABLE_FIELDS). Once edited,
# they are listed in an entry's "editedFields" and scrapers never overwrite them.
EDITABLE_FIELDS = ("title", "content", "postedAt", "author", "likes", "sourceUrl")
ATTACHMENTS_DIR = ARCHIVE_DIR / "attachments"
EXCLUSIONS_FILE = ARCHIVE_DIR / "excluded.json"


class ArchiveEntry(TypedDict):
    id: str
    source: Source
    category: Category
    author: str
    title: str | None
    content: str
    postedAt: str | None
    sourceUrl: str | None
    sourceId: str | None
    scrapedAt: str | None
    createdAt: str
    updatedAt: str
    attachments: list[Any]
    likes: NotRequired[int | None]
    editedAt: NotRequired[str]
    editedFields: NotRequired[list[str]]


# --------------------------------------------------------------------------- logging


def setup_logging(verbose: bool = False) -> logging.Logger:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # urllib3 is very chatty at DEBUG.
    logging.getLogger("urllib3").setLevel(logging.INFO)
    return logging.getLogger("archive")


# --------------------------------------------------------------------------- time


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string with a trailing Z."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_valid_iso(value: str) -> bool:
    """Accept a plain date (YYYY-MM-DD) or a full ISO-8601 datetime."""
    if not isinstance(value, str) or not value:
        return False
    try:
        if _DATE_ONLY.match(value):
            date.fromisoformat(value)
        else:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def parse_dmy_date(text: str) -> str | None:
    """Convert an Israeli-style d/m/yyyy date (as printed by Tzura) to YYYY-MM-DD."""
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", text or "")
    if not m:
        return None
    day, month, year = (int(g) for g in m.groups())
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


# --------------------------------------------------------------------------- ids & paths


def slugify_id_part(value: str) -> str:
    """Make a string safe for use inside an id / filename (ascii letters, digits, - and _)."""
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", str(value)).strip("-")
    if not cleaned:
        raise ValueError(f"cannot build a safe id from {value!r}")
    return cleaned[:120]


def stable_id(source: str, source_id: str) -> str:
    """Deterministic id for scraped items, e.g. stable_id('tzura', '7313') -> 'tzura-7313'."""
    if source not in SOURCES:
        raise ValueError(f"unknown source {source!r}")
    return f"{source}-{slugify_id_part(source_id)}"


def safe_filename(entry_id: str) -> str:
    return f"{slugify_id_part(entry_id)}.json"


def entry_path(entry: dict[str, Any], archive_dir: Path = ARCHIVE_DIR) -> Path:
    return archive_dir / CATEGORY_DIRS[entry["category"]] / safe_filename(entry["id"])


# --------------------------------------------------------------------------- text


_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def normalize_content(text: str) -> str:
    """Normalize line endings and trim the text's outer edges, keeping its inner layout.

    * CRLF / CR -> LF
    * control characters (other than newline and tab) removed
    * trailing whitespace on each line removed (invisible, and HTML source indentation)
    * leading/trailing blank lines removed

    Interior blank lines (stanza breaks), punctuation, niqqud and leading indentation
    of interior lines are preserved exactly. No Unicode normalization is applied, so
    combining marks keep their original order.
    """
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_CHARS.sub("", text)
    lines = [line.rstrip() for line in text.split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def normalize_single_line(text: str | None) -> str | None:
    if text is None:
        return None
    collapsed = re.sub(r"\s+", " ", _CONTROL_CHARS.sub("", text)).strip()
    return collapsed or None


# --------------------------------------------------------------------------- entries


def make_entry(
    *,
    source: str,
    category: str,
    content: str,
    source_id: str | None = None,
    entry_id: str | None = None,
    title: str | None = None,
    author: str | None = DEFAULT_AUTHOR,
    posted_at: str | None = None,
    source_url: str | None = None,
    scraped_at: str | None = None,
    attachments: list[Any] | None = None,
    likes: int | None = None,
) -> ArchiveEntry:
    if entry_id is None:
        if source_id is None:
            raise ValueError("either entry_id or source_id is required")
        entry_id = stable_id(source, source_id)
    ts = now_iso()
    entry: ArchiveEntry = {
        "id": entry_id,
        "source": source,  # type: ignore[typeddict-item]
        "category": category,  # type: ignore[typeddict-item]
        "author": normalize_single_line(author) or DEFAULT_AUTHOR,
        "title": normalize_single_line(title),
        "content": normalize_content(content),
        "postedAt": posted_at,
        "sourceUrl": source_url,
        "sourceId": source_id,
        "scrapedAt": scraped_at,
        "createdAt": ts,
        "updatedAt": ts,
        "attachments": list(attachments or []),
    }
    if likes is not None:
        entry["likes"] = likes
    return entry


def order_fields(entry: dict[str, Any]) -> dict[str, Any]:
    ordered = {k: entry.get(k) for k in FIELD_ORDER if k in entry or k not in OPTIONAL_FIELDS}
    ordered["attachments"] = ordered["attachments"] or []
    # Keep unknown extra fields (future extensions) after the known ones.
    ordered.update({k: v for k, v in entry.items() if k not in ordered})
    return ordered


def validate_entry(entry: Any) -> list[str]:
    """Return a list of human-readable problems (empty list == valid)."""
    if not isinstance(entry, dict):
        return ["entry is not a JSON object"]
    errors: list[str] = []
    for key in REQUIRED_FIELDS:
        if key not in entry or entry[key] is None or (entry[key] == "" and key != "content"):
            errors.append(f"missing required field {key!r}")
    for key in FIELD_ORDER:
        if key not in entry:
            if key not in REQUIRED_FIELDS and key not in OPTIONAL_FIELDS:
                errors.append(f"missing field {key!r} (use null when unknown)")
    if entry.get("source") not in SOURCES:
        errors.append(f"invalid source {entry.get('source')!r}")
    if entry.get("category") not in CATEGORIES:
        errors.append(f"invalid category {entry.get('category')!r}")
    for key in ("id", "author", "content", "createdAt", "updatedAt"):
        if key in entry and not isinstance(entry[key], str):
            errors.append(f"field {key!r} must be a string")
    for key in ("title", "sourceUrl", "sourceId", "postedAt", "scrapedAt"):
        if entry.get(key) is not None and not isinstance(entry[key], str):
            errors.append(f"field {key!r} must be a string or null")
    has_images = isinstance(entry.get("attachments"), list) and any(
        isinstance(a, dict) and a.get("type") == "image" for a in entry["attachments"]
    )
    if isinstance(entry.get("content"), str) and not entry["content"].strip() and not has_images:
        errors.append("content is empty")
    edited = entry.get("editedFields")
    if edited is not None and (not isinstance(edited, list) or any(f not in EDITABLE_FIELDS for f in edited)):
        errors.append(f"editedFields must be a list of {EDITABLE_FIELDS}")
    for key in ("postedAt", "scrapedAt", "createdAt", "updatedAt", "editedAt"):
        value = entry.get(key)
        if isinstance(value, str) and not is_valid_iso(value):
            errors.append(f"field {key!r} is not a valid ISO date: {value!r}")
    if "attachments" in entry and not isinstance(entry["attachments"], list):
        errors.append("attachments must be a list")
    elif isinstance(entry.get("attachments"), list):
        for i, att in enumerate(entry["attachments"]):
            if not isinstance(att, dict) or att.get("type") != "image" or not isinstance(att.get("path"), str):
                errors.append(f"attachments[{i}] must be an object with type 'image' and a path")
            elif att["path"].startswith("/") or ".." in att["path"].split("/") or not att["path"].startswith("attachments/"):
                errors.append(f"attachments[{i}].path must be relative to archive/attachments/")
    likes = entry.get("likes")
    if likes is not None and (not isinstance(likes, int) or isinstance(likes, bool) or likes < 0):
        errors.append("likes must be a non-negative integer or null")
    if isinstance(entry.get("id"), str):
        try:
            if safe_filename(entry["id"]) != f"{entry['id']}.json":
                errors.append(f"id {entry['id']!r} contains unsafe characters")
        except ValueError:
            errors.append(f"id {entry['id']!r} contains unsafe characters")
    return errors


def dedupe_key(entry: dict[str, Any]) -> tuple[str, str]:
    """Identity of a work: (source, sourceId), falling back to sourceUrl, then id."""
    if entry.get("sourceId"):
        return (entry["source"], f"id:{entry['sourceId']}")
    if entry.get("sourceUrl"):
        return (entry["source"], f"url:{entry['sourceUrl']}")
    return (entry.get("source", ""), f"entry:{entry['id']}")


def dedupe_entries(entries: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep one entry per dedupe_key; when duplicated, the most recently updated wins."""
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in entries:
        key = dedupe_key(entry)
        current = best.get(key)
        if current is None or (entry.get("updatedAt") or "") > (current.get("updatedAt") or ""):
            best[key] = entry
    return list(best.values())


# --------------------------------------------------------------------------- json io


def dumps_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def write_json_atomic(path: Path, data: Any) -> None:
    """Write UTF-8 JSON (readable Hebrew) via a temp file + rename, so crashes never leave half files."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(dumps_json(data))
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def read_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def iter_archive_files(archive_dir: Path = ARCHIVE_DIR) -> Iterable[Path]:
    for dirname in CATEGORY_DIRS.values():
        folder = archive_dir / dirname
        if folder.is_dir():
            yield from sorted(folder.glob("*.json"))


def upsert_entry(entry: ArchiveEntry, archive_dir: Path = ARCHIVE_DIR, force: bool = False) -> str:
    """Create or update the entry's JSON file.

    Returns "created", "updated", "refreshed" (only metadata such as likes changed) or
    "unchanged". An existing file keeps its createdAt; updatedAt only moves when the work's
    actual fields changed (or force=True).
    Manual edits to fields not provided by the scraper are not overwritten with nulls.
    """
    errors = validate_entry(entry)
    if errors:
        raise ValueError(f"refusing to save invalid entry {entry.get('id')}: {errors}")
    path = entry_path(entry, archive_dir)
    if not path.exists():
        write_json_atomic(path, order_fields(dict(entry)))
        return "created"

    existing = read_json(path)
    merged = dict(existing)
    protected = set(existing.get("editedFields") or [])  # edited on the website: keep as is
    for key in CONTENT_FIELDS:
        if key in protected:
            continue
        new_value = entry.get(key)
        if new_value is None and existing.get(key) is not None:
            continue  # the source no longer shows it; keep what we archived
        merged[key] = new_value
    merged["scrapedAt"] = entry.get("scrapedAt") or existing.get("scrapedAt")
    merged["createdAt"] = existing.get("createdAt") or entry["createdAt"]

    for key in METADATA_FIELDS:
        if entry.get(key) is not None and key not in protected:
            merged[key] = entry[key]

    changed = any(merged.get(k) != existing.get(k) for k in CONTENT_FIELDS)
    refreshed = any(merged.get(k) != existing.get(k) for k in METADATA_FIELDS)
    if not changed and not force:
        if not refreshed:
            return "unchanged"
        write_json_atomic(path, order_fields(merged))
        return "refreshed"
    merged["updatedAt"] = entry["updatedAt"]
    write_json_atomic(path, order_fields(merged))
    return "updated"


def load_exclusions(path: Path | None = None) -> set[str]:
    """Entry ids deleted on the website (archive/excluded.json). Scrapers must not re-add them."""
    path = path or EXCLUSIONS_FILE
    if not path.exists():
        return set()
    data = read_json(path)
    return {e["id"] for e in data.get("entries", []) if isinstance(e, dict) and isinstance(e.get("id"), str)}


def validate_exclusions(data: Any) -> list[str]:
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        return ['must be an object with an "entries" list']
    errors = []
    for i, item in enumerate(data["entries"]):
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or item.get("source") not in SOURCES:
            errors.append(f"entries[{i}] needs a string id and a valid source")
    return errors


# --------------------------------------------------------------------------- checkpoints


@dataclass
class Checkpoint:
    """Small JSON progress file so interrupted scrapes can resume.

    Stored under scrapers/.state/ (git-ignored): it is runtime state, not archive data.
    """

    path: Path
    data: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, name: str, state_dir: Path = STATE_DIR) -> "Checkpoint":
        path = state_dir / f"{name}.json"
        data: dict[str, Any] = {}
        if path.exists():
            try:
                data = read_json(path)
            except (OSError, json.JSONDecodeError):
                logging.getLogger("archive").warning("checkpoint %s unreadable, starting fresh", path)
        return cls(path=path, data=data)

    def done_set(self, key: str = "done") -> set[str]:
        return set(self.data.get(key, []))

    def mark_done(self, item: str, key: str = "done") -> None:
        items = self.data.setdefault(key, [])
        if item not in items:
            items.append(item)

    def save(self) -> None:
        self.data["savedAt"] = now_iso()
        write_json_atomic(self.path, self.data)

    def reset(self) -> None:
        self.data = {}
        if self.path.exists():
            self.path.unlink()
