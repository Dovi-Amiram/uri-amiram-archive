import json

import pytest

import archive_utils as au


def test_stable_id_is_deterministic_and_safe():
    assert au.stable_id("tzura", "7313") == "tzura-7313"
    assert au.stable_id("tzura", "7313") == au.stable_id("tzura", "7313")
    assert au.stable_id("facebook", "123/../456") == "facebook-123-456"
    with pytest.raises(ValueError):
        au.stable_id("myspace", "1")
    with pytest.raises(ValueError):
        au.stable_id("tzura", "///")


def test_normalize_content_preserves_poetry_layout():
    raw = "\r\n   \r\nשורה א׳,  עם \"גרשיים\"   \r\n  שורה ב׳ מוזחת\r\n\r\nהלֶכֶת והנִכסף\r\n\r\n  "
    assert au.normalize_content(raw) == 'שורה א׳,  עם "גרשיים"\n  שורה ב׳ מוזחת\n\nהלֶכֶת והנִכסף'


def test_normalize_content_keeps_niqqud_order_untouched():
    text = "שָׁלוֹם"  # shin + qamats + shin dot: must not be unicode-normalized
    assert au.normalize_content(text) == text


def test_parse_dmy_date():
    assert au.parse_dmy_date("26/8/2003 ") == "2003-08-26"
    assert au.parse_dmy_date("31/2/2003") is None
    assert au.parse_dmy_date("no date") is None


def test_make_entry_and_validate():
    entry = au.make_entry(source="tzura", category="creation", source_id="1", title="  כותרת  ", content="שיר\n")
    assert entry["id"] == "tzura-1"
    assert entry["title"] == "כותרת"
    assert entry["content"] == "שיר"
    assert entry["author"] == au.DEFAULT_AUTHOR
    assert au.validate_entry(entry) == []


@pytest.mark.parametrize(
    "patch, message",
    [
        ({"category": "novel"}, "invalid category"),
        ({"source": "web"}, "invalid source"),
        ({"content": "   "}, "content is empty"),
        ({"postedAt": "yesterday"}, "not a valid ISO date"),
        ({"id": "../evil"}, "unsafe characters"),
    ],
)
def test_validate_entry_rejects_bad_values(patch, message):
    entry = au.make_entry(source="manual", category="palindrome", entry_id="manual-x", content="ילד כותב בתוך דלי")
    entry.update(patch)
    assert any(message in e for e in au.validate_entry(entry))


def test_validate_entry_requires_fields():
    errors = au.validate_entry({"id": "x"})
    assert any("'content'" in e for e in errors)
    assert any("'title'" in e for e in errors)


def test_dedupe_entries_prefers_latest_update():
    a = {"id": "tzura-1", "source": "tzura", "sourceId": "1", "updatedAt": "2024-01-01T00:00:00Z"}
    b = {"id": "tzura-1b", "source": "tzura", "sourceId": "1", "updatedAt": "2025-01-01T00:00:00Z"}
    c = {"id": "facebook-1", "source": "facebook", "sourceId": "1", "updatedAt": "2020-01-01T00:00:00Z"}
    result = au.dedupe_entries([a, b, c])
    assert sorted(e["id"] for e in result) == ["facebook-1", "tzura-1b"]


def test_upsert_creates_then_unchanged_then_updates(tmp_path):
    entry = au.make_entry(source="tzura", category="creation", source_id="5", title="א", content="תוכן")
    assert au.upsert_entry(entry, tmp_path) == "created"
    path = tmp_path / "creations" / "tzura-5.json"
    raw = path.read_text(encoding="utf-8")
    assert "תוכן" in raw and "\\u" not in raw  # readable Hebrew, not escaped
    first = json.loads(raw)

    again = au.make_entry(source="tzura", category="creation", source_id="5", title="א", content="תוכן")
    again["createdAt"] = again["updatedAt"] = "2099-01-01T00:00:00Z"
    assert au.upsert_entry(again, tmp_path) == "unchanged"
    assert json.loads(path.read_text(encoding="utf-8")) == first

    changed = dict(again, content="תוכן חדש")
    assert au.upsert_entry(changed, tmp_path) == "updated"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["content"] == "תוכן חדש"
    assert saved["createdAt"] == first["createdAt"]  # creation time survives updates
    assert saved["updatedAt"] == "2099-01-01T00:00:00Z"
    assert list(saved)[:3] == ["id", "source", "category"]


def test_upsert_does_not_erase_known_date(tmp_path):
    entry = au.make_entry(source="tzura", category="creation", source_id="6", content="x", posted_at="2003-01-01")
    au.upsert_entry(entry, tmp_path)
    au.upsert_entry(au.make_entry(source="tzura", category="creation", source_id="6", content="x"), tmp_path)
    saved = json.loads((tmp_path / "creations" / "tzura-6.json").read_text(encoding="utf-8"))
    assert saved["postedAt"] == "2003-01-01"


