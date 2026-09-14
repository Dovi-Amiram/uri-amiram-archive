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
