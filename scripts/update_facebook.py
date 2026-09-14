#!/usr/bin/env python3
"""Archive new Facebook palindrome posts, then commit and push.  (Terminal command: update-palindromes)

    update-palindromes                 # pull, scrape new posts, validate, commit, push
    update-palindromes --dry-run       # only list the new posts it would save
    update-palindromes --login         # log in to Facebook by hand (visible browser), then exit
    update-palindromes --no-push       # commit locally only
    update-palindromes --full-history  # scan the whole history for anything missed (slow)
    update-palindromes --refresh-all-likes   # also update like counts of ALL archived posts (~15-20 min)

What it does
  1. Checks the repository (on main, no uncommitted archive changes) and pulls the latest version,
     so entries added/edited/deleted on the website are respected.
  2. Runs scrapers/facebook_scraper.py --new-only: scrolls the group from the newest post and saves
     posts that (a) have an id not archived yet, (b) were not deleted on the website
     (archive/excluded.json) and (c) are dated after the newest archived post — with their photos
     and like counts. Existing entries are never touched. It stops once it reaches archived posts.
     If the Facebook session expired it logs in with .facebook.env. (--full-history drops rule (c).)
     It also updates the like counts of archived posts from the last 60 days that it sees
     (--likes-days N to change, --refresh-all-likes for every post). Likes edited on the website
     are never overwritten, and nothing but the like count changes.
  3. Checks the run for anything suspicious and validates the whole archive.
  4. Commits the new files in one commit and pushes; GitHub Actions redeploys the site.

Problems are shown in a red block at the end, with a terminal bell and a desktop notification.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_PATHS = ["archive/palindromes", "archive/attachments", "archive/raw/facebook"]
REPORT_FILE = REPO_ROOT / "scrapers" / ".state" / "facebook-last-run.json"
SITE_URL = "https://dovi-amiram.github.io/uri-amiram-archive/"

EXIT_LOGIN_REQUIRED = 2
EXIT_VERIFICATION_REQUIRED = 3


# --------------------------------------------------------------------------- terminal output


class Console:
    def __init__(self, color: bool):
        self.color = color
        self.step_no = 0

    def _c(self, code: str, text: str) -> str:
        return f"\033[{code}m{text}\033[0m" if self.color else text

    def step(self, title: str, total: int) -> None:
        self.step_no += 1
        print(f"\n{self._c('1;36', f'[{self.step_no}/{total}]')} {self._c('1', title)}", flush=True)

    def ok(self, text: str) -> None:
        print(f"  {self._c('32', '✓')} {text}", flush=True)

    def info(self, text: str) -> None:
        print(f"  {self._c('2', '•')} {text}", flush=True)

    def warn(self, text: str) -> None:
        print(f"  {self._c('33', '!')} {text}", flush=True)

    def fail(self, text: str) -> None:
        print(f"  {self._c('31', '✗')} {text}", flush=True)

    def block(self, title: str, lines: list[str], code: str) -> None:
        bar = "━" * 64
        print("\n" + self._c(code, bar))
        print(self._c(f"1;{code}", f"  {title}"))
        for line in lines:
            print(self._c(code, f"  - {line}"))
        print(self._c(code, bar), flush=True)


def notify(title: str, message: str, urgent: bool) -> None:
    """Terminal bell plus a desktop notification when available (never fails the run)."""
    sys.stdout.write("\a")
    sys.stdout.flush()
    if shutil.which("notify-send") and (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        try:
            subprocess.run(
                ["notify-send", "-u", "critical" if urgent else "normal", "-a", "update-palindromes", title, message],
                check=False,
                timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            pass


# --------------------------------------------------------------------------- checks


class UpdateError(Exception):
    pass


@dataclass
class Assessment:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def assess_report(report: dict[str, Any] | None, exit_code: int) -> Assessment:
    """Turn the scraper's run report into human-readable problems."""
    result = Assessment()
    if exit_code == EXIT_VERIFICATION_REQUIRED:
        result.errors.append("Facebook asks for a security check / two-factor code. Run `update-palindromes --login` and log in by hand.")
        return result
    if exit_code == EXIT_LOGIN_REQUIRED:
        result.errors.append(
            "Not logged in to Facebook and automatic login was not possible. Check .facebook.env or run `update-palindromes --login`."
        )
        return result
    if exit_code != 0:
        result.errors.append(f"The Facebook scraper failed (exit code {exit_code}); see the log above.")
    if report is None:
        result.errors.append("The scraper did not write a run report.")
        return result

    if report.get("stopReason") == "wrong-page":
        result.errors.append(f"Facebook did not open the group member page (landed on {report.get('landedOn')}). Nothing was scraped.")
        return result
    if report.get("otherGroup", 0):
        result.warnings.append(f"{report['otherGroup']} post(s) linked to another group were ignored.")
    if report.get("sessionEnded") and report.get("postsSeen", 0) == 0:
        result.errors.append("Facebook logged the session out. Run `update-palindromes --login` (or add credentials to .facebook.env) and try again.")
    elif report.get("postsSeen", 0) == 0:
        result.errors.append("Facebook showed no posts at all. The page layout may have changed; run with --headed to look.")
    elif report.get("targetPosts", 0) == 0:
        result.errors.append("Posts were found, but none by Uri Amiram. The author detection may be broken.")
    if report.get("domWarnings", 0):
        result.warnings.append("Some posts had no readable id (Facebook page structure changed?). Consider a --headed --dry-run check.")
    if report.get("mode") == "new-only" and report.get("stopReason") == "end-of-feed" and report.get("targetPosts", 0) > 0:
        if report.get("alreadyArchivedSeen", 0) == 0:
            result.warnings.append("Scrolling ended before reaching any already-archived post; older new posts may have been missed. Try --full-history.")
    if report.get("undated", 0):
        result.warnings.append(f"{report['undated']} post(s) had no readable date and were skipped (rule: only posts newer than the archive).")
    if report.get("photoFailures", 0):
        result.warnings.append(f"{report['photoFailures']} photo(s) could not be downloaded; they will be retried on the next run.")
    if len(report.get("newPostIds") or []) > 60:
        result.warnings.append(f"Unusually many new posts ({len(report['newPostIds'])}); check that ids did not change format.")
    if str(report.get("login", "")).startswith("automatic:ok"):
        result.warnings.append("The Facebook session had expired; logged in automatically with .facebook.env.")
    return result


