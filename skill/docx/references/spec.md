# Document builder specification

The builder accepts one UTF-8 JSON object. All paths are absolute sandbox paths.

## Required job contract

```json
{
  "job": {
    "format": "docx",
    "audience": "Company leadership",
    "goal": "Approve the project launch",
    "sourceFileIds": ["research-notes.pdf"],
    "immutableElements": ["Reported actuals"],
    "locale": "ru-RU",
    "filename": "project-launch-decision.docx",
    "acceptanceCriteria": [
      "The document opens and remains editable",
      "Sources and assumptions are traceable",
      "Every page renders cleanly"
    ]
  },
  "documentType": "memo",
  "title": "Project launch decision",
  "subtitle": "Executive decision memo",
  "metadata": [
    { "label": "To", "value": "Company leadership" },
    { "label": "From", "value": "Program office" },
    { "label": "Date", "value": "31 August 2026" },
    { "label": "Status", "value": "Decision required" }
  ],
  "sections": [],
  "sources": [],
  "assumptions": [],
  "changeLog": [],
  "repairIterations": 0,
  "outputPdf": false
}
```

`documentType` is `memo`, `report`, or `sop`. New documents use `sections`. Template filling uses `templatePath` plus `placeholders`. Targeted revision uses `inputPath` plus `edits`. The output path must differ from every input path.

`outputPdf` defaults to `false`. Set it to `true` only when the user explicitly requests a PDF deliverable; the builder always performs its temporary PDF render for QA.

## Content blocks

Each section has a `heading`, optional `level` (`1` to `3`), and `blocks`:

```json
{
  "heading": "Recommendation",
  "level": 1,
  "blocks": [
    {
      "type": "callout",
      "label": "Decision",
      "text": "Launch a two-team pilot with a decision checkpoint after six weeks."
    },
    {
      "type": "paragraph",
      "text": "The pilot limits risk and validates the economics before scaling."
    },
    {
      "type": "bullets",
      "items": ["Assign an owner", "Define the metrics", "Review the results"]
    },
    {
      "type": "numbered",
      "items": ["Prepare the data", "Run the pilot", "Decide whether to scale"]
    },
    {
      "type": "table",
      "columns": ["Criterion", "Target", "Owner"],
      "rows": [
        ["Response time", "under 2 hours", "Operations director"],
        ["Satisfaction", "at least 85%", "Service lead"]
      ],
      "widths": [0.4, 0.25, 0.35],
      "source": "Source: pilot plan, 28 August 2026 version"
    },
    { "type": "page_break" }
  ]
}
```

- `paragraph` supports optional `boldLead`, a short label rendered before the body.
- `bullets` and `numbered` accept strings or `{ "text": "...", "level": 1 }` objects. Use at most three levels.
- `table.widths` are relative shares and must have one positive number per column.
- `callout` is a semantic highlighted paragraph, not a table used for layout.
- `page_break` should be rare and deliberate.

## Sources and assumptions

```json
{
  "assumptions": [
    "The pilot team remains unchanged for six weeks"
  ],
  "sources": [
    {
      "label": "Pilot plan",
      "location": "research-notes.pdf, pages 7–10"
    },
    {
      "label": "Service evaluation methodology",
      "url": "https://example.org/research/service-methodology",
      "accessed": "2026-08-31"
    }
  ]
}
```

When either array is non-empty, the builder creates explicit `Допущения` and `Источники` sections. Do not put a site's front page in `url`.
Source URLs must be absolute `http` or `https` links with a host. Credentials, whitespace, control characters, backslashes, and non-web schemes are rejected; use `label` or `location` for non-web references.

## Template filling

```json
{
  "job": {
    "format": "docx",
    "audience": "Client team",
    "goal": "Fill the approved report template",
    "sourceFileIds": ["template.docx", "results.xlsx"],
    "templateFileId": "template.docx",
    "immutableElements": ["Template styles, headers, footers, and structure"],
    "locale": "ru-RU",
    "filename": "completed-report.docx",
    "acceptanceCriteria": ["Every placeholder is filled", "Template styles are preserved"]
  },
  "templatePath": "/mnt/data/template.docx",
  "placeholders": {
    "{{REPORT_TITLE}}": "Pilot outcome report",
    "{{REPORT_DATE}}": "31 August 2026",
    "{{SUMMARY}}": "The pilot achieved its target metrics."
  },
  "changeLog": [
    { "target": "Template placeholders", "summary": "Filled the approved report template" }
  ],
  "outputPdf": false
}
```

Placeholder replacement works across split Word runs and preserves the surrounding paragraph, table, header, and footer structure. Every requested placeholder must exist, and no `{{...}}` marker may remain.

## Targeted edit

```json
{
  "job": {
    "format": "docx",
    "audience": "Company leadership",
    "goal": "Update the pilot duration",
    "sourceFileIds": ["existing-report.docx"],
    "immutableElements": ["The entire document except the approved duration"],
    "locale": "ru-RU",
    "filename": "existing-report-v2.docx",
    "acceptanceCriteria": ["Only the approved duration changes"]
  },
  "inputPath": "/mnt/data/existing-report.docx",
  "edits": [
    {
      "oldText": "four weeks",
      "newText": "six weeks",
      "summary": "Updated the approved pilot duration"
    }
  ],
  "outputPdf": false
}
```

By default each `oldText` must occur exactly once. Set `all` to `true` only when every exact occurrence is intentionally in scope.

## Artifact report

The builder writes `<output>.artifact-report.json`. When `outputPdf` is explicitly enabled, the derived PDF receives its own report sidecar. Consumers must preserve unknown optional fields.

```json
{
  "status": "ready",
  "format": "docx",
  "sourceFileIds": ["research-notes.pdf"],
  "previewAssets": [],
  "qaChecks": [
    { "name": "render", "status": "passed", "message": "Every page rendered through LibreOffice" }
  ],
  "issues": [],
  "changeLog": [{ "target": "Document", "summary": "Created a decision memo" }],
  "skillVersion": "1.0.0",
  "repairIterations": 0
}
```

`status` is `ready` or `needs_review`. A failed QA check or critical issue always means `needs_review`. `repairIterations` is capped at two.
