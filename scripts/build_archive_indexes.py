#!/usr/bin/env python3
"""Build the frontend's static data files from the canonical archive.

Reads   archive/creations/*.json and archive/palindromes/*.json
Writes  public/data/creations.json, public/data/palindromes.json, public/data/version.json
Copies  archive/attachments/ -> public/attachments/ (images referenced by entries)

Every entry is validated (required fields, allowed category/source, unique ids, file
placed in the directory matching its category). Any problem aborts with exit code 1.

    python scripts/build_archive_indexes.py           # validate + write
    python scripts/build_archive_indexes.py --check   # validate only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scrapers"))
from archive_utils import (  # noqa: E402
    ARCHIVE_DIR,
    CATEGORY_DIRS,
    REPO_ROOT,
    dedupe_key,
    dumps_json,
    now_iso,
    validate_exclusions,
    read_json,
    validate_entry,
    write_json_atomic,
)

OUTPUT_DIR = REPO_ROOT / "public" / "data"


def sort_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Dated entries newest-first, then undated entries ordered by title, createdAt, id.

    ISO strings sort chronologically as text, so no date parsing is needed.
    """
    dated = sorted((e for e in entries if e.get("postedAt")), key=lambda e: (e["postedAt"], e["id"]), reverse=True)
    undated = sorted(
        (e for e in entries if not e.get("postedAt")),
        key=lambda e: (e.get("title") is None, e.get("title") or "", e.get("createdAt") or "", e["id"]),
    )
    return dated + undated


def load_archive(archive_dir: Path) -> tuple[dict[str, list[dict[str, Any]]], list[str]]:
    by_category: dict[str, list[dict[str, Any]]] = {c: [] for c in CATEGORY_DIRS}
    errors: list[str] = []
    seen_ids: dict[str, Path] = {}
    seen_keys: dict[tuple[str, str], Path] = {}

    for category, dirname in CATEGORY_DIRS.items():
        folder = archive_dir / dirname
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.json")):
            rel = path.relative_to(archive_dir.parent) if archive_dir.parent in path.parents else path
            try:
                entry = read_json(path)
            except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
                errors.append(f"{rel}: invalid JSON ({exc})")
                continue
            problems = validate_entry(entry)
            if problems:
                errors.extend(f"{rel}: {p}" for p in problems)
                continue
            if entry["category"] != category:
                errors.append(f"{rel}: category {entry['category']!r} does not match directory {dirname!r}")
            for att in entry.get("attachments") or []:
                if not (archive_dir / att["path"]).is_file():
                    errors.append(f"{rel}: attachment file missing: archive/{att['path']}")
            if path.stem != entry["id"]:
                errors.append(f"{rel}: filename does not match id {entry['id']!r}")
            if entry["id"] in seen_ids:
                errors.append(f"{rel}: duplicate id {entry['id']!r} (also in {seen_ids[entry['id']]})")
            seen_ids[entry["id"]] = rel
            key = dedupe_key(entry)
            if key in seen_keys:
                errors.append(f"{rel}: duplicate source item {key} (also in {seen_keys[key]})")
            seen_keys[key] = rel
            by_category[category].append(entry)

    exclusions_path = archive_dir / "excluded.json"
    if exclusions_path.exists():
        try:
            exclusions = read_json(exclusions_path)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            errors.append(f"archive/excluded.json: invalid JSON ({exc})")
        else:
            errors.extend(f"archive/excluded.json: {p}" for p in validate_exclusions(exclusions))
            if not errors:
                for item in exclusions["entries"]:
                    if item["id"] in seen_ids:
                        errors.append(
                            f"{seen_ids[item['id']]}: entry is listed in archive/excluded.json (deleted); "
                            "remove it from excluded.json to restore it"
                        )
    return by_category, errors


def sync_attachments(archive_dir: Path, public_dir: Path) -> int:
    """Mirror archive/attachments/ into the site so images are served next to the app."""
    source = archive_dir / "attachments"
    if public_dir.exists():
        shutil.rmtree(public_dir)
    if not source.is_dir():
        return 0
    shutil.copytree(source, public_dir)
    return sum(1 for f in public_dir.rglob("*") if f.is_file())


def build(
    archive_dir: Path = ARCHIVE_DIR,
    output_dir: Path = OUTPUT_DIR,
    check_only: bool = False,
    attachments_dir: Path | None = None,
) -> int:
    by_category, errors = load_archive(archive_dir)
    if errors:
        print(f"archive validation failed with {len(errors)} problem(s):", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    outputs = {f"{CATEGORY_DIRS[c]}.json": sort_entries(entries) for c, entries in by_category.items()}
    digest = hashlib.sha256("".join(dumps_json(v) for v in outputs.values()).encode("utf-8")).hexdigest()
    counts = {name: len(items) for name, items in outputs.items()}

    if check_only:
        print(f"archive OK: {counts}")
        return 0

    for name, items in outputs.items():
        write_json_atomic(output_dir / name, items)
    copied = sync_attachments(archive_dir, attachments_dir or output_dir.parent / "attachments")
    write_json_atomic(
        output_dir / "version.json",
        {
            # The content hash changes whenever any entry changes; the commit (when built in CI)
            # makes each deployment distinguishable.
            "buildId": f"{digest[:16]}-{os.environ.get('GITHUB_SHA', 'local')[:12]}",
            "contentHash": digest,
            "generatedAt": now_iso(),
            "counts": counts,
        },
    )
    print(f"wrote indexes to {output_dir}: {counts}; {copied} attachment file(s)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="validate only, do not write output files")
    parser.add_argument("--archive-dir", type=Path, default=ARCHIVE_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args(argv)
    return build(args.archive_dir, args.output_dir, args.check)


if __name__ == "__main__":
    sys.exit(main())
