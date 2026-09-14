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
