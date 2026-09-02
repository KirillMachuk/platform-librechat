# Presentation builder specification

The builder accepts one UTF-8 JSON object. All paths are absolute sandbox paths.

## Required job contract

```json
{
  "job": {
    "format": "pptx",
    "audience": "Company leadership",
    "goal": "Approve the 2027 growth plan",
    "sourceFileIds": ["uploaded-model.xlsx"],
    "immutableElements": ["Reported actuals"],
    "locale": "ru-RU",
    "filename": "plan-rosta-2027.pptx",
    "acceptanceCriteria": [
      "All factual slides show a source",
      "Charts remain editable",
      "Cyrillic renders correctly"
    ]
  },
  "slides": [],
  "sources": [],
  "changeLog": [],
  "repairIterations": 0,
  "outputPdf": false
}
```

Use `inputPath` plus `edits` for a targeted revision, or `templatePath` plus `templateLayout` on every new slide for template authoring. Never make the output path equal to either input path.
`outputPdf` defaults to `false`. Set the literal boolean `true` only when the user explicitly asks to receive a PDF in addition to the editable presentation. The builder always creates an internal `.preview.pdf` for render QA.

## Russian-first example

```json
{
  "job": {
    "format": "pptx",
    "audience": "Совет директоров",
    "goal": "Утвердить план роста на 2027 год",
    "sourceFileIds": ["financial-model.xlsx"],
    "immutableElements": ["Фактическая выручка за 2025 год"],
    "locale": "ru-RU",
    "filename": "plan-rosta-2027.pptx",
    "acceptanceCriteria": [
      "Все фактологические слайды имеют источник",
      "Графики остаются редактируемыми",
      "Русский текст отображается корректно"
    ]
  },
  "slides": [
    {
      "layout": "title",
      "eyebrow": "СТРАТЕГИЧЕСКАЯ СЕССИЯ",
      "title": "План роста на 2027 год",
      "subtitle": "Решения по корпоративному сегменту"
    },
    {
      "layout": "claim",
      "title": "Главный вывод",
      "claim": "Корпоративный сегмент обеспечит большую часть роста",
      "support": "Подтверждённая воронка уже покрывает базовый сценарий.",
      "source": "Источник: финансовая модель, лист «План»"
    },
    {
      "layout": "chart",
      "title": "Выручка ускоряется после запуска корпоративного канала",
      "chart": {
        "type": "column",
        "categories": ["2025", "2026", "2027"],
        "series": [{ "name": "Выручка, млн ₽", "values": [82, 114, 161] }],
        "numberFormat": "0"
      },
      "takeaway": "+41% к 2026 году",
      "detail": "Основной вклад даёт переход от пилотов к годовому контракту.",
      "source": "Источник: финансовая модель, лист «План»"
    },
    {
      "layout": "metrics",
      "title": "Экономика подтверждает масштабирование",
      "metrics": [
        { "value": "41%", "label": "рост выручки", "detail": "2027 к 2026" },
        {
          "value": "4,2%",
          "label": "отток",
          "detail": "за последние 12 месяцев"
        },
        {
          "value": "7 мес.",
          "label": "окупаемость",
          "detail": "базовый сценарий"
        }
      ],
      "source": "Источник: управленческий отчёт, июль 2026"
    },
    {
      "layout": "summary",
      "title": "Что нужно утвердить сегодня",
      "bullets": ["Бюджет первой волны", "Контрольные точки", "Ежемесячный обзор воронки"]
    }
  ],
  "sources": [
    {
      "label": "Финансовая модель",
      "url": "financial-model.xlsx — лист «План»"
    }
  ],
  "changeLog": [
    {
      "target": "Presentation",
      "summary": "Created a new decision deck from the supplied model"
    }
  ],
  "repairIterations": 0,
  "outputPdf": false
}
```

## Other layout fields

- `section`: `number`, `title`, `subtitle`.
- `bullets`: `title`, `bullets` (maximum five concise items), optional `source`.
- `two_column` / `comparison`: `title`, `left` and `right`, each containing `heading` and `bullets`.
- `image`: `title`, `image`, optional `caption`, optional `source`.
- `table`: `title`, `columns`, `rows`, required `source` for factual data.
- `process`: `title`, `steps` containing `title` and `detail`, optional `source` when the sequence is sourced.
- `sources`: `title`, `entries` containing `label` and `url`. Put the full address in `url` — the builder prints the site on the slide and parks the address in the speaker notes, so do not shorten it yourself. A web `url` must point at the page carrying the fact; a site's front page fails QA.

## Targeted edit

```json
{
  "job": {
    "format": "pptx",
    "audience": "Совет директоров",
    "goal": "Уточнить прогноз на третьем слайде",
    "sourceFileIds": ["existing-deck.pptx"],
    "immutableElements": ["Все слайды кроме третьего"],
    "locale": "ru-RU",
    "filename": "plan-rosta-2027-v2.pptx",
    "acceptanceCriteria": ["Изменён только третий слайд"]
  },
  "inputPath": "/mnt/data/existing-deck.pptx",
  "edits": [
    {
      "slide": 3,
      "replacements": { "+41% к 2026 году": "+44% к 2026 году" },
      "summary": "Updated the approved forecast"
    }
  ],
  "outputPdf": false
}
```

## Artifact report

The builder writes `<output>.artifact-report.json` next to the presentation. Consumers must tolerate unknown optional fields so the report can grow without breaking older clients.

```json
{
  "status": "ready",
  "format": "pptx",
  "sourceFileIds": ["financial-model.xlsx"],
  "previewAssets": [
    {
      "filename": "plan-rosta-2027.preview.pdf",
      "kind": "pdf",
      "delivery": "preview_only"
    }
  ],
  "qaChecks": [
    {
      "name": "render",
      "status": "passed",
      "message": "Every slide rendered through LibreOffice"
    }
  ],
  "issues": [],
  "changeLog": [{ "target": "Presentation", "summary": "Created a new decision deck" }],
  "skillVersion": "3.2.0",
  "repairIterations": 0
}
```

- `status` is `ready` or `needs_review`.
- `qaChecks[].status` is `passed`, `warning`, or `failed`; `details` is optional.
- `issues[]` contains `code`, `severity` (`warning` or `critical`), `message`, and an optional `target`.
- `previewAssets[]` exposes the verified render used by the product preview. `delivery` is `preview_only` by default and `requested` only for a user-requested PDF. The server adds the authenticated `filepath`; the skill must never supply it.
- `repairIterations` is capped at two. A remaining critical issue always produces `needs_review`.
