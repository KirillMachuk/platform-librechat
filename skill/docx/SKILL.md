---
name: docx
description: Create or revise editable Microsoft Word documents with a Russian-first professional workflow, semantic styles, template preservation, traceable sources, and render-based QA. Use whenever the user requests a Word document, memo, report, SOP, procedure, or a .docx file.
---

# Professional Word authoring

Create the requested `.docx`; do not substitute Markdown, HTML, or PDF. The editable Word file is the primary artifact. Set `outputPdf` to `true` only when the user explicitly asks for a PDF deliverable; the builder performs its temporary PDF render for QA regardless.

## Available runtime

- `python3`, `python-docx`, LibreOffice, Poppler, Pillow, and Cyrillic fonts are installed.
- The deterministic builder is at `/mnt/data/docx/scripts/build_document.py`.
- Read `/mnt/data/docx/references/spec.md` once with `read_file` before authoring. Treat the builder as an executable; inspect its source only when a traceback points to a specific failure.
- The sandbox has no network access. Do not install packages or depend on remote assets.

## Product standard

- Default to `ru-RU`, A4, Arial, Russian typography, and dates or currencies appropriate to the supplied context.
- Treat every supplied file as immutable. Always write a new, clearly named version.
- Pick the document job before drafting: `memo`, `report`, or `sop`. Use the lightest structure that helps the reader decide, understand, or act.
- Use real Word heading styles, numbering definitions, tables, headers, footers, page fields, and hyperlinks. Do not fake headings, bullets, numbering, or tables with plain text.
- Use tables only for genuinely comparable rows and columns. Use paragraphs, lists, or callouts for normal prose.
- Keep facts, assumptions, and sources distinguishable. Do not invent facts, citations, dates, people, or numeric precision.
- A web source must be a specific page opened in this conversation. If only a publication is known, give its name and date without fabricating a URL.
- Put only absolute `http` or `https` links in `sources[].url`; use the source label or location for files, network shares, and other non-web references.
- Preserve a supplied template's sections, page geometry, styles, headers, footers, and relationships. Fill placeholders instead of rebuilding the template.
- For a targeted revision, change only the requested text and save a new version. The actual attached `.docx` binary must be present in `/mnt/data`; never reconstruct it from extracted chat text.

## Workflow

1. Inspect the supplied files and determine audience, purpose, evidence, constraints, locale, document type, and filename.
2. Draft a concise outline. For a memo, lead with the decision. For a report, lead with the executive summary. For an SOP, lead with purpose, scope, roles, and ordered steps.
3. Read `references/spec.md`, then write one UTF-8 JSON specification containing the complete `ArtifactJob` and acceptance criteria.
4. Use `templatePath` plus `placeholders` to fill a template, or `inputPath` plus `edits` for a targeted revision. Never make the output path equal to an input path.
5. Write the specification to `/tmp/<stem>-spec.json` and run the builder in the same `execute_code` call:

   ```bash
   python3 /mnt/data/docx/scripts/build_document.py /tmp/<stem>-spec.json /mnt/data/<clear-name>.docx
   ```

6. Read `/mnt/data/<clear-name>.docx.artifact-report.json`. The builder reopens the document, audits semantic structure and table geometry, verifies immutable inputs, renders through LibreOffice, and raster-checks every page.
7. Review the render and raster checks for every page. When the user explicitly requested a PDF and visual inspection is available, inspect that derived PDF for clipping, awkward page breaks, dense text, table wrapping, hierarchy, Cyrillic glyphs, headers, and footers.
8. If a defect remains, revise the JSON and rerun. Allow at most two repair iterations and record the actual count.
9. Deliver the DOCX only when the report status is `ready` and visual review is clean. If a critical issue remains, use `needs_review` and state it plainly.

Final artifacts must be direct children of `/mnt/data`: `/mnt/data/<name>.docx` and, when requested, `/mnt/data/<name>.pdf`. Do not expose the JSON spec, report sidecars, page PNGs, or scratch directories unless the user explicitly requests QA evidence.

## Completion response

Give the `.docx` link first. Briefly mention the audience and purpose, source or assumption caveats, QA status, and an explicitly requested PDF. Never claim verification when the artifact report says `needs_review`.
