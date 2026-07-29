---
name: pptx
description: Build .pptx presentations with python-pptx in the code sandbox. Use for any request for slides, a deck or a presentation file. python-pptx is installed and works; never route the deck through LibreOffice, Markdown or PDF.
---

# Building .pptx files

## What the sandbox already has

- **`python-pptx` is installed and importable as `pptx`.** Do not test for it, do not
  try to install it, do not look for an alternative.
- **A ready-made 16:9 deck builder at `/opt/1ma/python/deck.py`.** It does all the
  layout. You supply content only.
- The interpreter is **`python3`**. There is no bare `python`.
- **No network access.** `pip install` cannot work and is not needed.
- LibreOffice (`soffice`) is installed, and Cyrillic-capable fonts are installed.

## Rules

1. **Write the `.pptx` with python-pptx through the builder.** Never author Markdown,
   HTML or a PDF and convert it into slides — that produces a file full of unrendered
   source text.
2. **Never tell the user a `.pptx` cannot be produced here.** It can.
3. **Never compute slide coordinates yourself, and never copy the builder into your
   script.** Hand-placed text boxes are what pushes content off the slide. Import the
   builder; it fixes every position from the real slide size.
4. Save the deck to `/mnt/data/<name>.pptx` and write your script to `/tmp`. Everything
   left in `/mnt/data` is delivered to the user, so a script written there arrives
   attached to your answer next to the deck.
5. **Always call `deck.check(path)` after saving** and fix whatever it reports before
   you answer the user.
6. If `import deck` fails, say plainly that the sandbox image is out of date. Do not
   fall back to hand-written slide geometry.

## The command

One `bash` call. Change the content; keep the first three lines and the last two.

```bash
cat > /tmp/build.py <<'PYEOF'
import sys

sys.path.insert(0, "/opt/1ma/python")
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
it passes.

## The builder

Slides are 16:9. Titles, body text and tables are placed from the real slide size, font
sizes are set for you, and text that does not fit continues on a `title (2)` slide
rather than overflowing. Keep every bullet to one idea and let it split.

- `new_deck()` — empty 16:9 presentation.
- `title_slide(prs, title, subtitle="")` — opening slide.
- `bullets_slide(prs, title, bullets, size=20)` — `bullets` is a list of strings, or
  `(text, level)` tuples for sub-bullets. Returns the slides it created.
- `table_slide(prs, title, header, rows, size=14)` — `header` is a list of column names,
  `rows` a list of row lists. Long tables continue on further slides.
- `image_slide(prs, title, image_path, caption="")` — image fitted to the content box,
  aspect ratio preserved.
- `check(path)` — reopens the saved file and fails on anything off-slide or overfull.

## Charts

Build them with matplotlib, save a PNG to `/mnt/data`, then place it with
`deck.image_slide`. Set `plt.rcParams["font.family"] = "Liberation Sans"` first so
non-Latin labels render instead of coming out as boxes.

## If the user supplied their own template

Open it with `Presentation("/mnt/data/template.pptx")` and use its own layouts and
placeholders unchanged — do not resize its slides and do not re-place its placeholders.
The builder is for decks created from scratch.
