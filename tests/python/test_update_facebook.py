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
