import update_facebook as uf


def test_commit_message_lists_new_posts_newest_first():
    entries = [
        {"id": "facebook-1", "postedAt": "2026-08-01T10:00:00Z", "content": "ילד כותב בתוך דלי\nשורה שנייה"},
        {"id": "facebook-2", "postedAt": "2026-09-01T10:00:00Z", "content": "א" * 80},
        {"id": "facebook-3", "postedAt": None, "content": ""},
    ]
    message = uf.commit_message(entries)
    lines = message.splitlines()
    assert lines[0] == "Add 3 new palindrome posts from Facebook"
    assert lines[2].startswith("- 2026-09-01 facebook-2: ") and lines[2].endswith("...")
    assert lines[3] == "- 2026-08-01 facebook-1: ילד כותב בתוך דלי"
    assert lines[4] == "- undated facebook-3: (תמונה)"


def test_commit_message_singular():
    assert uf.commit_message([{"id": "facebook-9", "postedAt": "2026-01-01", "content": "x"}]).startswith(
        "Add 1 new palindrome post from Facebook"
    )


def test_assess_report_healthy_run_has_no_problems():
    report = {"mode": "new-only", "postsSeen": 40, "targetPosts": 38, "alreadyArchivedSeen": 35, "stopReason": "reached-archived",
              "newPostIds": ["1", "2"], "photoFailures": 0, "domWarnings": 0, "login": "session"}
    result = uf.assess_report(report, 0)
    assert result.errors == [] and result.warnings == []


def test_assess_report_login_problems_are_errors():
    assert "security check" in uf.assess_report(None, uf.EXIT_VERIFICATION_REQUIRED).errors[0]
    assert ".facebook.env" in uf.assess_report(None, uf.EXIT_LOGIN_REQUIRED).errors[0]
    assert uf.assess_report(None, 1).errors


def test_assess_report_flags_suspicious_runs():
    empty = uf.assess_report({"postsSeen": 0}, 0)
    assert any("no posts" in e for e in empty.errors)
    nobody = uf.assess_report({"postsSeen": 10, "targetPosts": 0}, 0)
    assert any("none by Uri Amiram" in e for e in nobody.errors)
    partial = uf.assess_report(
        {"mode": "new-only", "postsSeen": 10, "targetPosts": 10, "alreadyArchivedSeen": 0, "stopReason": "end-of-feed",
         "photoFailures": 2, "domWarnings": 1, "login": "automatic:ok"},
        0,
    )
    text = " ".join(partial.warnings)
    assert "--full-history" in text and "2 photo" in text and "automatically" in text and "page structure" in text
    assert partial.errors == []


def test_logged_out_session_is_reported_as_login_problem():
    result = uf.assess_report({"postsSeen": 0, "sessionEnded": True}, 0)
    assert any("logged the session out" in e for e in result.errors)
    assert not any("layout" in e for e in result.errors)


def test_wrong_page_is_an_error():
    result = uf.assess_report({"stopReason": "wrong-page", "landedOn": "https://www.facebook.com/groups/1435021850049747/"}, 1)
    assert any("did not open the group member page" in e for e in result.errors)


def test_commit_message_with_likes_updates():
    msg = uf.commit_message(
        [{"id": "facebook-1", "postedAt": "2026-09-14T15:05:38Z", "content": "עשרת ימי תשובה"}],
        [{"id": "facebook-2", "old": 0, "new": 7}, {"id": "facebook-3", "old": None, "new": 2}],
    )
    lines = msg.splitlines()
    assert lines[0] == "Add 1 new palindrome post from Facebook; update likes on 2 posts"
    assert "- facebook-2: 0 -> 7" in lines and "- facebook-3: - -> 2" in lines
    only_likes = uf.commit_message([], [{"id": "facebook-2", "old": 0, "new": 1}])
    assert only_likes.splitlines()[0] == "Update likes on 1 post"
