# Document fixtures

Real documents for the file-preview e2e specs, produced by
`../generate_fixtures.py` (python-docx, openpyxl, python-pptx, reportlab,
pikepdf) and verified by `../verify_fixtures.py`.

They are written by the ordinary Office libraries rather than assembled by
hand, so a preview test exercises the same conversion path a client's own
contract takes. All content is invented — fictional companies, invented sums
and dates. **This repository is public: never replace these with a real
document.**

CI does not generate or verify them; both scripts are authoring tools. Rerun
them after changing a fixture:

```bash
python e2e/fixtures/generate_fixtures.py && python e2e/fixtures/verify_fixtures.py
```

| File | What it is | What it exercises | Size |
|---|---|---|---|
| `contract-short.docx` | 2-page services agreement, headings, clauses, requisites table | the ordinary Word reading view | 38 KB |
| `contract-long.docx` | the same agreement at 48 clauses, 147 paragraphs | a document long enough to scroll; no invented page numbers | 39 KB |
| `contract-heavy.docx` | agreement plus an incompressible image appendix | crosses the 350 KB bound where the backend stops using its bundled renderer | 423 KB |
| `registry.xlsx` | 3 sheets: registry with a title in A1, a blank row, merged cells, missing amounts, totals; a formulas sheet; an almost empty sheet | grid rendering, sheet switching, ragged real-world data | 8 KB |
| `big-rows.xlsx` | one sheet, 6000 data rows | the 5000-row truncation | 157 KB |
| `deck-16x9.pptx` | 12 slides, 16:9 | slide rendering at the modern aspect | 39 KB |
| `deck-4x3.pptx` | 6 slides, 4:3 | the older aspect still opens | 33 KB |
| `deck-many.pptx` | 60 slides, 16:9 | a deck long enough to need navigation | 84 KB |
| `notes.md` | headings, list, table, code fence, quote, link | markdown reading view | <1 KB |
| `script.py` | 60-line module with docstrings | source-code view | 2 KB |
| `data.csv` | 30 rows, quoted fields with commas and quotes, an empty field, Cyrillic | CSV treated as a sheet | 3 KB |
| `digital.pdf` | 5 pages with a real text layer | PDF with selectable text | 40 KB |
| `scan.pdf` | 3 image-only pages with speckle and a stamp box | a scan: no extractable text at all | 262 KB |
| `locked.pdf` | `digital.pdf` encrypted, user password `secret123` | password-protected file | 41 KB |
| `broken.docx` | `contract-short.docx` truncated to a third | a damaged file that no parser can open | 13 KB |
| `archive.zip` | valid zip with two text files | a format with no preview at all | <1 KB |

Total ≈ 1.2 MB.

## Not covered

A password-protected **Office** file is missing: producing genuine ECMA-376
encryption needs tooling that is not available here (`msoffcrypto-tool`
decrypts, it does not encrypt). `locked.pdf` covers the password case for now.
Ask the owner for a real password-protected `.docx` if that path ever needs its
own test — it must be a throwaway document, never a client file.
