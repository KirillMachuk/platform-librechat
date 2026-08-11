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
  "outputPdf": true
}
```

Use `inputPath` plus `edits` for a targeted revision, or `templatePath` plus `templateLayout` on every new slide for template authoring. Never make the output path equal to either input path.

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
        "series": [
          {"name": "Выручка, млн ₽", "values": [82, 114, 161]}
        ],
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
        {"value": "41%", "label": "рост выручки", "detail": "2027 к 2026"},
        {"value": "4,2%", "label": "отток", "detail": "за последние 12 месяцев"},
        {"value": "7 мес.", "label": "окупаемость", "detail": "базовый сценарий"}
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
    {"label": "Финансовая модель", "url": "financial-model.xlsx — лист «План»"}
  ],
  "changeLog": [
    {"target": "Presentation", "summary": "Created a new decision deck from the supplied model"}
  ],
  "repairIterations": 0,
  "outputPdf": true
}
```

## Other layout fields

- `section`: `number`, `title`, `subtitle`.
- `bullets`: `title`, `bullets` (maximum five concise items), optional `source`.
- `two_column` / `comparison`: `title`, `left` and `right`, each containing `heading` and `bullets`.
- `image`: `title`, `image`, optional `caption`, optional `source`.
- `table`: `title`, `columns`, `rows`, required `source` for factual data.
- `process`: `title`, `steps` containing `title` and `detail`, optional `source` when the sequence is sourced.
- `sources`: `title`, `entries` containing `label` and `url`.

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
      "replacements": {"+41% к 2026 году": "+44% к 2026 году"},
      "summary": "Updated the approved forecast"
    }
  ],
  "outputPdf": true
}
```
