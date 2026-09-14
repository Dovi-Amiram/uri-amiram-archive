import json

import archive_utils as au
import build_archive_indexes as bai


def _save(archive_dir, **kwargs):
    entry = au.make_entry(**kwargs)
    au.write_json_atomic(au.entry_path(entry, archive_dir), entry)
    return entry


def test_build_writes_sorted_indexes_and_version(tmp_path):
    archive = tmp_path / "archive"
    out = tmp_path / "out"
    _save(archive, source="tzura", category="creation", source_id="1", title="ב", content="a", posted_at="2003-08-26")
    _save(archive, source="tzura", category="creation", source_id="2", title="א", content="b", posted_at="2010-01-01")
    _save(archive, source="manual", category="creation", entry_id="manual-b", title="ת", content="c")
    _save(archive, source="manual", category="creation", entry_id="manual-a", title="א", content="d")
    _save(archive, source="facebook", category="palindrome", source_id="99", content="ילד כותב בתוך דלי")

    assert bai.build(archive, out) == 0

    creations = json.loads((out / "creations.json").read_text(encoding="utf-8"))
    assert [e["id"] for e in creations] == ["tzura-2", "tzura-1", "manual-a", "manual-b"]
    palindromes = json.loads((out / "palindromes.json").read_text(encoding="utf-8"))
    assert [e["content"] for e in palindromes] == ["ילד כותב בתוך דלי"]
    assert "ילד" in (out / "palindromes.json").read_text(encoding="utf-8")

    version = json.loads((out / "version.json").read_text(encoding="utf-8"))
    assert version["counts"] == {"creations.json": 4, "palindromes.json": 1}
    assert version["buildId"] and version["generatedAt"]


def test_content_hash_changes_when_archive_changes(tmp_path):
    archive = tmp_path / "archive"
    _save(archive, source="tzura", category="creation", source_id="1", content="a")
    bai.build(archive, tmp_path / "o1")
    _save(archive, source="manual", category="creation", entry_id="manual-new", content="b")
    bai.build(archive, tmp_path / "o2")
    h1 = json.loads((tmp_path / "o1" / "version.json").read_text())["contentHash"]
    h2 = json.loads((tmp_path / "o2" / "version.json").read_text())["contentHash"]
    assert h1 != h2


def test_build_rejects_invalid_archive(tmp_path, capsys):
    archive = tmp_path / "archive"
    good = _save(archive, source="tzura", category="creation", source_id="1", content="a")
    # Same id stored under the wrong category directory.
    au.write_json_atomic(archive / "palindromes" / "tzura-1.json", good)
    (archive / "creations" / "broken.json").write_text("{not json", encoding="utf-8")
    assert bai.build(archive, tmp_path / "out", check_only=True) == 1
    err = capsys.readouterr().err
    assert "does not match directory" in err
    assert "duplicate id" in err
    assert "invalid JSON" in err
    assert not (tmp_path / "out").exists()


def test_empty_archive_builds_empty_indexes(tmp_path):
    assert bai.build(tmp_path / "archive", tmp_path / "out") == 0
    assert json.loads((tmp_path / "out" / "creations.json").read_text()) == []
