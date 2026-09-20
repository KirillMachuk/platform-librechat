---
name: xlsx
description: Create a new editable Excel workbook from supplied data with native formulas, tables, optional charts, and render-based QA. Do not use for an existing-workbook edit or multi-source merge until those builder modes are available.
allowed-tools:
  - execute_code
---

# Spreadsheet authoring

Create a real `.xlsx` when the user requests a workbook. Keep the original
request, source values, units, dates, and missing-data distinctions intact.
Default to `ru-RU` and a portable Cyrillic font when no locale or template is
specified. Do not replace a requested workbook with Markdown or CSV.

The current deterministic builder supports **new workbooks from explicit
tabular values**, not editing an uploaded workbook or joining several files.
Do not pretend those unsupported jobs succeeded. Preserve all supplied files.

Read `/mnt/data/xlsx/references/spec.md` before authoring. The builder is
`/mnt/data/xlsx/scripts/build_spreadsheet.py`; call it with a UTF-8 JSON spec
and an output `.xlsx` path directly under `/mnt/data`. The frontmatter tool
name is a capability marker, not a callable tool: use `bash_tool` for the
builder command.

Design the smallest useful workbook. A simple calculation can stay on one
sheet. Add a summary sheet only for a distinct output or useful chart; add
source or review sheets only when the data or workflow requires them. Derived
results must be editable Excel formulas, not Python-computed constants. The
builder accepts structured calculations rather than arbitrary formula text.
Never write formula-looking source text as a formula.

The spec belongs at `/mnt/data/_qa_<stem>-spec.json`; reusable work must not
go in `/tmp`, which does not persist between tool calls. Run:

```bash
python3 /mnt/data/xlsx/scripts/build_spreadsheet.py /mnt/data/_qa_<stem>-spec.json /mnt/data/<stem>.xlsx
```

Read the generated `<stem>.xlsx.artifact-report.json`. Deliver only when its
status is `ready`, every critical check passed, and no critical issue remains.
The builder reopens the workbook, checks native features and formulas,
recalculates a disposable copy in LibreOffice, compares control values, and
renders the workbook. `ready` confirms these automated checks, not visual
quality. Inspect every PDF page for clipping, unreadable labels, and excessive
empty space, and verify the user's acceptance criteria before delivery. Repair
at most twice using new versioned filenames; previous outputs are immutable.
If a critical issue remains, report it plainly
instead of claiming completion.

Only the final XLSX is user-facing. Keep `_qa_` specs, previews, reports, and
render images out of the chat unless the user explicitly asks for QA evidence.
Answer with one short completion sentence in the user's language and mention
only a material caveat that requires their action.
