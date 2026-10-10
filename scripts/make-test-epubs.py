"""Generate mock EPUBs into a test vault.

Usage: py scripts/make-test-epubs.py "F:/Note/Obsidian Note"

Writes to `<vault>/R Reader Test/` (wiped and rebuilt each run):
  Long Mock Novel.epub   40 chapters in nested parts, cover — scrolling, TOC filter, progress, search
  Formatting Sampler.epub  headings, lists, tables, code, quotes, footnotes, images, CJK, long words
  Tiny Story.epub        one chapter, no cover, no nav nesting — library fallbacks
"""
import random
import shutil
import sys
import uuid
import zipfile
from html import escape
from pathlib import Path

vault = Path(sys.argv[1] if len(sys.argv) > 1 else "F:/Note/Obsidian Note")
out = vault / "R Reader Test"
if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)

WORDS = ("the quiet harbor lantern drifted across a silver tide while old sailors "
         "argued about maps compasses storms and the strange light beyond northern "
         "cliffs where nobody had walked for a hundred winters").split()


def paragraph(rng, n=None):
    n = n or rng.randint(40, 110)
    words = [rng.choice(WORDS) for _ in range(n)]
    words[0] = words[0].capitalize()
    return " ".join(words) + "."


def xhtml(title, body):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>{escape(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>
{body}
</body>
</html>"""


def cover_svg(title, author, hue):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<rect width="600" height="900" fill="hsl({hue},45%,30%)"/>
<rect x="40" y="40" width="520" height="820" fill="none" stroke="hsl({hue},60%,75%)" stroke-width="4"/>
<text x="300" y="380" text-anchor="middle" font-family="serif" font-size="52" fill="white">{escape(title)}</text>
<text x="300" y="460" text-anchor="middle" font-family="serif" font-size="30" fill="hsl({hue},60%,85%)">{escape(author)}</text>
</svg>"""


def build(filename, title, author, chapters, toc, cover=None, extra_files=None):
    """chapters: [(id, title, html_body)]; toc: nested [(title, href, children)]."""
    book_id = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, title)}"
    files = {"style.css": "body{font-family:serif;line-height:1.5} img{max-width:100%} "
                          "table{border-collapse:collapse} td,th{border:1px solid #888;padding:4px}"}
    files.update(extra_files or {})
    manifest, spine = [], []

    if cover:
        files["cover.svg"] = cover
        manifest.append('<item id="cover-image" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>')
        files["cover.xhtml"] = xhtml("Cover", '<div style="text-align:center"><img src="cover.svg" alt="Cover"/></div>')
        manifest.append('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>')
        spine.append('<itemref idref="cover" linear="no"/>')

    for cid, ctitle, body in chapters:
        files[f"{cid}.xhtml"] = xhtml(ctitle, body)
        manifest.append(f'<item id="{cid}" href="{cid}.xhtml" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="{cid}"/>')

    for name in (extra_files or {}):
        mt = {"svg": "image/svg+xml", "css": "text/css"}[name.rsplit(".", 1)[1]]
        manifest.append(f'<item id="x-{name.replace(".", "-")}" href="{name}" media-type="{mt}"/>')

    def nav_list(items):
        lis = []
        for t, href, kids in items:
            sub = nav_list(kids) if kids else ""
            lis.append(f'<li><a href="{href}">{escape(t)}</a>{sub}</li>')
        return "<ol>" + "".join(lis) + "</ol>"

    files["nav.xhtml"] = xhtml("Contents", f'<nav epub:type="toc" id="toc"><h1>Contents</h1>{nav_list(toc)}</nav>')
    manifest.append('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
    manifest.append('<item id="css" href="style.css" media-type="text/css"/>')

    counter = [0]

    def ncx_points(items):
        pts = []
        for t, href, kids in items:
            counter[0] += 1
            pts.append(f'<navPoint id="np{counter[0]}" playOrder="{counter[0]}"><navLabel><text>{escape(t)}</text>'
                       f'</navLabel><content src="{href}"/>{ncx_points(kids) if kids else ""}</navPoint>')
        return "".join(pts)

    files["toc.ncx"] = f"""<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="{book_id}"/></head>
<docTitle><text>{escape(title)}</text></docTitle>
<navMap>{ncx_points(toc)}</navMap></ncx>"""
    manifest.append('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>')

    meta_cover = '<meta name="cover" content="cover-image"/>' if cover else ""
    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">{book_id}</dc:identifier>
<dc:title>{escape(title)}</dc:title>
<dc:creator>{escape(author)}</dc:creator>
<dc:language>en</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
{meta_cover}
</metadata>
<manifest>
{chr(10).join(manifest)}
</manifest>
<spine toc="ncx">
{chr(10).join(spine)}
</spine>
</package>"""

    with zipfile.ZipFile(out / filename, "w") as z:
        # mimetype must be the first entry and stored uncompressed.
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>""", compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        for name, data in files.items():
            z.writestr(f"OEBPS/{name}", data, compress_type=zipfile.ZIP_DEFLATED)
    print(f"  {filename}")


# --- Long Mock Novel: 4 parts x 10 chapters, sections inside chapters ----------
rng = random.Random(42)
chapters, toc = [], []
for p in range(1, 5):
    part_kids = []
    for c in range(1, 11):
        n = (p - 1) * 10 + c
        cid = f"ch{n:02d}"
        body = [f'<h2 id="top">Chapter {n}: The {rng.choice(WORDS).title()} {rng.choice(WORDS).title()}</h2>']
        sec_kids = []
        for s in range(1, 4):
            body.append(f'<h3 id="s{s}">Section {n}.{s}</h3>')
            if n == 7 and s == 2:
                body.append("<p>Search target: the word <em>zephyrine</em> appears only here and in chapter 33.</p>")
            if n == 33 and s == 1:
                body.append("<p>Second occurrence of <em>zephyrine</em> for search testing.</p>")
            body += [f"<p>{paragraph(rng)}</p>" for _ in range(rng.randint(4, 8))]
            sec_kids.append((f"Section {n}.{s}", f"{cid}.xhtml#s{s}", []))
        chapters.append((cid, f"Chapter {n}", "\n".join(body)))
        part_kids.append((f"Chapter {n}", f"{cid}.xhtml", sec_kids))
    toc.append((f"Part {['One', 'Two', 'Three', 'Four'][p - 1]}", part_kids[0][1], part_kids))

print("Writing EPUBs:")
build("Long Mock Novel.epub", "Long Mock Novel", "R. Tester", chapters, toc,
      cover=cover_svg("Long Mock Novel", "R. Tester", 210))

# --- Formatting Sampler ---------------------------------------------------------
diagram = """<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
<rect width="400" height="200" fill="#eef"/><circle cx="100" cy="100" r="60" fill="#f80"/>
<rect x="200" y="50" width="150" height="100" fill="#08f"/></svg>"""
fmt_chapters = [
    ("text", "Text & Headings", f"""
<h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3><h4>Heading 4</h4>
<p>Normal paragraph with <strong>bold</strong>, <em>italic</em>, <code>inline code</code>,
<a href="https://example.com">an external link</a> and <a href="lists.xhtml">an internal link to Lists</a>.</p>
<p>Supercalifragilisticexpialidociouspneumonoultramicroscopicsilicovolcanoconiosisantidisestablishmentarianism — a very long unbroken word.</p>
<p>{paragraph(rng, 200)}</p>
<blockquote><p>A blockquote. {paragraph(rng, 30)}</p></blockquote>
<hr/>
<p style="text-align:center">Centered text</p><p style="text-align:right">Right-aligned text</p>"""),
    ("lists", "Lists & Tables", """
<h2>Lists</h2>
<ul><li>Unordered one</li><li>Unordered two<ul><li>Nested</li><li>Nested again</li></ul></li></ul>
<ol><li>First</li><li>Second</li><li>Third</li></ol>
<h2>Table</h2>
<table><thead><tr><th>Name</th><th>Value</th><th>Notes</th></tr></thead>
<tbody><tr><td>Alpha</td><td>1</td><td>short</td></tr>
<tr><td>Beta</td><td>22</td><td>a much longer cell that should wrap inside the table on narrow screens</td></tr>
<tr><td>Gamma</td><td>333</td><td>—</td></tr></tbody></table>
<h2>Code block</h2>
<pre><code>function hello(name) {
  return `Hello, ${name}!`;  // a long line that may need horizontal scrolling on mobile devices
}</code></pre>"""),
    ("media", "Images & Footnotes", f"""
<h2>Images</h2>
<p>An inline SVG diagram (hidden in "No image mode"):</p>
<figure><img src="diagram.svg" alt="Diagram"/><figcaption>Figure 1. A diagram.</figcaption></figure>
<h2>Footnotes</h2>
<p>This sentence has a footnote<a epub:type="noteref" href="#fn1" id="r1"><sup>1</sup></a>
and another one<a epub:type="noteref" href="#fn2" id="r2"><sup>2</sup></a>.</p>
<p>{paragraph(rng)}</p>
<aside epub:type="footnote" id="fn1"><p>1. The first footnote.</p></aside>
<aside epub:type="footnote" id="fn2"><p>2. The second footnote.</p></aside>"""),
    ("intl", "International Text", """
<h2>Unicode</h2>
<p lang="ja">日本語のテキスト。吾輩は猫である。名前はまだ無い。</p>
<p lang="zh">中文文本测试，包括标点符号。</p>
<p lang="vi">Tiếng Việt có dấu: Xin chào thế giới, đọc sách vui vẻ.</p>
<p lang="ar" dir="rtl">هذا نص عربي من اليمين إلى اليسار.</p>
<p>Emoji: 📚 ✨ 🔖</p>"""),
]
build("Formatting Sampler.epub", "Formatting Sampler", "Markup Lab",
      fmt_chapters, [(t, f"{cid}.xhtml", []) for cid, t, _ in fmt_chapters],
      cover=cover_svg("Formatting", "Markup Lab", 30), extra_files={"diagram.svg": diagram})

# --- Tiny Story: no cover --------------------------------------------------------
build("Tiny Story.epub", "Tiny Story (No Cover)", "Anonymous",
      [("only", "The Only Chapter", f"<h2>The Only Chapter</h2><p>{paragraph(rng)}</p><p>{paragraph(rng)}</p>")],
      [("The Only Chapter", "only.xhtml", [])])

print(f"Done -> {out}")
