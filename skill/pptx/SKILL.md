---
name: pptx
description: Build .pptx presentations with python-pptx in the code sandbox. Use for any request for slides, a deck or a presentation file. python-pptx is installed and works; never route the deck through LibreOffice, Markdown or PDF.
---

# Building .pptx files

## What the sandbox already has

- **`python-pptx` is installed and importable as `pptx`.** Do not test for it, do not
  try to install it, do not look for an alternative.
- The interpreter is **`python3`**. There is no bare `python`.
- **No network access.** `pip install` cannot work and is not needed.
- LibreOffice (`soffice`) is installed, and Cyrillic-capable fonts are installed.

## Rules

1. **Write the `.pptx` with python-pptx.** Never author Markdown, HTML or a PDF and
   convert it into slides. That path produces a file full of unrendered source text.
2. **Never tell the user a `.pptx` cannot be produced here.** It can.
3. Save the deck to `/mnt/data/<name>.pptx`, and **write the build scripts to `/tmp`**.
   Everything left in `/mnt/data` is delivered to the user, so a script written there
   arrives attached to your answer next to the deck. `/tmp` is scratch for the current
   call only — which is why steps 1 and 2 below must go in **one** `bash` call.
4. **Never compute slide coordinates yourself.** Hand-placed text boxes are what pushes
   content off the slide. Use the builder below; it fixes every position from the real
   slide size.
5. **Always run `deck.check(path)` after saving** and fix whatever it reports before
   you answer the user.

## Step 1 — write the builder

Write this file verbatim. Do not edit the geometry.

```bash
cat > /tmp/deck.py <<'PYEOF'
"""16:9 deck builder. Geometry is fixed here so callers pass content only.

The default python-pptx template is 4:3 and its layout placeholders keep 4:3
coordinates after the slide is widened, which is what puts content off-position
on a 16:9 canvas. Every helper re-places the placeholders from the real slide
size, so that failure mode cannot happen.
"""

import math

from pptx import Presentation
from pptx.util import Inches, Pt

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)
MARGIN = Inches(0.9)
CONTENT_W = SLIDE_W - 2 * MARGIN
TITLE_TOP = Inches(0.5)
TITLE_H = Inches(1.1)
BODY_TOP = Inches(1.8)
BODY_H = Inches(4.9)  # bottom edge 6.7", clear of the 7.5" slide edge
FONT = "Arial"  # installed wherever the deck gets opened; renders Cyrillic

# Measured for the content box above: characters per line, and lines per box.
_CHARS_PER_LINE = {24: 60, 20: 72, 18: 80, 16: 90, 14: 103}
_LINES_PER_BODY = {24: 10, 20: 12, 18: 13, 16: 15, 14: 17}


def new_deck():
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    return prs


def _place(shape, left, top, width, height):
    shape.left, shape.top, shape.width, shape.height = left, top, width, height


def _write(tf, size, bold=False):
    for para in tf.paragraphs:
        for run in para.runs:
            run.font.size = Pt(size)
            run.font.name = FONT
            run.font.bold = bold


def _title(slide, text, size=30):
    shape = slide.shapes.title
    _place(shape, MARGIN, TITLE_TOP, CONTENT_W, TITLE_H)
    shape.text_frame.text = text
    shape.text_frame.word_wrap = True
    _write(shape.text_frame, size, bold=True)
    return shape


def _lines(text, size):
    return max(1, math.ceil(len(text) / _CHARS_PER_LINE[size]))


def _fit(bullets, size):
    """Split bullets into per-slide chunks that fit the content box."""
    budget = _LINES_PER_BODY[size]
    chunks, current, used = [], [], 0
    for item in bullets:
        text, level = item if isinstance(item, tuple) else (item, 0)
        cost = _lines(text, size)
        if current and used + cost > budget:
            chunks.append(current)
            current, used = [], 0
        current.append((text, level))
        used += cost
    chunks.append(current)
    return chunks


def title_slide(prs, title, subtitle=""):
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    shape = slide.shapes.title
    _place(shape, MARGIN, Inches(2.4), CONTENT_W, Inches(1.7))
    shape.text_frame.text = title
    shape.text_frame.word_wrap = True
    _write(shape.text_frame, 40, bold=True)
    sub = slide.placeholders[1]
    if subtitle:
        _place(sub, MARGIN, Inches(4.3), CONTENT_W, Inches(1.2))
        sub.text_frame.text = subtitle
        sub.text_frame.word_wrap = True
        _write(sub.text_frame, 20)
    else:
        sub._element.getparent().remove(sub._element)
    return slide


def bullets_slide(prs, title, bullets, size=20):
    """One or more slides. Bullets that do not fit continue on "title (2)", "(3)"...

    Each bullet is a string, or a (string, level) tuple for a sub-bullet.
    """
    slides = []
    for n, chunk in enumerate(_fit(bullets, size)):
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        _title(slide, title if n == 0 else "{} ({})".format(title, n + 1))
        body = slide.placeholders[1]
        _place(body, MARGIN, BODY_TOP, CONTENT_W, BODY_H)
        frame = body.text_frame
        frame.word_wrap = True
        frame.clear()
        for i, (text, level) in enumerate(chunk):
            para = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
            para.text = text
            para.level = level
            for run in para.runs:
                run.font.size = Pt(size - 2 * level)
                run.font.name = FONT
        slides.append(slide)
    return slides


def image_slide(prs, title, image_path, caption=""):
    """Image fitted inside the content box, keeping its aspect ratio."""
    from PIL import Image

    slide = prs.slides.add_slide(prs.slide_layouts[5])
    _title(slide, title)
    box_h = BODY_H - (Inches(0.5) if caption else 0)
    with Image.open(image_path) as img:
        ratio = img.width / img.height
    width = min(CONTENT_W, int(box_h * ratio))
    height = int(width / ratio)
    left = MARGIN + (CONTENT_W - width) // 2
    slide.shapes.add_picture(image_path, left, BODY_TOP, width, height)
    if caption:
        box = slide.shapes.add_textbox(MARGIN, BODY_TOP + box_h, CONTENT_W, Inches(0.4))
        box.text_frame.text = caption
        box.text_frame.word_wrap = True
        _write(box.text_frame, 14)
    return slide


def table_slide(prs, title, header, rows, size=14):
    """Table fitted to the content box. Long tables continue on "title (2)"..."""
    per_slide = max(1, _LINES_PER_BODY[size] - 2)
    slides = []
    for n in range(0, max(1, len(rows)), per_slide):
        page = rows[n : n + per_slide]
        slide = prs.slides.add_slide(prs.slide_layouts[5])
        _title(slide, title if n == 0 else "{} ({})".format(title, n // per_slide + 1))
        height = min(BODY_H, Inches(0.42) * (len(page) + 1))
        table = slide.shapes.add_table(
            len(page) + 1, len(header), MARGIN, BODY_TOP, CONTENT_W, height
        ).table
        for col, text in enumerate(header):
            cell = table.cell(0, col)
            cell.text = str(text)
            _write(cell.text_frame, size, bold=True)
        for r, row in enumerate(page, start=1):
            for col, text in enumerate(row):
                cell = table.cell(r, col)
                cell.text = str(text)
                _write(cell.text_frame, size)
        slides.append(slide)
    return slides


def check(path):
    """Reopen the saved deck and fail loudly on anything off-slide or overfull."""
    prs = Presentation(path)
    problems = []
    for n, slide in enumerate(prs.slides, start=1):
        for shape in slide.shapes:
            if shape.left is None or shape.top is None:
                continue
            right, bottom = shape.left + shape.width, shape.top + shape.height
            if (
                shape.left < 0
                or shape.top < 0
                or right > prs.slide_width
                or bottom > prs.slide_height
            ):
                problems.append(
                    "slide {}: '{}' is outside the slide "
                    '(left={:.2f}" top={:.2f}" right={:.2f}" bottom={:.2f}")'.format(
                        n,
                        shape.name,
                        shape.left / 914400,
                        shape.top / 914400,
                        right / 914400,
                        bottom / 914400,
                    )
                )
            if not shape.has_text_frame:
                continue
            used = 0
            for para in shape.text_frame.paragraphs:
                pts = next((r.font.size.pt for r in para.runs if r.font.size), 18)
                per_line = _CHARS_PER_LINE.get(int(pts), 80)
                text = "".join(r.text for r in para.runs)
                used += max(1, math.ceil(len(text) / per_line)) * pts * 1.25
            if used > shape.height / 914400 * 72 + 1:
                problems.append(
                    "slide {}: text in '{}' needs ~{:.0f}pt of height "
                    "but the box is {:.0f}pt".format(
                        n, shape.name, used, shape.height / 914400 * 72
                    )
                )
    if problems:
        raise SystemExit("LAYOUT PROBLEMS:\n" + "\n".join(problems))
    print(
        "layout OK: {} slides, all shapes inside {:.2f}x{:.2f} inches".format(
            len(prs.slides._sldIdLst),
            prs.slide_width / 914400,
            prs.slide_height / 914400,
        )
    )
PYEOF
```