def commit_message(new_entries: list[dict], likes_updates: list[dict] | None = None) -> str:
    """Readable commit message listing new posts (newest first) and like-count updates."""
    count = len(new_entries)
    likes_updates = likes_updates or []
    parts = []
    if count:
        parts.append("Add 1 new palindrome post from Facebook" if count == 1 else f"Add {count} new palindrome posts from Facebook")
    if likes_updates:
        n = len(likes_updates)
        parts.append(("update" if count else "Update") + f" likes on {n} post{'s' if n != 1 else ''}")
    subject = "; ".join(parts) or "Update Facebook archive files"
    lines = []
    for entry in sorted(new_entries, key=lambda e: e.get("postedAt") or "", reverse=True):
        first_line = next((line.strip() for line in (entry.get("content") or "").splitlines() if line.strip()), "(תמונה)")
        if len(first_line) > 60:
            first_line = first_line[:57] + "..."
        date = (entry.get("postedAt") or "")[:10] or "undated"
        lines.append(f"- {date} {entry['id']}: {first_line}")
    if likes_updates:
        if lines:
            lines.append("")
        lines.append("Likes:")
        lines.extend(f"- {u['id']}: {u['old'] if u['old'] is not None else '-'} -> {u['new']}" for u in likes_updates)
    return subject + ("\n\n" + "\n".join(lines) if lines else "") + "\n"


