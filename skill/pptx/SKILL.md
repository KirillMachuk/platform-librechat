---
name: pptx
description: Create or revise editable PowerPoint presentations with a Russian-first professional workflow, native charts, visible sources, template preservation, and render-based QA. Use whenever the user requests slides, a deck, a presentation, PowerPoint, or a .pptx file.
allowed-tools:
  - execute_code
---

# Professional PowerPoint authoring

Create the requested presentation as two matching deliverables: an editable `.pptx` and a `.pdf` rendered from that final PPTX. Do not substitute Markdown or HTML. Only omit the PDF when the user explicitly asks for PPTX alone.

Keep the chat clean while authoring: call the required tools without prose progress messages between them. Do not emit any text block between tool calls, including a rationale, status line, or whitespace-only block. Do not write variants of “data collected”, “building the deck”, or “starting QA”; the user should see the final completion sentence, the two deliverables, and only a material caveat that requires action.

## Available runtime

- `python3`, `python-pptx`, LibreOffice, Poppler, Pillow, and Cyrillic fonts are installed.
- The deterministic builder is at `/mnt/data/pptx/scripts/build_presentation.py`.
- The builder's input contract and layout examples are in `/mnt/data/pptx/references/spec.md`.
- Read `references/spec.md` once with `read_file`. Treat the builder as an executable: do not read its source unless a real builder traceback requires inspecting the specific failing area.
- The sandbox has no network access. Do not install packages or depend on remote assets.

## Default product standard

- Default to `ru-RU`, Arial, 16:9, Russian typography, and `₽` when the user does not specify another locale.
- Treat every supplied file as immutable. Write a new, clearly named version.
- Decide the audience, decision, narrative, and one-sentence takeaway for each slide before styling.
- Prefer one strong idea per slide. Keep titles as conclusions, not topic labels.
- Use editable PowerPoint text, shapes, tables, and native charts. Use a bitmap only for a supplied photo or a visualization PowerPoint cannot represent.
- Put a short visible source note on every factual claim, chart, table, and metric slide. Add a final sources slide when sources exist.
- Do not invent facts, sources, dates, or numeric precision. Record necessary assumptions explicitly. Compare the requested period with the conversation date supplied by the runtime: if the period has ended, use observed historical data and retrospective wording unless the user explicitly asks for an old forecast. Never infer today's date from search-result dates. If the runtime date is absent, call `date -u +%F` once with `bash_tool`; do not search the web for today's date.
- A source URL must be a page whose body the platform scraper returned in this conversation, pointing at the page that carries the fact. Never cite a site's front page (`https://www.statista.com/`), and never reconstruct an address from memory — a plausible-looking URL that 404s is worse than no URL. When you have the publication but not a checked link, give publisher and date and leave the URL out.
- `web_search` already asks the platform's scraper to retrieve the top result pages. Do not issue another search merely to “open” a result. Use extracted page content as evidence; an item that fell back to a search-result snippet remains a discovery aid and must not support a factual claim or URL in the spec.
- For an ordinary deck, make at most three `web_search` calls before authoring, preferably together in one tool round. If the evidence is still incomplete or conflicting after the third call, stop searching and build a narrower, honest deck from the facts that are supported. Put the limitation in the relevant source note or final user caveat; never consume the remaining tool budget on query variants.
- Compare numbers with a native `chart`, not with prose or a table. A table is for values the reader must read exactly; a deck whose only numeric slide is a table reads as a report, not a presentation.
- Preserve a user's slide size, masters, layouts, theme, and placeholders. If the selected template layout lacks the required inherited placeholders, stop and request a compatible layout instead of drawing a new design over it.
- For a targeted revision, change only the requested slide or text and save a new version.
- Never reconstruct an attached presentation from extracted chat text. A revision requires the actual binary at `/mnt/data/<attached-name>.pptx`; if it is absent, say that the source file is unavailable instead of producing a look-alike deck.

## Workflow

