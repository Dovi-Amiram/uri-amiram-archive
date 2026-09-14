"""Facebook JSON extraction tests on trimmed copies of real story payloads (no network)."""

import facebook_scraper as fb

AUTHOR = {"__typename": "User", "name": "Uri Amiram", "id": fb.USER_ID}


def story(**extra):
    base = {
        "__typename": "Story",
        "post_id": "4214827098735861",
        "actors": [AUTHOR],
        "comet_sections": {
            "actor_photo": {  # the author's avatar must never be taken as a post photo
                "story": {"actors": [{**AUTHOR, "profile_picture": {"uri": "https://scontent.x/avatar.jpg", "width": 40}}]}
            },
            "content": {"story": {"message": {"text": "עֵרָן זְהָבִי, אַל תִּתְלַהֵם! לָמָּה לָתֵת לָאֵיבָה זַן רַע?"}}},
            "context_layout": {"story": {"comet_sections": {"metadata": [{"story": {"creation_time": 1700000000}}]}}},
            "feedback": {
                "story": {
                    "story_ufi_container": {
                        "story": {
                            "feedback_context": {
                                "feedback_target_with_context": {
                                    "comet_ufi_summary_and_actions_renderer": {
                                        "feedback": {
                                            "adaptive_ufi_action_renderers": [{"feedback": {"reaction_count": {"count": 2}}}],
                                            "top_reactions": {"edges": [{"reaction_count": 2}]},
                                        }
                                    }
                                },
                                "interesting_top_level_comments": [
                                    {"comment": {"feedback": {"reaction_count": {"count": 99}}}}
                                ],
                            }
                        }
                    }
                }
            },
        },
        "attachments": [
            {
                "styles": {
                    "attachment": {
                        "media": {
                            "__typename": "Photo",
                            "id": "10164414479439625",
                            "accessibility_caption": "No photo description available.",
                            "image": {"uri": "https://scontent.x/small.jpg", "width": 300, "height": 225},
                            "photo_image": {"uri": "https://scontent.x/big.jpg", "width": 600, "height": 450},
                        }
                    }
                }
            }
        ],
    }
    base.update(extra)
    return base


def test_extracts_text_time_author_likes_and_largest_photo():
    [post] = fb.collect_stories_from_json({"data": {"node": story()}})
    assert post.post_id == "4214827098735861"
    assert post.text.startswith("עֵרָן זְהָבִי")
    assert post.created_at == "2023-11-14T22:13:20Z"
    assert post.author_id == fb.USER_ID
    assert post.likes == 2  # the post's own count, not the comment's 99
    assert [(p.photo_id, p.uri, p.width, p.height, p.alt) for p in post.photos] == [
        ("10164414479439625", "https://scontent.x/big.jpg", 600, 450, None)
    ]


def test_photos_of_a_shared_original_are_not_the_posts_photos():
    shared = story(attachments=[])
    shared["attached_story"] = {"attachments": story()["attachments"]}
    [post] = fb.collect_stories_from_json(shared)
    assert post.photos == []


def test_likes_fall_back_to_summing_top_reactions():
    s = story()
    renderer = s["comet_sections"]["feedback"]["story"]["story_ufi_container"]["story"]["feedback_context"][
        "feedback_target_with_context"
    ]["comet_ufi_summary_and_actions_renderer"]
    renderer["feedback"] = {"top_reactions": {"edges": [{"reaction_count": 20}, {"reaction_count": 2}]}}
    [post] = fb.collect_stories_from_json(s)
    assert post.likes == 22


def test_merge_keeps_json_likes_and_unions_photos():
    a = fb.FbPost("1", text="x", origin={"dom"})
    b = fb.FbPost("1", likes=5, photos=[fb.FbPhoto("p1", "https://u")], origin={"json"})
    c = fb.FbPost("1", photos=[fb.FbPhoto("p1", "https://u"), fb.FbPhoto("p2", "https://v")], origin={"json"})
    a.merge(b)
    a.merge(c)
    assert a.likes == 5
    assert [p.photo_id for p in a.photos] == ["p1", "p2"]


def test_entry_contains_likes_and_attachments():
    post = fb.FbPost("42", text="ילד כותב בתוך דלי", created_at="2024-01-01T00:00:00Z", author_id=fb.USER_ID, likes=7)
    attachments = [{"type": "image", "path": "attachments/facebook/42-p1.jpg", "width": 10, "height": 10, "alt": None}]
    entry = fb.to_entry(post, "2026-09-14T00:00:00Z", attachments)
    assert entry["likes"] == 7
    assert entry["attachments"] == attachments
    assert entry["sourceUrl"] == f"https://www.facebook.com/groups/{fb.GROUP_ID}/posts/42/"