# --------------------------------------------------------------------------- git


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=REPO_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise UpdateError(f"git {' '.join(args)} failed{': ' + detail if detail else ''}")
    return result.stdout


def preflight(allow_branch: bool) -> str:
    branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
    if branch != "main" and not allow_branch:
        raise UpdateError(f"current branch is {branch!r}; switch to main (git checkout main)")
    dirty = git("status", "--porcelain", "--", "archive").strip()
    if dirty:
        raise UpdateError("archive/ has uncommitted changes; commit or discard them first:\n" + dirty)
    if not git("config", "user.email").strip():
        raise UpdateError('git has no user identity; run: git config user.name "..." && git config user.email "..."')
    return branch


# --------------------------------------------------------------------------- main


def run_scraper(args: argparse.Namespace, console: Console) -> int:
    command = [sys.executable, str(REPO_ROOT / "scrapers" / "facebook_scraper.py")]
    if args.login:
        command += ["--login"]
    else:
        command += ["--new-only", "--save-raw", "--headed" if args.headed else "--headless"]
        if args.full_history:
            command += ["--stop-after-known", "0"]
        if args.refresh_all_likes:
            command += ["--refresh-all-likes"]
        if args.likes_days is not None:
            command += ["--likes-days", str(args.likes_days)]
        if args.dry_run:
            command.append("--dry-run")
    console.info("$ " + " ".join(Path(c).name if i < 2 else c for i, c in enumerate(command)))
    if REPORT_FILE.exists():
        REPORT_FILE.unlink()
    return subprocess.run(command, cwd=REPO_ROOT).returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="update-palindromes", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="scrape and list new posts; no files, commit or push")
    parser.add_argument("--login", action="store_true", help="log in to Facebook by hand in a visible browser, then exit")
    parser.add_argument("--no-push", action="store_true", help="commit but do not push")
    parser.add_argument("--no-pull", action="store_true", help="skip git pull (e.g. offline)")
    parser.add_argument("--full-history", action="store_true", help="scroll the whole history instead of stopping at known posts")
    parser.add_argument("--refresh-all-likes", action="store_true", help="update like counts of all archived posts (scrolls whole history, ~15-20 min)")
    parser.add_argument("--likes-days", type=int, default=None, help="refresh likes of archived posts from the last N days (default 60, 0 = off)")
    parser.add_argument("--headed", action="store_true", help="show the browser window")
    parser.add_argument("--allow-branch", action="store_true", help="allow running on a branch other than main")
    parser.add_argument("--no-notify", action="store_true", help="no bell / desktop notification")
    parser.add_argument("--no-color", action="store_true", help="plain output")
    args = parser.parse_args(argv)
    console = Console(color=sys.stdout.isatty() and not args.no_color and not os.environ.get("NO_COLOR"))
    os.chdir(REPO_ROOT)

    if args.login:
        console.step("Facebook login (a browser window will open)", 1)
        code = run_scraper(args, console)
        (console.ok if code == 0 else console.fail)("logged in; session saved" if code == 0 else "login was not completed")
        return code

    total = 3 if args.dry_run else 5
    problems = Assessment()
    new_count = 0
    likes_updates: list[dict] = []
    try:
        console.step("Checking the repository", total)
        branch = preflight(args.allow_branch)
        console.ok(f"on {branch}, archive has no uncommitted changes")
        if not args.no_pull and not args.dry_run:
            git("pull", "--ff-only")
            console.ok("pulled latest changes (including edits made on the website)")

        console.step("Scraping new posts from the Facebook group", total)
        code = run_scraper(args, console)
        report = json.loads(REPORT_FILE.read_text(encoding="utf-8")) if REPORT_FILE.exists() else None
        problems = assess_report(report, code)
        if problems.errors:
            raise UpdateError("the scrape did not complete correctly")
        new_ids = (report or {}).get("newPostIds") or []
        new_count = len(new_ids)
        likes_updates = (report or {}).get("likesUpdated") or []
        console.ok(
            f"{report['postsSeen']} posts seen · {report.get('alreadyArchivedSeen', 0)} already archived · "
            f"{new_count} new · stopped: {report.get('stopReason')}"
        )
        if report.get("newerThan"):
            console.info(f"only posts after {report['newerThan']} count as new")
        if likes_updates:
            console.ok(f"like counts {'to update' if args.dry_run else 'updated'} on {len(likes_updates)} post(s)")
            for u in likes_updates[:10]:
                console.info(f"{u['id']}: {u['old'] if u['old'] is not None else '-'} → {u['new']}")
        else:
            console.info("no like counts changed")

        console.step("Checking the results", total)
        for warning in problems.warnings:
            console.warn(warning)
        if args.dry_run:
            console.ok(
                "dry run: nothing was saved"
                + (f"; would add {new_count} post(s)" if new_count else "; no new posts")
                + (f" and update likes on {len(likes_updates)}" if likes_updates else "")
            )
            return finish(console, args, problems, new_count, dry_run=True, likes_count=len(likes_updates))
        validate = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "build_archive_indexes.py"), "--check"], cwd=REPO_ROOT, capture_output=True, text=True
        )
        if validate.returncode != 0:
            problems.errors.append("Archive validation failed; nothing was committed:\n" + (validate.stderr or validate.stdout).strip())
            raise UpdateError("archive validation failed")
        console.ok("archive is valid")

        console.step("Committing", total)
        if not git("status", "--porcelain", "--", *ARCHIVE_PATHS).strip():
            console.ok("no new posts or like changes, nothing to commit")
            console.step("Publishing", total)
            console.ok("nothing to publish")
            return finish(console, args, problems, 0, likes_count=len(likes_updates))
        git("add", "--", *ARCHIVE_PATHS)
        added = git("diff", "--cached", "--name-only", "--diff-filter=A", "--", "archive/palindromes").split()
        entries = [json.loads((REPO_ROOT / path).read_text(encoding="utf-8")) for path in added]
        message = commit_message(entries, likes_updates)
        git("commit", "-m", message)
        new_count = len(entries)
        console.ok(message.splitlines()[0])
        for line in [l for l in message.splitlines()[2:] if l.startswith("- ")][:12]:
            console.info(line.removeprefix("- "))

        console.step("Publishing", total)
        if args.no_push:
            console.warn("not pushed (--no-push); run `git push` to publish")
        else:
            git("push")
            console.ok(f"pushed; the site updates within a few minutes: {SITE_URL}")
        return finish(console, args, problems, new_count, likes_count=len(likes_updates))
    except UpdateError as exc:
        if not problems.errors:
            problems.errors.append(str(exc))
        return finish(console, args, problems, new_count)
    except KeyboardInterrupt:
        problems.errors.append("Interrupted. Already-saved posts are kept; run again to continue.")
        return finish(console, args, problems, new_count)


def finish(console: Console, args: argparse.Namespace, problems: Assessment, new_count: int, dry_run: bool = False, likes_count: int = 0) -> int:
    if problems.errors:
        console.block("UPDATE FAILED", problems.errors + problems.warnings, "31")
        if not args.no_notify:
            notify("update-palindromes failed", problems.errors[0][:200], urgent=True)
        return 1
    if problems.warnings:
        console.block("Finished with warnings", problems.warnings, "33")
        if not args.no_notify:
            notify("update-palindromes: check the warnings", problems.warnings[0][:200], urgent=False)
    summary = f"{new_count} new palindrome post(s) {'found' if dry_run else 'archived'}" if new_count else "No new palindrome posts"
    if likes_count:
        summary += f"; like counts {'to update' if dry_run else 'updated'} on {likes_count} post(s)"
    print(f"\n{console._c('1;32', '✓ ' + summary)}")
    if (new_count or likes_count) and not problems.warnings and not args.no_notify and not dry_run:
        notify("update-palindromes", summary, urgent=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