1. Inspect all supplied files and summarize the communication job internally: audience, decision, evidence, constraints, locale, and filename.
2. Draft a short story outline. Typical business flow: context → implication → evidence → decision → next steps. Do not create filler slides.
3. Read `references/spec.md`, then write one JSON spec. Always include the complete `ArtifactJob` and acceptance criteria. Do not read the builder source during normal authoring.
4. For a revision, inspect the mounted binary with `python-pptx`, confirm the actual slide number and exact source text, and use that file as `inputPath`.
5. Write the spec to `/mnt/data/_qa_<stem>-spec.json`, then immediately run the builder against it with `bash_tool`. Do not return to web search, read extra sources, or plan again after `create_file` succeeds: the next tool call must be the builder. The `_qa_` prefix is reserved for internal working files and prevents them from becoming user attachments. Keep the spec there across repair calls; never put reusable work in `/tmp`, because `/tmp` is empty on the next call:

   ```bash
   python3 /mnt/data/pptx/scripts/build_presentation.py /mnt/data/_qa_<stem>-spec.json /mnt/data/<clear-name>.pptx
   ```

   Never place final artifacts inside `/mnt/data/pptx`, `/mnt/data/out`, or another subdirectory.

6. Read `/mnt/data/<clear-name>.pptx.artifact-report.json` exactly once after each builder run. The builder reopens the file, checks structure and editability, renders every slide through LibreOffice, raster-checks the result, verifies immutable inputs, and confirms that a targeted revision changed no unrequested package parts.
7. The current runtime has no private visual-inspection tool: `read_file` cannot inspect image or PDF pixels and exposing generated PNGs makes them user-visible attachments. Do not run `pdftoppm` or LibreOffice again, create slide PNGs or montages, call `read_file` on an image/PDF, list `/mnt/data`, or re-read the spec/report to simulate visual review. Use the builder's `render` and `visual-raster` checks as the rendered-output gate. A future genuinely private visual tool may supplement that gate, but its evidence must never enter the user chat.
8. If the report is `ready`, every QA check passed, and `issues` has no critical item, stop using tools immediately. The next assistant content must be the final completion sentence. Do not reconstruct the task from tool outputs or inspect the sandbox again.
9. If a builder or QA defect remains, revise the same JSON and immediately rerun the exact builder command that failed. The successful `edit_file` response is a continuation of the original user request, not a new request: do not re-read the skill, reconstruct the task from the diff, restart planning, ask the user to repeat the task, or emit prose between the edit and the retry. A report with `status: "needs_review"`, any failed QA check, or any critical issue is not a deliverable and must never be described to the user as complete. Allow at most two repair iterations and set `repairIterations` to the actual count.
10. Deliver the `.pptx` and its same-stem `.pdf` only when the report status is `ready` and the rendered-output gate is clean. If a critical issue remains after the allowed repairs, stop and state the exact user-visible issue plainly instead of emitting a success summary.

Final user files must be direct children of `/mnt/data`, use one requested base name, and differ only by extension: `/mnt/data/<name>.pptx` and `/mnt/data/<name>.pdf`. The PDF must come from the final PPTX, never from a separate drawing pipeline. `outputPdf` defaults to `true`; set it to `false` only when the user explicitly requests PPTX alone. Do not deliver or mention `_qa_` files, the JSON spec, artifact-report JSON, rendered slide PNGs, montages, or scratch directories unless the user explicitly asks for QA evidence; the platform consumes artifact reports as metadata.

## Core layouts

Use only the layout needed for the message: `title`, `claim`, `section`, `bullets`, `two_column`, `comparison`, `image`, `chart`, `table`, `metrics`, `process`, `summary`, or `sources`.

- `chart` must remain a native PowerPoint chart.
- Keep a `chart` takeaway to at most 80 characters and its `detail` / `takeawayDetail` to at most 50 characters. Put methodology and longer context in the visible source line or sources slide instead of forcing it into the narrow callout column.
- `metrics` supports one to three decision-relevant metrics.
- `process` supports two to five steps.
- `table` supports at most five columns and seven data rows; move detailed data to an appendix or workbook.
- Do not shrink body text below 16 pt to make content fit. Split or shorten the slide.

## Completion response

When the report is `ready`, answer with exactly one short sentence such as: `Готово — приложил презентацию в PPTX и PDF.` Attachments already carry the files, so do not repeat links, `/mnt/data` paths, the slide outline, QA status, repair history, internal filenames, tool traces, or implementation details. Do not paste slide images or internal QA/spec files into the chat. Source methodology and non-actionable limitations belong on the sources slide, not in the completion response. Mention a caveat only when the user must provide something or make a choice before the file is usable. Never write a `QA:` line. If the report is `needs_review`, do not claim completion; state only the exact remaining user-visible problem and do not present the artifact as ready.
