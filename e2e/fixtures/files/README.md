# Document fixtures for the file-preview E2E tests

Real files, not stubs: every one was written by an ordinary Office/PDF library,
so it has the internal structure a customer's own document would have. They are
**committed** — CI never regenerates them. `../generate_fixtures.py` is kept
alongside purely for provenance and deliberate regeneration:

```bash
python3 e2e/fixtures/generate_fixtures.py            # regenerate + verify
python3 e2e/fixtures/generate_fixtures.py --verify   # verify only, writes nothing
```

All content is **invented**. ООО «Ромашка», ИП Иванов И. И., «ул. Придуманная»,
УНП 100000001, `@example.com` (an RFC 2606 reserved domain) — none of it comes
from a real client, contract or production system. This repository is public;
keep it that way. The prose is Russian business language on purpose: Cyrillic
encoding and font handling are part of what these tests exercise.

## The files

| File | What it is | Behaviour it exercises | Size |
|---|---|---|---|
| `contract-short.docx` | 2-page services agreement: title, 4 numbered sections, a small price table, signature block | The ordinary small-DOCX path — high-fidelity CDN renderer, headings/tables/Cyrillic render correctly | 24 KB |
| `contract-long.docx` | ~77-page agreement: 11 sections (~66 clauses), 12 appendices, a 220-row смета, letterhead logo and a scanned stamp | Long-document reading: scrolling, many headings, 14 tables, inline images inside a text flow | 116 KB |
| `contract-heavy.docx` | Contract with 5 full-page scan images appended | **Above the 350 KB CDN cutoff** (`MAX_DOCX_CDN_BINARY_BYTES` in `packages/api/src/files/documents/html.ts`) — the backend must fall back to the mammoth renderer | 430 KB |
| `registry.xlsx` | 3 sheets: contract registry (title in A1, blank row 2, two-level merged header, 40 data rows with holes, totals row), «Сводка» with formulas, near-empty «Черновик» | Multi-sheet tab strip, merged cells, empty cells not shifting columns, real numbers vs text, formulas with and without cached values | 9 KB |
| `big-rows.xlsx` | One sheet, 6 000 data rows (6 001 with the header) | **Past the 5 000-row cap** (`SPREADSHEET_MAX_ROWS_PER_SHEET`) — truncation plus the "showing first 5,000 of 6,001 rows" banner | 241 KB |
| `deck-16x9.pptx` | 12 slides, 16:9 (12192000 × 6858000 EMU), bullets, one table slide, one bar-chart-like slide | Widescreen slide rendering, slide list, tables and shapes on slides | 39 KB |
| `deck-4x3.pptx` | 6 slides, 4:3 (9144000 × 6858000 EMU) | The other aspect ratio — slide canvas must not letterbox or crop | 33 KB |
| `deck-many.pptx` | 60 slides, 16:9, every title distinct («Слайд 07. …») | Slide count and navigation: a test can jump to slide N and assert which one it landed on | 88 KB |
| `notes.md` | Markdown with headings, ordered list, task list, table, Python code fence, blockquote and a link | Markdown preview: every block element in one file | 2 KB |
| `script.py` | Readable 77-line utility with module/function docstrings and comments | Source-code preview and syntax highlighting | 3 KB |
| `data.csv` | Header + 30 rows; quoted fields containing commas and `"` quotes, one empty column, Cyrillic values | CSV parsing: quoting rules, empty fields, encoding | 5 KB |
| `digital.pdf` | 5 pages, real text layer, headings «Раздел 1» … «Раздел 5» | Text-layer PDF: search and text selection. Each heading is distinct, so a test can search for one and assert the page | 100 KB |
| `scan.pdf` | 3 pages, **image only** — rasterised, slightly rotated, speckled like a flatbed scan | The "scanned document" path: zero extractable text, so any text-layer feature must degrade gracefully (and OCR-style handling can be tested) | 148 KB |
| `broken.docx` | A real docx truncated to 55% — `PK\x03\x04` magic intact, central directory gone | Corrupt-file handling: sniffing says docx, every parser fails. Must surface an error, not a blank preview | 12 KB |
| `locked.pdf` | AES-256 encrypted PDF, user password `secret123` | Password-protected PDF: must prompt or report "encrypted", never render | 94 KB |
| `locked.docx` | Genuinely encrypted Office file (OLE2/CFB container, ECMA-376 agile encryption), password `secret123` | Password-protected DOCX. It is *not* a zip at all, so the docx parser fails differently from `broken.docx` | 43 KB |
| `archive.zip` | Valid zip with two text files | Unsupported-for-preview format: expect a download prompt, not an attempted render | 0.5 KB |
| `unknown.xyz` | 1 KB opaque binary blob, no recognised magic bytes | Unknown extension and unknown content — the fallback of the fallback | 1 KB |

Total: **1.37 MB** (1 431 026 bytes) — 18 fixtures plus this README.

Test passwords are `secret123` for both `locked.pdf` and `locked.docx`. They are
fixture passwords for throwaway documents, nothing else.

## Things worth knowing before you rely on these

**`registry.xlsx` sheet 2 has formulas of both kinds — on purpose.** openpyxl
writes `<f>C4-B4</f><v></v>`, an *empty* cached value, because it never
evaluates formulas. SheetJS (the library behind the spreadsheet preview) drops
such a cell entirely, so it renders as an empty `<td>`. Excel, by contrast,
always stores the last computed result. Both shapes arrive from real users, so
column D and the totals row carry cached results (they render as numbers, with
`.f` preserved), while column E «Признак» stays uncached and renders empty. The
verifier re-checks that the cached numbers still equal what the formulas say.

**`contract-short.docx` is 24 KB, not the ~37 KB python-docx would give you.**
The stock python-docx template ships two optional parts that are pure ballast:
`word/stylesWithEffects.xml` (a Word 2007 back-compat mirror of styles.xml) and
`docProps/thumbnail.jpeg` (a preview of an unrelated blank page). The generator
drops both along with their relationships and content-type entries. `--verify`
asserts full OPC integrity afterwards — every relationship target and every
content-type override still resolves.

**`scan.pdf` really has no text layer.** reportlab emits an empty `BT /F1 12 Tf
ET` block and an unused Helvetica resource on every page even when nothing is
drawn; the generator strips both, so the pages carry no font resources at all,
the way a scanner emits them. Verified two independent ways: the built-in
pikepdf checker walks the content streams and finds no text-showing operators,
and `pdftotext` extracts 0 characters.

**Regenerating produces byte-identical files** — except `locked.pdf` and
`locked.docx`, which embed fresh cryptographic salts on every run. Do not
re-commit those two unless their content actually changed. Metadata dates are
pinned to 2024-01-15, zip entry timestamps are normalised, reportlab runs with
`invariant=1`, and every "random" byte comes from a fixed-seed SHA-256
keystream.

**Fonts.** The PDFs embed a subset of the first Cyrillic-capable TTF found on
the machine (DejaVu Sans if present, otherwise the macOS system fonts, whose
`fsType` is 8 — "editable embedding", so subsetting into a PDF is permitted by
the vendor's own embedding bits). These fixtures were generated on macOS with
Times New Roman. Regenerating on Linux with DejaVu yields valid but
byte-different PDFs.

**`locked.docx` needs an optional tool.** It is produced with
`msoffcrypto-tool` (≥ 5.0, which can encrypt and not only decrypt). Without it
the generator skips that one fixture and says so loudly — it never writes a
fake "encrypted" file in its place.

**Page counts are estimates.** DOCX does not store pagination; the ~77 pages
quoted for `contract-long.docx` is characters ÷ 2 800. The exact figure depends
on the renderer.