## Step 2 — build the deck

In the **same** `bash` call, write a second script that imports the builder and supplies
only content. Keep every bullet to one idea; the builder starts a continuation slide
when a slide fills up.

```bash
cat > /tmp/build.py <<'PYEOF'
import sys

sys.path.insert(0, "/tmp")
import deck

prs = deck.new_deck()
deck.title_slide(prs, "Quarterly sales report", "Prepared for the board")
deck.bullets_slide(prs, "Key results", [
    "Revenue up 23% year over year",
    ("Retail: +18%", 1),
    ("Corporate: +41%", 1),
    "Churn down to 4.2%, the best figure on record",
])
deck.table_slide(prs, "By segment",
    ["Segment", "Revenue", "Margin"],
    [["Retail", "4 120", "38%"], ["Corporate", "6 890", "34%"]])
# deck.image_slide(prs, "Revenue trend", "/mnt/data/chart.png", "Source: internal")

prs.save("/mnt/data/report.pptx")
deck.check("/mnt/data/report.pptx")
PYEOF
python3 /tmp/build.py
```

`check` prints `layout OK: N slides, ...`. If it prints `LAYOUT PROBLEMS`, shorten the
offending text or move it to another slide and rerun — do not hand the file over until
it passes. Because `/tmp` is wiped between calls, a rerun repeats both steps in one call.

## Charts

Build them with matplotlib, save a PNG to `/mnt/data`, then place it with
`deck.image_slide`. Set `plt.rcParams["font.family"] = "Liberation Sans"` first so
non-Latin labels render instead of coming out as boxes.

## If the user supplied their own template

Open it with `Presentation("/mnt/data/template.pptx")` and use its own layouts and
placeholders unchanged — do not resize its slides and do not re-place its placeholders.
The builder above is for decks created from scratch.
