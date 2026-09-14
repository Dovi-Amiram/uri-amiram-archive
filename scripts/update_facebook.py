#!/usr/bin/env python3
"""Monthly update: archive new Facebook palindrome posts, then commit and push.

    .venv/bin/python scripts/update_facebook.py              # scrape new posts, commit, push
    .venv/bin/python scripts/update_facebook.py --dry-run    # only show which new posts would be saved
    .venv/bin/python scripts/update_facebook.py --no-push    # commit locally, push later with `git push`
    .venv/bin/python scripts/update_facebook.py --full-history   # scan all history for missed posts

Steps:
  1. Check the repository is on main, has no uncommitted archive changes, and pull the latest
     version (so entries added on the website are not lost).
  2. Run scrapers/facebook_scraper.py --new-only: the group page lists newest posts first; it saves
     posts whose id is not archived yet (with their photos) and stops when it reaches known posts.
  3. Validate the whole archive.
  4. Commit the new files (archive/palindromes, archive/attachments, archive/raw/facebook) and push.
     The push triggers GitHub Actions, which redeploys the site.

If Facebook asks to log in again, run:  .venv/bin/python scrapers/facebook_scraper.py --login
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_PATHS = ["archive/palindromes", "archive/attachments", "archive/raw/facebook"]
SITE_URL = "https://dovi-amiram.github.io/uri-amiram-archive/"


class UpdateError(Exception):
    pass


def git(*args: str, capture: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=REPO_ROOT, text=True, capture_output=capture)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() if capture else ""
        raise UpdateError(f"git {' '.join(args)} failed{': ' + detail if detail else ''}")
    return result.stdout if capture else ""


def commit_message(new_entries: list[dict]) -> str:
    """Readable commit message listing the new posts (newest first)."""
    count = len(new_entries)
    subject = "Add 1 new palindrome post from Facebook" if count == 1 else f"Add {count} new palindrome posts from Facebook"
    lines = []
    for entry in sorted(new_entries, key=lambda e: e.get("postedAt") or "", reverse=True):
        first_line = next((line.strip() for line in (entry.get("content") or "").splitlines() if line.strip()), "(תמונה)")
        if len(first_line) > 60:
            first_line = first_line[:57] + "..."
        date = (entry.get("postedAt") or "")[:10] or "undated"
        lines.append(f"- {date} {entry['id']}: {first_line}")
    return subject + ("\n\n" + "\n".join(lines) if lines else "") + "\n"


def preflight(allow_branch: bool) -> None:
    branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
    if branch != "main" and not allow_branch:
        raise UpdateError(f"current branch is {branch!r}; switch to main (git checkout main)")
    dirty = git("status", "--porcelain", "--", "archive").strip()
    if dirty:
        raise UpdateError("archive/ has uncommitted changes; commit or discard them first:\n" + dirty)
    if not git("config", "user.email").strip():
        raise UpdateError('git has no user identity; run: git config user.name "..." && git config user.email "..."')


def run_scraper(args: argparse.Namespace) -> None:
    command = [
        sys.executable,
        str(REPO_ROOT / "scrapers" / "facebook_scraper.py"),
        "--new-only",
        "--save-raw",
        "--headed" if args.headed else "--headless",
    ]
    if args.full_history:
        command += ["--stop-after-known", "0"]
    if args.dry_run:
        command.append("--dry-run")
    print("$", " ".join(command[1:]), flush=True)
    code = subprocess.run(command, cwd=REPO_ROOT).returncode
    if code == 2:
        raise UpdateError("Facebook session is not logged in. Run: .venv/bin/python scrapers/facebook_scraper.py --login")
    if code != 0:
        raise UpdateError(f"Facebook scraper failed (exit code {code})")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="scrape and print new posts; no files, commit or push")
    parser.add_argument("--no-push", action="store_true", help="commit but do not push")
    parser.add_argument("--no-pull", action="store_true", help="skip git pull (e.g. offline)")
    parser.add_argument("--full-history", action="store_true", help="scroll the whole history instead of stopping at known posts")
    parser.add_argument("--headed", action="store_true", help="show the browser window")
    parser.add_argument("--allow-branch", action="store_true", help="allow running on a branch other than main")
    args = parser.parse_args(argv)

    try:
        preflight(args.allow_branch)
        if not args.no_pull and not args.dry_run:
            print("$ git pull --ff-only", flush=True)
            git("pull", "--ff-only", capture=False)

        run_scraper(args)
        if args.dry_run:
            print("\nDry run finished; nothing was saved.")
            return 0

        validate = subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "build_archive_indexes.py"), "--check"], cwd=REPO_ROOT)
        if validate.returncode != 0:
            raise UpdateError("archive validation failed; nothing was committed (see messages above)")

        if not git("status", "--porcelain", "--", *ARCHIVE_PATHS).strip():
            print("\nNo new posts. Nothing to commit.")
            return 0

        git("add", "--", *ARCHIVE_PATHS)
        added = git("diff", "--cached", "--name-only", "--diff-filter=A", "--", "archive/palindromes").split()
        new_entries = [json.loads((REPO_ROOT / path).read_text(encoding="utf-8")) for path in added]
        if not new_entries:
            # Only raw/attachment files changed (e.g. a retried photo); still worth keeping.
            message = "Update Facebook archive files\n"
        else:
            message = commit_message(new_entries)
        git("commit", "-m", message)
        print(f"\nCommitted: {message.splitlines()[0]}")

        if args.no_push:
            print("Not pushed (--no-push). Run `git push` to publish.")
            return 0
        print("$ git push", flush=True)
        git("push", capture=False)
        print(f"\nPushed. The site will update within a few minutes: {SITE_URL}")
        return 0
    except UpdateError as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