def test_checkpoint_roundtrip(tmp_path):
    cp = au.Checkpoint.load("test", tmp_path)
    cp.mark_done("1")
    cp.mark_done("1")
    cp.save()
    again = au.Checkpoint.load("test", tmp_path)
    assert again.done_set() == {"1"}
    again.reset()
    assert au.Checkpoint.load("test", tmp_path).done_set() == set()


def _image(path="attachments/facebook/1-p.jpg"):
    return {"type": "image", "path": path, "width": 10, "height": 10, "alt": None}


def test_image_only_entries_are_valid_but_bad_attachments_are_not():
    entry = au.make_entry(source="facebook", category="palindrome", source_id="1", content="", attachments=[_image()])
    assert au.validate_entry(entry) == []
    for bad in ("../../etc/passwd", "/abs.jpg", "creations/x.jpg"):
        broken = dict(entry, attachments=[_image(bad)])
        assert any("attachments[0].path" in e for e in au.validate_entry(broken))
    assert any("likes" in e for e in au.validate_entry(dict(entry, likes=-1)))
    assert any("likes" in e for e in au.validate_entry(dict(entry, likes="5")))


def test_likes_change_refreshes_without_moving_updated_at(tmp_path):
    first = au.make_entry(source="facebook", category="palindrome", source_id="9", content="אבא", likes=3)
    assert au.upsert_entry(first, tmp_path) == "created"
    path = tmp_path / "palindromes" / "facebook-9.json"
    before = json.loads(path.read_text(encoding="utf-8"))

    later = au.make_entry(source="facebook", category="palindrome", source_id="9", content="אבא", likes=5)
    later["updatedAt"] = "2099-01-01T00:00:00Z"
    assert au.upsert_entry(later, tmp_path) == "refreshed"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["likes"] == 5
    assert saved["updatedAt"] == before["updatedAt"]


def test_entries_without_likes_do_not_get_the_field():
    entry = au.make_entry(source="tzura", category="creation", source_id="3", content="x")
    assert "likes" not in entry
    assert "likes" not in au.order_fields(entry)


def test_edited_fields_are_never_overwritten_by_scrapers(tmp_path):
    original = au.make_entry(source="facebook", category="palindrome", source_id="7", content="ישן", likes=3)
    au.upsert_entry(original, tmp_path)
    path = tmp_path / "palindromes" / "facebook-7.json"
    saved = json.loads(path.read_text(encoding="utf-8"))
    saved.update(content="תוקן ידנית", likes=50, editedAt="2026-09-15T08:00:00Z", editedFields=["content", "likes"])
    au.write_json_atomic(path, saved)

    rescraped = au.make_entry(source="facebook", category="palindrome", source_id="7", content="ישן", likes=9, posted_at="2020-01-01")
    assert au.upsert_entry(rescraped, tmp_path) == "updated"  # postedAt was not edited, so it may fill in
    after = json.loads(path.read_text(encoding="utf-8"))
    assert after["content"] == "תוקן ידנית"
    assert after["likes"] == 50
    assert after["postedAt"] == "2020-01-01"
    assert au.validate_entry(after) == []
    assert any("editedFields" in e for e in au.validate_entry(dict(after, editedFields=["id"])))


def test_load_exclusions(tmp_path):
    path = tmp_path / "excluded.json"
    assert au.load_exclusions(path) == set()
    au.write_json_atomic(path, {"entries": [{"id": "facebook-1", "source": "facebook"}, {"id": "tzura-2", "source": "tzura"}]})
    assert au.load_exclusions(path) == {"facebook-1", "tzura-2"}
    assert au.validate_exclusions({"entries": [{"id": 5}]})
    assert au.validate_exclusions({"entries": []}) == []


def test_refresh_likes_changes_only_likes_and_respects_manual_edits(tmp_path):
    entry = au.make_entry(source="facebook", category="palindrome", source_id="8", content="אבא", likes=0)
    au.upsert_entry(entry, tmp_path)
    path = tmp_path / "palindromes" / "facebook-8.json"
    before = json.loads(path.read_text(encoding="utf-8"))

    assert au.refresh_likes("facebook-8", "palindrome", 12, tmp_path) == (0, 12)
    after = json.loads(path.read_text(encoding="utf-8"))
    assert after["likes"] == 12
    assert {k: v for k, v in after.items() if k != "likes"} == {k: v for k, v in before.items() if k != "likes"}
    assert au.refresh_likes("facebook-8", "palindrome", 12, tmp_path) is None  # unchanged

    after["editedFields"] = ["likes"]
    au.write_json_atomic(path, after)
    assert au.refresh_likes("facebook-8", "palindrome", 99, tmp_path) is None
    assert json.loads(path.read_text(encoding="utf-8"))["likes"] == 12
    assert au.refresh_likes("facebook-missing", "palindrome", 5, tmp_path) is None