def test_new_only_stops_after_known_posts_without_new_ones():
    saved = {str(i) for i in range(100)}
    seen_known = [str(i) for i in range(30)]
    assert not fb.should_stop_new_only(seen_known[:10] + ["new1"], saved, rounds_without_new=5, stop_after_known=30)
    assert not fb.should_stop_new_only(seen_known, saved, rounds_without_new=1, stop_after_known=30)
    assert fb.should_stop_new_only(seen_known + ["new1"], saved, rounds_without_new=3, stop_after_known=30)
    assert not fb.should_stop_new_only(seen_known, saved, rounds_without_new=99, stop_after_known=0)  # full history


def test_saved_post_ids(tmp_path):
    (tmp_path / "palindromes").mkdir()
    for name in ("facebook-1.json", "facebook-22.json", "manual-abc.json"):
        (tmp_path / "palindromes" / name).write_text("{}")
    assert fb.saved_post_ids(tmp_path) == {"1", "22"}


def test_parse_env_file_and_credentials(tmp_path):
    parsed = fb.parse_env_file('# comment\n\nFACEBOOK_EMAIL="me@example.com"\nexport FACEBOOK_PASSWORD=p=ss #1\nOTHER=x\n')
    assert parsed["FACEBOOK_EMAIL"] == "me@example.com"
    assert parsed["FACEBOOK_PASSWORD"] == "p=ss #1"

    path = tmp_path / ".facebook.env"
    assert fb.load_credentials(path, environ={}) is None
    path.write_text("FACEBOOK_EMAIL=file@example.com\nFACEBOOK_PASSWORD=from-file\n", encoding="utf-8")
    path.chmod(0o600)
    assert fb.load_credentials(path, environ={}) == ("file@example.com", "from-file")
    # Real environment variables win over the file.
    assert fb.load_credentials(path, environ={"FACEBOOK_PASSWORD": "from-env"}) == ("file@example.com", "from-env")
    path.write_text("FACEBOOK_EMAIL=\nFACEBOOK_PASSWORD=x\n", encoding="utf-8")
    assert fb.load_credentials(path, environ={}) is None


def test_verification_urls_are_recognized():
    assert fb._VERIFICATION_URL.search("https://www.facebook.com/checkpoint/1501092823525282/")
    assert fb._VERIFICATION_URL.search("https://www.facebook.com/two_step_verification/two_factor/")
    assert not fb._VERIFICATION_URL.search("https://www.facebook.com/groups/1435021850049747/user/659364624")


def test_is_new_post_requires_new_id_and_newer_date():
    saved, excluded = {"1"}, {"2"}
    newest = "2026-09-13T20:36:47Z"
    post = lambda pid, t: fb.FbPost(pid, text="x", created_at=t)
    assert fb.is_new_post(post("1", "2026-09-20T00:00:00Z"), saved, excluded, newest) == (False, "alreadyArchived")
    assert fb.is_new_post(post("2", "2026-09-20T00:00:00Z"), saved, excluded, newest) == (False, "excluded")
    assert fb.is_new_post(post("3", "2026-09-01T00:00:00Z"), saved, excluded, newest) == (False, "notNewer")
    assert fb.is_new_post(post("3", newest), saved, excluded, newest) == (False, "notNewer")
    assert fb.is_new_post(post("3", None), saved, excluded, newest) == (False, "undated")
    assert fb.is_new_post(post("3", "2026-09-14T08:00:00Z"), saved, excluded, newest) == (True, "")
    # --full-history: no date rule
    assert fb.is_new_post(post("3", "2016-01-01T00:00:00Z"), saved, excluded, None) == (True, "")


def test_newest_archived_post_time(tmp_path):
    folder = tmp_path / "palindromes"
    folder.mkdir()
    (folder / "facebook-1.json").write_text('{"postedAt": "2026-09-13T20:36:47Z"}', encoding="utf-8")
    (folder / "facebook-2.json").write_text('{"postedAt": "2026-08-01T00:00:00Z"}', encoding="utf-8")
    (folder / "manual-x.json").write_text('{"postedAt": "2030-01-01"}', encoding="utf-8")  # manual entries don't count
    assert fb.newest_archived_post_time(tmp_path) == "2026-09-13T20:36:47Z"
