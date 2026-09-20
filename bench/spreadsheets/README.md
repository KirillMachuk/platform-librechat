# Spreadsheet quality rollout

This is the remaining spreadsheet track of the editable-office-artifact program.
It starts from the already merged `ArtifactJob` and `artifactReport` contracts,
the Russian-first PPTX/DOCX builders, and the existing isolated Code Interpreter.
The current production route does not yet select an XLSX authoring skill.

The first draft PR covers only the new-workbook core. Its local gate is:

```bash
python3 -m unittest bench.spreadsheets.test_builder -v
python3 bench/spreadsheets/run_core_goldens.py --runs 3 --output-dir /path/to/new/evidence-directory
```

The core eval checks five Russian-first scenarios (calculation with chart,
single sheet, source trace, typed dates, and a discount scenario), exact
formulas and values after independent LibreOffice recalculation, native
workbook features, expected PDF page count, and repeated render pixels. It is
**not** the full ten-case acceptance gate below. Inspect its retained PDFs
visually; pixel consistency proves repeatability, not design quality.
The first builder deliberately accepts at most eight total columns; wider
print pagination has not yet been visually validated.
Long, narrow tables are covered separately by a real-office test that checks
column headers repeat on later PDF pages.

## Scope and order

1. **Builder and acceptance gate, behind no product route.** Add a small
   `openpyxl` builder for new formula-driven XLSX files. A job declares the
   audience, goal, locale, sources, output name, and acceptance criteria. The
   builder owns the workbook structure and formulas, reopens its output,
   recalculates a copy with LibreOffice, renders the used sheets, and emits the
   existing `artifactReport` contract. Source files remain unchanged.
2. **Ten Russian-first golden cases, three runs each.** Cover a basic
   calculation, aggregation, formulas, multiple sources, unmatched keys,
   assumptions, a dashboard/chart, a template, a targeted edit, and a refresh.
   Gate exact values and formulas, native workbook features, source
   immutability, formula errors, and rendered evidence. Record a separate
   human visual score from fresh renders; a green structural report is not a
   visual-quality claim.
3. **Product route and preview.** Select the XLSX skill for explicit workbook
   requests in Auto, retain plain model-chat context when switching to Auto,
   and expose the validated report in the existing artifact panel. Preview
   should use the isolated office render and show each relevant sheet without
   changing the original workbook. Keep this step separate from the builder
   PR because the panel is shared with other ongoing UI work.
4. **Live pilot and rollout.** After code review, security review, and UI
   review, run representative requests on the stand. Inspect the downloaded
   workbook in Excel/LibreOffice, mutate inputs to prove formulas and charts
   update, compare the preview, and monitor failures before widening rollout.

## Core workbook rule

Keep a focused workbook focused. Inputs, assumptions, calculations, output,
sources, review, and change history are logical roles, not mandatory tabs.
Add a separate tab only when it serves a distinct reader, source, calculation,
or update workflow. A merge with unmatched keys must expose those keys in a
`Review` sheet; a one-table calculation should not acquire six empty sheets.

Use editable Excel formulas for derived results, native Tables/filters and
charts where useful, typed dates/numbers, restrained Russian-first formatting,
and explicit missing-data behavior. Never hide an unexpected formula error as
zero. The builder must not execute spreadsheet macros, external links, or
network functions from supplied files or model-authored formulas.

## Exit criteria

- Every golden output reopens and its critical formulas and values match the
  case oracle in all three runs.
- No unexplained `#REF!`, `#VALUE!`, `#DIV/0!`, or related formula error remains.
- Source files are byte-identical after creation or revision.
- Every relevant sheet renders; no critical clipping, blank chart, or font
  substitution is accepted as `ready`.
- At least 90% of golden outputs score 7/10 or higher visually and the mean
  is at least 8/10. These scores are tied to the exact rendered evidence.
- The live pilot confirms formula updates, downloadable XLSX integrity, and
  preview parity. No deploy is implied by passing local or CI checks.

The headless workbook skill in `anthropics/skills` is source-available but
proprietary. It is a reference for quality criteria, not code to vendor or
copy. The platform builder uses the already requested `openpyxl`/LibreOffice
stack and the existing 1ma artifact contract.
