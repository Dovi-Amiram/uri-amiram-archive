"""Parser tests using trimmed copies of Tzura's real markup (no network)."""

import pytest

import tzura_scraper as tz

ARTIST_HTML = """
<div class="span3 sidebar page-left-sidebar">
  <h5 class="title-bg">היצירות</h5>
  <ul class="post-category-list">
    <li> <a href="/t/art/49513">עייפתי</a></li>
    <li> <a href="/t/art/7313">הרי את-מקודשת-לי</a></li>
    <li> <a href="/t/art/7313">הרי את-מקודשת-לי</a></li>
  </ul>
</div>
<div class="span6">
  <form action="/T/Art/7894" class="prev" method="post"><h4>על הפרנסה</h4></form>
  <form action="/T/Art/7313" class="prev" method="post"><h4>הרי את-מקודשת-לי</h4></form>
</div>
"""

WORK_HTML = """
<div class="span8 blog"><article>
  <h3 class="title-bg">
      הרי את-מקודשת-לי
  </h3>
  <div class="post-content"><div class="post-body">
    <span style="direction: rtl; white-space: pre-line">\r\n
                     \r\nהרי את-מקודשת-לי תמירים ו<B>נישאים</B>\r\nאל רכס הטבעת הנִכסף<br>והכסוף\r\n\r\nבית שני<div style="display:none">spam <a href="http://x">x</a></div>\r\n                </span>
  </div>
  <div class="post-summary-footer"><ul class="post-data">
    <li><i class="icon-calendar"></i>26/8/2003 </li>
    <li><i class="icon-user"></i><a href="/T/Artist/1006">אורי עמירם</a> </li>
  </ul></div></div>
</article>
<section class="comments">
  <span class="comment-name"><a href="/T/Artist/997">מגיב</a></span>
  <span class="comment-date">1/1/2020</span>
  <div class="comment-content">תגובה שאסור לארכב</div>
</section></div>
<div class="span4 sidebar">
  <h5 class="title-bg">לקט יצירות</h5>
  <ul class="post-category-list"><li><a href="/t/art/48267">בלי חשש כותניות</a></li><li><a href="/t/art/15029">x</a></li></ul>
</div>
"""


def test_parse_artist_page_lists_sidebar_works_without_duplicates():
    works = tz.parse_artist_page(ARTIST_HTML)
    assert [(w.work_id, w.title) for w in works] == [
        ("49513", "עייפתי"),
        ("7313", "הרי את-מקודשת-לי"),
        ("7894", "על הפרנסה"),
    ]


def test_parse_artist_page_requires_sidebar():
    with pytest.raises(tz.ParseError):
        tz.parse_artist_page("<html><body>nothing</body></html>")


def test_parse_work_page_extracts_work_and_ignores_comments():
    work = tz.parse_work_page(WORK_HTML, "7313")
    assert work.title == "הרי את-מקודשת-לי"
    assert work.content == "הרי את-מקודשת-לי תמירים ונישאים\nאל רכס הטבעת הנִכסף\nוהכסוף\n\nבית שני"
    assert work.posted_at == "2003-08-26"  # from the article footer, not the comment date
    assert work.author == "אורי עמירם" and work.author_id == "1006"
    assert work.related_ids == ["48267", "15029"]
    assert "תגובה" not in work.content and "תגובה" not in work.article_html
    assert work.source_url == "https://tzura.co.il/T/Art/7313"


PARAGRAPH_WORK_HTML = """
<div class="span8 blog"><article><h3 class="title-bg">עייפתי</h3>
<div class="post-body"><span style="white-space: pre-line">\r\n
      <p style="text-align: right;">&nbsp;ואם אשוב אל סף הבית</p>\r\n<p style="text-align: right;">כבר לא אהיה אותו האיש</p>\r\n<p style="text-align: right;"></p>\r\n<p style="text-align: right;">ונקישתי כה מהססת</p>\r\n<p></p>\r\n<p></p>\r\n  </span></div>
<div class="post-summary-footer"><ul><li><i class="icon-calendar"></i> </li><li><i class="icon-user"></i><a href="/T/Artist/1006">אורי עמירם</a></li></ul></div>
</article></div>
"""


def test_paragraph_per_line_markup_keeps_single_line_breaks():
    work = tz.parse_work_page(PARAGRAPH_WORK_HTML, "49513")
    assert work.content == "ואם אשוב אל סף הבית\nכבר לא אהיה אותו האיש\n\nונקישתי כה מהססת"
    assert work.posted_at is None  # empty calendar item: no invented date


def test_work_without_date_gets_null():
    html = WORK_HTML.replace("26/8/2003", "")
    assert tz.parse_work_page(html, "7313").posted_at is None


def test_malformed_work_page_raises():
    with pytest.raises(tz.ParseError):
        tz.parse_work_page("<html><body><p>oops</p></body></html>", "1")
    with pytest.raises(tz.ParseError):
        tz.parse_work_page("<article><h3>t</h3><div class='post-body'><span>  </span></div></article>", "1")


def test_to_entry_is_canonical():
    entry = tz.to_entry(tz.parse_work_page(WORK_HTML, "7313"), "2026-09-14T00:00:00Z")
    assert entry["id"] == "tzura-7313"
    assert entry["source"] == "tzura" and entry["category"] == "creation"
    assert entry["sourceId"] == "7313" and entry["scrapedAt"] == "2026-09-14T00:00:00Z"
