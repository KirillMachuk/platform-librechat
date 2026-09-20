# New workbook builder specification

The builder reads one UTF-8 JSON object and writes one editable `.xlsx`.
Paths passed to the command are absolute sandbox paths. The output filename
must equal `job.filename`; the builder never edits an input workbook.

```json
{
  "job": {
    "format": "xlsx",
    "audience": "Operations lead",
    "goal": "Review monthly service cost",
    "sourceFileIds": [],
    "immutableElements": [],
    "locale": "ru-RU",
    "filename": "service-cost.xlsx",
    "acceptanceCriteria": [
      "Amounts remain editable",
      "Totals recalculate when inputs change"
    ]
  },
  "title": "Service cost",
  "table": {
    "sheetName": "Data",
    "name": "ServiceCosts",
    "columns": [
      { "key": "service", "header": "Service", "type": "text" },
      { "key": "units", "header": "Units", "type": "integer", "minimum": 0 },
      { "key": "unit_cost", "header": "Unit cost", "type": "number", "minimum": 0 }
    ],
    "rows": [
      { "service": "Support", "units": 12, "unit_cost": 125 },
      { "service": "Training", "units": 4, "unit_cost": 300 }
    ],
    "calculatedColumns": [
      {
        "key": "cost",
        "header": "Cost",
        "operation": "multiply",
        "inputs": ["units", "unit_cost"],
        "numberFormat": "#,##0.00",
        "highlightNegative": false
      }
    ]
  },
  "summary": [
    { "label": "Total cost", "operation": "sum", "column": "cost" }
  ],
  "chart": {
    "kind": "bar",
    "title": "Cost by service",
    "category": "service",
    "value": "cost"
  },
  "sources": [],
  "changeLog": [],
  "repairIterations": 0
}
```

The supported base column types are `text`, `integer`, `number`, `percent`,
and `date` (ISO `YYYY-MM-DD`). Numbers and dates are typed Excel values, not
formatted strings. Text beginning with `=` remains literal text. Each row
must provide every base column. This first builder supports at most eight
columns in total so the rendered A4 page remains readable; wider worksheets
need a later pagination workflow. It also rejects a combined print width above
125 Excel width units: eight long headers can still make fitted text too small.
Shorten labels without losing their units or use a later supported view.
Use a `choices` array for a text dropdown,
or `minimum`/`maximum` for a numeric validation. Only include validations
that reflect an actual input rule.

`calculatedColumns` follow the base columns. Each calculation takes exactly
two existing numeric keys and uses `add`, `subtract`, `multiply`, or `divide`.
Calculations are written as native formulas. A zero divisor or missing numeric
input is rejected instead of being converted into a plausible zero.
Optional calculated-column `numberFormat` accepts `#,##0`, `#,##0.00`,
`0.0%`, or `0.00%`; use the column header for currency units. Arbitrary
Excel format strings are intentionally unsupported.

`summary` is optional. It creates a separate first sheet only when there are
useful headline results. Each item references a numeric base or calculated
column and uses `sum`, `average`, `min`, `max`, or `count`. The result is a
native formula linked to the data sheet. `chart` is optional and currently
supports a `bar` or `line` chart on the summary sheet, backed by the data
table. It requires a text category and numeric value column.

`sources` is optional and contains `{ "label": "...", "location": "..." }`
or a checked absolute web `url`. Put real source context into the workbook;
do not invent citations. The report always carries `sourceFileIds` and
`changeLog`. A source list does not require a separate worksheet for a single
source. The builder creates an internal PDF render for QA; it is not a
requested deliverable.

This first contract intentionally has no `inputPath`, `templatePath`, raw
formula strings, macros, external workbook links, or merge instructions.
Those modes need their own security and regression checks before routing.
For a repair attempt, increment `repairIterations` and choose a new output
filename in both the spec and command. Existing output and QA files are never
overwritten.
