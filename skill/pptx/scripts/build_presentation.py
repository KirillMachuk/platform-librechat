#!/usr/bin/env python3
"""Deterministic PowerPoint builder with structural and rendered QA."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import zipfile
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.chart.data import ChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_SHAPE_TYPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR, MSO_AUTO_SIZE
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

SKILL_VERSION = "3.1.0"
MAX_REPAIR_ITERATIONS = 2
WIDE_WIDTH = Inches(13.333)
WIDE_HEIGHT = Inches(7.5)

DEFAULT_THEME = {
    "NAVY": "181F2A",
    "INK": "191E28",
    "MUTED": "5B6576",
    "PAPER": "F8F9FA",
    "WHITE": "FFFFFF",
    "ACCENT": "E25843",
    "ACCENT_DARK": "A73E30",
    "LINE": "DCE0E6",
    "POSITIVE": "25805C",
    "NEGATIVE": "C24148",
}

NAVY = RGBColor.from_string(DEFAULT_THEME["NAVY"])
INK = RGBColor.from_string(DEFAULT_THEME["INK"])
MUTED = RGBColor.from_string(DEFAULT_THEME["MUTED"])
PAPER = RGBColor.from_string(DEFAULT_THEME["PAPER"])
WHITE = RGBColor.from_string(DEFAULT_THEME["WHITE"])
ACCENT = RGBColor.from_string(DEFAULT_THEME["ACCENT"])
ACCENT_DARK = RGBColor.from_string(DEFAULT_THEME["ACCENT_DARK"])
LINE = RGBColor.from_string(DEFAULT_THEME["LINE"])
POSITIVE = RGBColor.from_string(DEFAULT_THEME["POSITIVE"])
NEGATIVE = RGBColor.from_string(DEFAULT_THEME["NEGATIVE"])

DEFAULT_FONT = "Arial"
FONT = DEFAULT_FONT
MONO_FONT = "Courier New"


def _parse_color(value: str, field: str) -> RGBColor:
    normalized = value.strip().removeprefix("#")
    if len(normalized) != 6:
        raise ValueError(f"theme.{field} must be a six-digit hex color")
    try:
        return RGBColor.from_string(normalized.upper())
    except ValueError as exc:
        raise ValueError(f"theme.{field} must be a six-digit hex color") from exc


def _configure_theme(spec: dict[str, Any]) -> None:
    global NAVY, INK, MUTED, PAPER, WHITE, ACCENT, ACCENT_DARK, LINE, POSITIVE, NEGATIVE, FONT

    theme = spec.get("theme") or {}
    color_fields = {
        "dark": "NAVY",
        "ink": "INK",
        "muted": "MUTED",
        "background": "PAPER",
        "surface": "WHITE",
        "accent": "ACCENT",
        "accentDark": "ACCENT_DARK",
        "line": "LINE",
        "positive": "POSITIVE",
        "negative": "NEGATIVE",
    }
    values = globals()
    for target, value in DEFAULT_THEME.items():
        values[target] = RGBColor.from_string(value)
    for field, target in color_fields.items():
        raw = theme.get(field)
        if raw is not None:
            values[target] = _parse_color(str(raw), field)
    font = str(theme.get("font", DEFAULT_FONT)).strip()
    if font not in {"Arial", "Calibri", "PT Sans"}:
        raise ValueError("theme.font must be Arial, Calibri, or PT Sans")
    FONT = font


def _job(spec: dict[str, Any], output: Path) -> dict[str, Any]:
    raw = spec.get("job") or {}
    required = [
        "format",
        "audience",
        "goal",
        "sourceFileIds",
        "immutableElements",
        "locale",
        "filename",
        "acceptanceCriteria",
    ]
    missing = [key for key in required if key not in raw]
    if missing:
        raise ValueError(f"ArtifactJob is missing: {', '.join(missing)}")
    if raw["format"] != "pptx":
        raise ValueError("ArtifactJob.format must be 'pptx'")
    if Path(raw["filename"]).suffix.lower() != ".pptx":
        raise ValueError("ArtifactJob.filename must end in .pptx")
    if output.suffix.lower() != ".pptx":
        raise ValueError("Output path must end in .pptx")
    return raw


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _changed_package_parts(source: Path, output: Path) -> set[str]:
    """Return OPC package parts whose payload changed, appeared, or disappeared."""
    with zipfile.ZipFile(source) as before, zipfile.ZipFile(output) as after:
        # A valid OPC package names every part once. A duplicate central-directory
        # entry would collapse into one set member and `getinfo` would silently pick
        # a single one, so the comparison could report an unchanged part while the
        # other copy was dropped or rewritten. Refuse to answer instead of vouching
        # for scope the comparison cannot actually establish; the caller fails closed.
        for archive, label in ((before, "source"), (after, "output")):
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError(f"duplicate part names in the {label} package")
        before_names = set(before.namelist())
        after_names = set(after.namelist())
        changed = before_names ^ after_names
        for name in before_names & after_names:
            before_info = before.getinfo(name)
            after_info = after.getinfo(name)
            if (
                before_info.file_size != after_info.file_size
                or before_info.CRC != after_info.CRC
                or _zip_part_sha256(before, name) != _zip_part_sha256(after, name)
            ):
                changed.add(name)
    return changed


def _zip_part_sha256(archive: zipfile.ZipFile, name: str) -> str:
    """Hash one package part without loading a potentially large media file into RAM."""
    digest = hashlib.sha256()
    with archive.open(name) as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _blank_layout(prs: Presentation):
    for layout in prs.slide_layouts:
        if layout.name.lower() == "blank":
            return layout
    return prs.slide_layouts[-1]


def _template_layout(prs: Presentation, requested: str | None):
    if requested:
        for layout in prs.slide_layouts:
            if layout.name.lower() == requested.lower():
                return layout
    return _blank_layout(prs)


def _shape_name(shape, value: str) -> None:
    shape.name = value


def _set_fill(shape, color: RGBColor) -> None:
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    style = shape._element.find(qn("p:style"))
    if style is not None:
        shape._element.remove(style)


def _add_rect(slide, x, y, w, h, color: RGBColor, name: str = "Decorative block"):
    shape = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RECTANGLE, x, y, w, h)
    _set_fill(shape, color)
    _shape_name(shape, name)
    return shape


def _add_ellipse(slide, x, y, w, h, color: RGBColor, name: str = "Editorial marker"):
    shape = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.OVAL, x, y, w, h)
    _set_fill(shape, color)
    _shape_name(shape, name)
    return shape


def _add_line(slide, x, y, w, color: RGBColor = LINE, width: float = 1.0, name: str = "Divider"):
    shape = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RECTANGLE, x, y, w, Inches(0.012))
    _set_fill(shape, color)
    _shape_name(shape, name)
    return shape


def _add_text(
    slide,
    text: str,
    x,
    y,
    w,
    h,
    *,
    size: float,
    color: RGBColor = INK,
    bold: bool = False,
    font: str | None = None,
    align=PP_ALIGN.LEFT,
    valign=MSO_ANCHOR.TOP,
    margin: float = 0.0,
    name: str = "Body text",
):
    shape = slide.shapes.add_textbox(x, y, w, h)
    _shape_name(shape, name)
    frame = shape.text_frame
    frame.clear()
    frame.word_wrap = True
    frame.margin_left = Inches(margin)
    frame.margin_right = Inches(margin)
    frame.margin_top = Inches(margin)
    frame.margin_bottom = Inches(margin)
    frame.vertical_anchor = valign
    paragraph = frame.paragraphs[0]
    paragraph.alignment = align
    run = paragraph.add_run()
    run.text = str(text)
    run.font.name = font or FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    return shape


def _estimated_line_count(text: str, max_chars: int) -> int:
    lines = 0
    for raw_line in str(text).splitlines() or [""]:
        words = raw_line.split()
        if not words:
            lines += 1
            continue
        current = 0
        for word in words:
            needed = len(word) if current == 0 else len(word) + 1
            if current and current + needed > max_chars:
                lines += 1
                current = len(word)
            else:
                current += needed
        lines += 1
    return max(lines, 1)


def _add_slide_title(slide, title: str, source: str = "") -> float:
    line_count = _estimated_line_count(title, 44)
    if line_count > 3:
        raise ValueError("Slide title exceeds three readable lines; shorten or split the slide")
    height = max(0.92, line_count * 0.52)
    box = _add_text(
        slide,
        title,
        Inches(0.85),
        Inches(0.48),
        Inches(11.65),
        Inches(height),
        size=35,
        bold=True,
        name="Slide title",
    )
    # Content is placed below the height reserved here, and that height comes from
    # a character count — which cannot be right for both "илти" (44 per line) and
    # "ШЖЮМ" (28) at the same size. Where the two disagree the reservation is a
    # guess, and when it guesses high the title wraps into the table underneath.
    # Ask the renderer to shrink the title into the box it was promised, but only
    # for those titles: where both counts agree the reservation holds whatever the
    # glyph widths, and the title keeps the size it was designed at.
    if _estimated_line_count(title, 28) > line_count:
        box.text_frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
    if source:
        _add_text(
            slide,
            source,
            Inches(0.85),
            Inches(7.03),
            Inches(11.35),
            Inches(0.25),
            size=10,
            color=MUTED,
            name="Source note",
        )
    return 0.48 + height + 0.22


def _add_bullets(frame, bullets: list[Any], size: float = 20, color: RGBColor = INK) -> None:
    frame.clear()
    frame.word_wrap = True
    frame.margin_left = Inches(0.04)
    frame.margin_right = Inches(0.04)
    for index, item in enumerate(bullets):
        if isinstance(item, dict):
            text = str(item.get("text", ""))
            level = int(item.get("level", 0))
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            text, level = str(item[0]), int(item[1])
        else:
            text, level = str(item), 0
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.text = text
        paragraph.level = min(max(level, 0), 2)
        for run in paragraph.runs:
            run.font.name = FONT
            run.font.size = Pt(size - paragraph.level * 2)
            run.font.color.rgb = color
        paragraph.space_after = Pt(11 if paragraph.level == 0 else 6)
        paragraph.line_spacing = 1.08


def _add_bullet_box(slide, bullets: list[Any], x, y, w, h, size: float = 20, name="Bullet list"):
    shape = slide.shapes.add_textbox(x, y, w, h)
    _shape_name(shape, name)
    _add_bullets(shape.text_frame, bullets, size=size)
    return shape


def _add_footer_number(slide, number: int) -> None:
    _add_text(
        slide,
        str(number),
        Inches(12.15),
        Inches(7.05),
        Inches(0.42),
        Inches(0.22),
        size=9,
        color=MUTED,
        align=PP_ALIGN.RIGHT,
        name="Slide number",
    )


def _render_title(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    _add_rect(slide, 0, 0, prs.slide_width, prs.slide_height, NAVY, "Title background")
    _add_ellipse(
        slide,
        Inches(11.75),
        Inches(0.72),
        Inches(0.38),
        Inches(0.38),
        ACCENT,
    )
    _add_text(
        slide,
        item.get("eyebrow", "ПРЕЗЕНТАЦИЯ К РЕШЕНИЮ"),
        Inches(0.9),
        Inches(0.9),
        Inches(10.7),
        Inches(0.4),
        size=16,
        color=ACCENT,
        bold=True,
        name="Eyebrow",
    )
    _add_text(
        slide,
        item.get("title", "Untitled presentation"),
        Inches(0.9),
        Inches(1.62),
        Inches(10.9),
        Inches(2.45),
        size=52,
        color=WHITE,
        bold=True,
        valign=MSO_ANCHOR.MIDDLE,
        name="Deck title",
    )
    _add_text(
        slide,
        item.get("subtitle", ""),
        Inches(0.94),
        Inches(4.42),
        Inches(9.6),
        Inches(0.85),
        size=22,
        color=RGBColor(202, 213, 226),
        name="Deck subtitle",
    )
    if item.get("date"):
        _add_text(
            slide,
            item["date"],
            Inches(0.94),
            Inches(6.5),
            Inches(9.8),
            Inches(0.3),
            size=16,
            color=RGBColor(158, 175, 196),
            name="Deck date",
        )
    return slide


def _render_claim(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    _add_rect(slide, 0, 0, prs.slide_width, prs.slide_height, PAPER, "Slide background")
    content_top = _add_slide_title(
        slide, item.get("title", "Главный вывод"), item.get("source", "")
    )
    claim_top = max(1.52, content_top + 0.02)
    divider_top = min(claim_top + 2.72, 4.78)
    _add_ellipse(
        slide,
        Inches(0.88),
        Inches(claim_top + 0.2),
        Inches(0.2),
        Inches(0.2),
        ACCENT,
    )
    _add_text(
        slide,
        item.get("claim", ""),
        Inches(1.28),
        Inches(claim_top),
        Inches(10.6),
        Inches(divider_top - claim_top - 0.12),
        size=40,
        color=NAVY,
        bold=True,
        valign=MSO_ANCHOR.MIDDLE,
        name="Claim",
    )
    _add_line(slide, Inches(1.28), Inches(divider_top), Inches(9.8))
    _add_text(
        slide,
        item.get("support", ""),
        Inches(1.28),
        Inches(divider_top + 0.34),
        Inches(9.9),
        Inches(6.62 - divider_top - 0.34),
        size=20,
        color=INK,
        name="Claim support",
    )
    return slide


def _render_section(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    _add_rect(slide, 0, 0, prs.slide_width, prs.slide_height, NAVY, "Section background")
    _add_text(slide, str(item.get("number", "")), Inches(0.85), Inches(0.82), Inches(2.1), Inches(1.05), size=54, color=ACCENT, bold=True, name="Section number")
    _add_text(slide, item.get("title", "Раздел"), Inches(0.85), Inches(2.05), Inches(11.1), Inches(1.65), size=46, color=WHITE, bold=True, valign=MSO_ANCHOR.MIDDLE, name="Section title")
    _add_text(slide, item.get("subtitle", ""), Inches(0.9), Inches(4.18), Inches(10.4), Inches(0.95), size=22, color=RGBColor(202, 213, 226), name="Section subtitle")
    return slide


def _render_bullets(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    content_top = _add_slide_title(slide, item.get("title", ""), item.get("source", ""))
    bullets = list(item.get("bullets", []))
    if len(bullets) > 5:
        raise ValueError("Narrative list supports at most five points; split the slide")
    row_height = min(1.05, (6.58 - content_top) / max(len(bullets), 1))
    for index, raw in enumerate(bullets, 1):
        text = str(raw.get("text", "")) if isinstance(raw, dict) else str(raw)
        y = content_top + (index - 1) * row_height
        _add_text(slide, f"{index:02d}", Inches(0.9), Inches(y), Inches(0.58), Inches(0.42), size=16, color=ACCENT, bold=True, name="Narrative point number")
        _add_text(slide, text, Inches(1.65), Inches(y - 0.03), Inches(10.45), Inches(0.66), size=20, color=INK, name="Narrative point")
        if index < len(bullets):
            _add_line(slide, Inches(1.65), Inches(y + 0.72), Inches(10.1))
    return slide


def _column(
    slide, content: dict[str, Any], x, width, top: float, accent: RGBColor = ACCENT
):
    _add_ellipse(slide, x, Inches(top + 0.13), Inches(0.18), Inches(0.18), accent)
    _add_text(slide, content.get("heading", ""), x + Inches(0.34), Inches(top), width - Inches(0.48), Inches(0.72), size=24, bold=True, color=NAVY, name="Column heading")
    body_top = top + 0.96
    _add_bullet_box(slide, content.get("bullets", []), x + Inches(0.34), Inches(body_top), width - Inches(0.48), Inches(6.58 - body_top), size=18, name="Column bullets")


def _render_two_column(prs: Presentation, item: dict[str, Any], comparison: bool = False):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    _add_rect(slide, 0, 0, prs.slide_width, prs.slide_height, PAPER, "Slide background")
    content_top = _add_slide_title(slide, item.get("title", ""), item.get("source", ""))
    _column(slide, item.get("left", {}), Inches(0.88), Inches(5.55), content_top, ACCENT)
    _add_rect(slide, Inches(6.62), Inches(content_top + 0.1), Inches(0.012), Inches(6.48 - content_top), LINE, "Column divider")
    _column(slide, item.get("right", {}), Inches(6.88), Inches(5.52), content_top, POSITIVE if comparison else ACCENT_DARK)
    return slide


def _render_image(prs: Presentation, item: dict[str, Any]):
    image_path = Path(item.get("image", ""))
    if not image_path.exists():
        raise ValueError(f"Image not found: {image_path}")
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    content_top = _add_slide_title(slide, item.get("title", ""), item.get("source", ""))
    from PIL import Image

    with Image.open(image_path) as img:
        ratio = img.width / max(img.height, 1)
    box_x, box_y, box_w, box_h = Inches(0.8), Inches(content_top), Inches(11.75), Inches(6.5 - content_top)
    box_ratio = box_w / box_h
    if ratio >= box_ratio:
        width = box_w
        height = int(width / ratio)
    else:
        height = box_h
        width = int(height * ratio)
    x = box_x + int((box_w - width) / 2)
    y = box_y + int((box_h - height) / 2)
    picture = slide.shapes.add_picture(str(image_path), x, y, width=width, height=height)
    _shape_name(picture, "Primary image")
    if item.get("caption"):
        _add_text(slide, item["caption"], Inches(0.82), Inches(6.62), Inches(11.3), Inches(0.3), size=11, color=MUTED, name="Image caption")
    return slide


CHART_TYPES = {
    "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
    "bar": XL_CHART_TYPE.BAR_CLUSTERED,
    "line": XL_CHART_TYPE.LINE_MARKERS,
    "area": XL_CHART_TYPE.AREA,
    "pie": XL_CHART_TYPE.PIE,
}


def _normalize_chart_axis_ids(chart) -> None:
    """Convert python-pptx's signed random axis IDs to strict OpenXML uint32 values."""
    for element in chart.part._element.iter():
        if not (element.tag.endswith("}axId") or element.tag.endswith("}crossAx")):
            continue
        raw = element.get("val")
        if raw is not None and int(raw) < 0:
            element.set("val", str(int(raw) & 0xFFFFFFFF))


def _render_chart(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    content_top = _add_slide_title(slide, item.get("title", ""), item.get("source", ""))
    chart_spec = item.get("chart", {})
    chart_type = CHART_TYPES.get(str(chart_spec.get("type", "column")).lower())
    if chart_type is None:
        raise ValueError(f"Unsupported native chart type: {chart_spec.get('type')}")
    data = ChartData()
    data.categories = [str(value) for value in chart_spec.get("categories", [])]
    for series in chart_spec.get("series", []):
        data.add_series(str(series.get("name", "Series")), list(series.get("values", [])))
    takeaway = str(item.get("takeaway", "")).strip()
    chart_width = Inches(8.45) if takeaway else Inches(11.55)
    chart_frame = slide.shapes.add_chart(
        chart_type,
        Inches(0.85),
        Inches(content_top),
        chart_width,
        Inches(6.58 - content_top),
        data,
    )
    _shape_name(chart_frame, "Native chart")
    chart = chart_frame.chart
    chart.has_legend = len(chart_spec.get("series", [])) > 1 or chart_type == XL_CHART_TYPE.PIE
    if chart.has_legend:
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
        chart.legend.font.name = FONT
        chart.legend.font.size = Pt(12)
    chart.chart_title.has_text_frame = False
    chart.has_title = False
    if chart_type != XL_CHART_TYPE.PIE:
        chart.value_axis.has_major_gridlines = True
        chart.value_axis.major_gridlines.format.line.color.rgb = LINE
        chart.value_axis.tick_labels.font.name = FONT
        chart.value_axis.tick_labels.font.size = Pt(11)
        chart.category_axis.tick_labels.font.name = FONT
        chart.category_axis.tick_labels.font.size = Pt(11)
    plot = chart.plots[0]
    plot.has_data_labels = True
    plot.data_labels.show_value = True
    plot.data_labels.font.name = FONT
    plot.data_labels.font.size = Pt(11)
    if chart_spec.get("numberFormat"):
        plot.data_labels.number_format = str(chart_spec["numberFormat"])
        plot.data_labels.number_format_is_linked = False
    palette = [ACCENT, NAVY, POSITIVE, RGBColor(240, 158, 64), NEGATIVE]
    for idx, series in enumerate(chart.series):
        series.format.fill.solid()
        series.format.fill.fore_color.rgb = palette[idx % len(palette)]
        series.format.line.color.rgb = palette[idx % len(palette)]
    if takeaway:
        _add_text(
            slide,
            takeaway,
            Inches(9.72),
            Inches(content_top + 0.48),
            Inches(2.55),
            Inches(1.65),
            size=30,
            color=NAVY,
            bold=True,
            valign=MSO_ANCHOR.MIDDLE,
            name="Chart takeaway",
        )
        detail = str(item.get("takeawayDetail", item.get("detail", ""))).strip()
        if detail:
            _add_text(
                slide,
                detail,
                Inches(9.72),
                Inches(content_top + 2.35),
                Inches(2.55),
                Inches(1.2),
                size=17,
                color=MUTED,
                name="Chart takeaway detail",
            )
    _normalize_chart_axis_ids(chart)
    return slide


def _render_table(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    content_top = _add_slide_title(slide, item.get("title", ""), item.get("source", ""))
    columns = item.get("columns", [])
    rows = item.get("rows", [])
    if not columns:
        raise ValueError("Table slide requires columns")
    if len(columns) > 5 or len(rows) > 7:
        raise ValueError("Readable table slides support at most five columns and seven rows")
    shape = slide.shapes.add_table(len(rows) + 1, len(columns), Inches(0.8), Inches(content_top), Inches(11.75), Inches(6.55 - content_top))
    _shape_name(shape, "Data table")
    table = shape.table
    for col_index, value in enumerate(columns):
        cell = table.cell(0, col_index)
        cell.text = str(value)
        cell.fill.solid()
        cell.fill.fore_color.rgb = NAVY
    for row_index, row in enumerate(rows, 1):
        for col_index in range(len(columns)):
            cell = table.cell(row_index, col_index)
            cell.text = str(row[col_index] if col_index < len(row) else "")
            cell.fill.solid()
            cell.fill.fore_color.rgb = WHITE if row_index % 2 else PAPER
    for row_index in range(len(rows) + 1):
        for col_index in range(len(columns)):
            cell = table.cell(row_index, col_index)
            cell.margin_left = Inches(0.08)
            cell.margin_right = Inches(0.08)
            cell.margin_top = Inches(0.05)
            cell.margin_bottom = Inches(0.05)
            for paragraph in cell.text_frame.paragraphs:
                for run in paragraph.runs:
                    run.font.name = FONT
                    run.font.size = Pt(16)
                    run.font.color.rgb = WHITE if row_index == 0 else INK
                    run.font.bold = row_index == 0
                paragraph.alignment = PP_ALIGN.LEFT
    return slide


def _render_metrics(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    content_top = _add_slide_title(slide, item.get("title", ""), item.get("source", ""))
    metrics = list(item.get("metrics", []))
    if not 1 <= len(metrics) <= 3:
        raise ValueError("Metrics slide requires one to three metrics")
    available = 11.55
    gap = 0.42
    width = (available - gap * (len(metrics) - 1)) / len(metrics)
    value_top = content_top + 0.35
    for index, metric in enumerate(metrics):
        x = 0.88 + index * (width + gap)
        _add_text(
            slide,
            str(metric.get("value", "")),
            Inches(x),
            Inches(value_top),
            Inches(width),
            Inches(1.45),
            size=48,
            color=ACCENT if index == 0 else NAVY,
            bold=True,
            valign=MSO_ANCHOR.BOTTOM,
            name="Metric value",
        )
        _add_line(slide, Inches(x), Inches(value_top + 1.7), Inches(width - 0.15))
        _add_text(
            slide,
            str(metric.get("label", "")),
            Inches(x),
            Inches(value_top + 2.0),
            Inches(width - 0.15),
            Inches(0.82),
            size=19,
            color=INK,
            bold=True,
            name="Metric label",
        )
        detail = str(metric.get("detail", "")).strip()
        if detail:
            _add_text(
                slide,
                detail,
                Inches(x),
                Inches(value_top + 3.0),
                Inches(width - 0.15),
                Inches(0.9),
                size=16,
                color=MUTED,
                name="Metric detail",
            )
    return slide


def _render_process(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    content_top = _add_slide_title(slide, item.get("title", ""), item.get("source", ""))
    steps = list(item.get("steps", []))
    if not 2 <= len(steps) <= 5:
        raise ValueError("Process slide requires two to five steps")
    start_x = 1.3
    end_x = 12.0
    center_y = max(3.18, content_top + 1.42)
    spacing = (end_x - start_x) / (len(steps) - 1)
    _add_rect(
        slide,
        Inches(start_x),
        Inches(center_y + 0.2),
        Inches(end_x - start_x),
        Inches(0.025),
        LINE,
        "Process connector",
    )
    for index, step in enumerate(steps, 1):
        center_x = start_x + (index - 1) * spacing
        _add_ellipse(
            slide,
            Inches(center_x - 0.28),
            Inches(center_y - 0.08),
            Inches(0.56),
            Inches(0.56),
            ACCENT if index == 1 else NAVY,
            "Process node",
        )
        _add_text(
            slide,
            str(index),
            Inches(center_x - 0.28),
            Inches(center_y + 0.02),
            Inches(0.56),
            Inches(0.3),
            size=16,
            color=WHITE,
            bold=True,
            align=PP_ALIGN.CENTER,
            name="Process step number",
        )
        box_width = min(2.15, spacing * 0.82)
        _add_text(
            slide,
            str(step.get("title", "")),
            Inches(center_x - box_width / 2),
            Inches(center_y + 0.94),
            Inches(box_width),
            Inches(0.78),
            size=18,
            color=INK,
            bold=True,
            align=PP_ALIGN.CENTER,
            name="Process step title",
        )
        _add_text(
            slide,
            str(step.get("detail", "")),
            Inches(center_x - box_width / 2),
            Inches(center_y + 1.84),
            Inches(box_width),
            Inches(0.82),
            size=16,
            color=MUTED,
            align=PP_ALIGN.CENTER,
            name="Process step detail",
        )
    return slide


def _render_summary(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    _add_rect(slide, 0, 0, prs.slide_width, prs.slide_height, NAVY, "Summary background")
    title = str(item.get("title", "Следующие шаги"))
    title_lines = _estimated_line_count(title, 42)
    if title_lines > 3:
        raise ValueError("Summary title exceeds three readable lines")
    title_height = max(0.92, title_lines * 0.56)
    _add_text(slide, title, Inches(0.85), Inches(0.6), Inches(11.5), Inches(title_height), size=38, color=WHITE, bold=True, name="Slide title")
    bullets = list(item.get("bullets", []))
    if len(bullets) > 5:
        raise ValueError("Summary supports at most five decisions")
    content_top = 0.6 + title_height + 0.34
    row_height = min(1.0, (6.55 - content_top) / max(len(bullets), 1))
    for index, bullet in enumerate(bullets, 1):
        y = content_top + (index - 1) * row_height
        _add_text(slide, f"{index:02d}", Inches(0.9), Inches(y), Inches(0.55), Inches(0.42), size=16, color=ACCENT, bold=True, name="Summary point number")
        _add_text(slide, str(bullet), Inches(1.65), Inches(y - 0.04), Inches(10.2), Inches(0.68), size=22, color=WHITE, name="Summary point")
        if index < len(bullets):
            _add_line(slide, Inches(1.65), Inches(y + 0.72), Inches(9.9), RGBColor(53, 64, 79), name="Summary divider")
    if item.get("source"):
        _add_text(slide, item["source"], Inches(0.85), Inches(7.03), Inches(11), Inches(0.25), size=10, color=RGBColor(172, 189, 208), name="Source note")
    return slide


def _source_location(url: str) -> tuple[str, str | None]:
    """What to print on the slide, and the full address to park in the notes.

    A raw `https://www.cnbc.com/2026/07/27/apple-most-valuable-company-nvidia.html`
    printed on a slide is unreadable and cannot be clicked from a projector, so the
    slide carries the site and the notes carry the address the reader can copy.
    Non-web locations ("financial-model.xlsx — sheet «Plan»") are already short and
    are printed verbatim.
    """
    text = str(url).strip()
    if not text.lower().startswith(("http://", "https://")):
        return text, None
    host = urllib.parse.urlsplit(text).netloc
    if host.startswith("www."):
        host = host[4:]
    return host or text, text


def _bare_domain_sources(spec: dict[str, Any]) -> list[str]:
    """Web sources that name only a site, with no page carrying the claimed fact.

    `https://www.statista.com/` is not a source: the reader cannot check anything
    with it. The builder has no network and cannot tell a live page from a dead
    one, but it can refuse the class of citation that is unverifiable by
    construction.
    """
    entries = list(spec.get("sources", []))
    for item in spec.get("slides", []):
        if str(item.get("layout", "")).lower() == "sources":
            entries.extend(item.get("entries", []))
    bare = []
    for entry in entries:
        url = entry.get("url", "") if isinstance(entry, dict) else str(entry)
        text = str(url).strip()
        if not text.lower().startswith(("http://", "https://")):
            continue
        parsed = urllib.parse.urlsplit(text)
        if parsed.path.strip("/") or parsed.query:
            continue
        bare.append(text)
    return bare


def _render_sources(prs: Presentation, item: dict[str, Any]):
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    content_top = _add_slide_title(slide, item.get("title", "Sources"))
    entries = list(item.get("entries", []))
    if len(entries) > 8:
        raise ValueError("Sources slide supports at most eight entries")
    # Rows take the height they actually have. A fixed 0.68 row with a 0.42 label
    # box was sized for a one-line label; a real one ("Capital.com — ИИ-компании
    # по капитализации") wraps onto the divider and the row below, on a slide
    # that is two thirds empty.
    available = 6.72 - content_top
    row_height = max(0.68, min(1.30, available / max(len(entries), 1)))
    label_height = row_height - 0.16
    rows = []
    for entry in entries:
        label = entry.get("label", "Source") if isinstance(entry, dict) else "Source"
        url = entry.get("url", "") if isinstance(entry, dict) else str(entry)
        rows.append((str(label), *_source_location(url)))
    notes: list[str] = []
    for idx, (label, shown, full) in enumerate(rows, 1):
        if full:
            notes.append(f"{idx:02d}. {label} — {full}")
        y = content_top + (idx - 1) * row_height
        _add_text(slide, f"{idx:02d}", Inches(0.88), Inches(y), Inches(0.48), Inches(0.3), size=16, color=ACCENT, bold=True, name="Source number")
        _add_text(slide, str(label), Inches(1.55), Inches(y - 0.02), Inches(4.0), Inches(label_height), size=18, color=INK, bold=True, name="Source label")
        _add_text(slide, shown, Inches(5.65), Inches(y - 0.01), Inches(6.35), Inches(label_height), size=16, color=MUTED, name="Source location")
        if idx < len(entries):
            _add_line(slide, Inches(1.55), Inches(y + row_height - 0.14), Inches(10.45), name="Source divider")
    if notes:
        slide.notes_slide.notes_text_frame.text = "\n".join(notes)
    return slide


RENDERERS = {
    "title": _render_title,
    "claim": _render_claim,
    "section": _render_section,
    "bullets": _render_bullets,
    "two_column": _render_two_column,
    "comparison": lambda prs, item: _render_two_column(prs, item, comparison=True),
    "image": _render_image,
    "chart": _render_chart,
    "table": _render_table,
    "metrics": _render_metrics,
    "process": _render_process,
    "summary": _render_summary,
    "sources": _render_sources,
}


def _template_body_placeholders(slide):
    title = slide.shapes.title
    title_id = title.shape_id if title is not None else None
    return sorted(
        [
            shape
            for shape in slide.placeholders
            if shape.shape_id != title_id and getattr(shape, "has_text_frame", False)
        ],
        key=lambda shape: (shape.top, shape.left),
    )


def _set_template_text(shape, text: str = "", bullets: list[Any] | None = None) -> None:
    frame = shape.text_frame
    frame.clear()
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
    values = bullets if bullets is not None else [text]
    for index, item in enumerate(values):
        if isinstance(item, dict):
            value = str(item.get("text", ""))
            level = min(max(int(item.get("level", 0)), 0), 2)
        else:
            value = str(item)
            level = 0
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.text = value
        paragraph.level = level


def _fit_template_title(shape, text: str) -> None:
    """Conservatively size multiline inherited titles for PowerPoint and LibreOffice."""
    frame = shape.text_frame
    available_width = max(
        1.0,
        (shape.width - frame.margin_left - frame.margin_right) / Inches(1) * 72,
    )
    conservative_chars = max(8, int(available_width / (30 * 0.52)))
    if _estimated_line_count(text, conservative_chars) <= 1:
        return
    frame.vertical_anchor = MSO_ANCHOR.TOP
    available_height = max(
        1.0,
        (shape.height - frame.margin_top - frame.margin_bottom) / Inches(1) * 72,
    )
    selected_size = 18
    for size in range(30, 17, -1):
        average_character_width = size * 0.52
        max_chars = max(8, int(available_width / average_character_width))
        lines = _estimated_line_count(text, max_chars)
        if lines * size * 1.2 <= available_height:
            selected_size = size
            break
    for paragraph in frame.paragraphs:
        for run in paragraph.runs:
            run.font.size = Pt(selected_size)


def _template_content_box(slide, prs: Presentation):
    placeholders = _template_body_placeholders(slide)
    if placeholders:
        placeholder = placeholders[0]
        _set_template_text(placeholder, "")
        return placeholder.left, placeholder.top, placeholder.width, placeholder.height
    return (
        int(prs.slide_width * 0.065),
        int(prs.slide_height * 0.21),
        int(prs.slide_width * 0.87),
        int(prs.slide_height * 0.66),
    )


def _ensure_template_bodies(
    slide, prs: Presentation, bodies: list[Any], count: int = 1
) -> list[Any]:
    """Require the chosen layout to expose enough inherited content placeholders."""
    if len(bodies) < count:
        raise ValueError(
            f"Template layout requires {count} inherited content placeholder(s), "
            f"but only {len(bodies)} were found"
        )
    return bodies


def _render_template_item(prs: Presentation, item: dict[str, Any]):
    """Fill a user layout's native placeholders without replacing its theme or background."""
    slide = prs.slides.add_slide(_template_layout(prs, item.get("templateLayout")))
    layout = str(item.get("layout", "")).lower()
    title = slide.shapes.title
    title_text = str(item.get("title", item.get("claim", "")))
    if title is not None:
        _set_template_text(title, title_text)
        _fit_template_title(title, title_text)
    elif title_text:
        _add_text(
            slide,
            title_text,
            int(prs.slide_width * 0.06),
            int(prs.slide_height * 0.055),
            int(prs.slide_width * 0.88),
            int(prs.slide_height * 0.12),
            size=30,
            bold=True,
            name="Slide title",
        )
    bodies = _template_body_placeholders(slide)

    if layout == "title":
        _set_template_text(
            _ensure_template_bodies(slide, prs, bodies)[0], str(item.get("subtitle", ""))
        )
    elif layout == "claim":
        content = [str(item.get("claim", "")), str(item.get("support", ""))]
        _set_template_text(
            _ensure_template_bodies(slide, prs, bodies)[0],
            bullets=[value for value in content if value],
        )
    elif layout in {"bullets", "summary"}:
        _set_template_text(
            _ensure_template_bodies(slide, prs, bodies)[0],
            bullets=list(item.get("bullets", [])),
        )
    elif layout in {"two_column", "comparison"}:
        columns = [item.get("left", {}), item.get("right", {})]
        _ensure_template_bodies(slide, prs, bodies, 2)
        for shape, content in zip(bodies[:2], columns):
            values = [str(content.get("heading", "")), *list(content.get("bullets", []))]
            _set_template_text(shape, bullets=values)
    elif layout == "section":
        _set_template_text(
            _ensure_template_bodies(slide, prs, bodies)[0], str(item.get("subtitle", ""))
        )
    elif layout == "sources":
        entries = item.get("entries", [])
        values = []
        notes = []
        for index, entry in enumerate(entries, 1):
            if not isinstance(entry, dict):
                values.append(f"{index}. {entry}")
                continue
            label = entry.get("label", "Source")
            shown, full = _source_location(entry.get("url", ""))
            values.append(f"{index}. {label} — {shown}")
            if full:
                notes.append(f"{index:02d}. {label} — {full}")
        _set_template_text(_ensure_template_bodies(slide, prs, bodies)[0], bullets=values)
        if notes:
            slide.notes_slide.notes_text_frame.text = "\n".join(notes)
    elif layout == "chart":
        x, y, width, height = _template_content_box(slide, prs)
        chart_spec = item.get("chart", {})
        chart_type = CHART_TYPES.get(str(chart_spec.get("type", "column")).lower())
        if chart_type is None:
            raise ValueError(f"Unsupported native chart type: {chart_spec.get('type')}")
        data = ChartData()
        data.categories = [str(value) for value in chart_spec.get("categories", [])]
        for series in chart_spec.get("series", []):
            data.add_series(str(series.get("name", "Series")), list(series.get("values", [])))
        chart_frame = slide.shapes.add_chart(chart_type, x, y, width, height, data)
        _normalize_chart_axis_ids(chart_frame.chart)
    elif layout == "table":
        columns = list(item.get("columns", []))
        rows = list(item.get("rows", []))
        if not columns:
            raise ValueError("Table slide requires columns")
        x, y, width, height = _template_content_box(slide, prs)
        table = slide.shapes.add_table(len(rows) + 1, len(columns), x, y, width, height).table
        for column, value in enumerate(columns):
            table.cell(0, column).text = str(value)
        for row_index, row in enumerate(rows, 1):
            for column in range(len(columns)):
                table.cell(row_index, column).text = str(row[column] if column < len(row) else "")
    elif layout == "image":
        image_path = Path(item.get("image", ""))
        if not image_path.exists():
            raise ValueError(f"Image not found: {image_path}")
        x, y, width, height = _template_content_box(slide, prs)
        slide.shapes.add_picture(str(image_path), x, y, width=width, height=height)
    else:
        raise ValueError(f"Unsupported template slide layout: {layout}")

    if item.get("source"):
        _add_text(
            slide,
            item["source"],
            int(prs.slide_width * 0.06),
            int(prs.slide_height * 0.945),
            int(prs.slide_width * 0.88),
            int(prs.slide_height * 0.03),
            size=8,
            color=MUTED,
            name="Source note",
        )
    return slide


def _apply_edits(prs: Presentation, edits: list[dict[str, Any]]) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    for edit in edits:
        slide_number = int(edit.get("slide", 0))
        if slide_number < 1 or slide_number > len(prs.slides):
            raise ValueError(f"Edit references missing slide {slide_number}")
        replacements = edit.get("replacements") or {}
        slide = prs.slides[slide_number - 1]
        matched = 0
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False):
                continue
            for paragraph in shape.text_frame.paragraphs:
                original_paragraph = paragraph.text
                paragraph_matched = False
                for run in paragraph.runs:
                    for old, new in replacements.items():
                        if old in run.text:
                            run.text = run.text.replace(old, str(new))
                            matched += 1
                            paragraph_matched = True
                if not paragraph_matched:
                    updated_paragraph = original_paragraph
                    replacement_count = 0
                    for old, new in replacements.items():
                        if old in updated_paragraph:
                            updated_paragraph = updated_paragraph.replace(old, str(new))
                            replacement_count += 1
                    if replacement_count and paragraph.runs:
                        paragraph.runs[0].text = updated_paragraph
                        for run in paragraph.runs[1:]:
                            run.text = ""
                        matched += replacement_count
        if replacements and matched == 0:
            raise ValueError(f"No replacement text matched on slide {slide_number}")
        changes.append({"target": f"Slide {slide_number}", "summary": edit.get("summary", "Updated requested text")})
    return changes


def _remove_existing_slides(prs: Presentation) -> None:
    """Keep a template's masters/layouts/theme while removing its sample slides."""
    slide_ids = list(prs.slides._sldIdLst)
    for slide_id in slide_ids:
        relationship_id = slide_id.rId
        prs.part.drop_rel(relationship_id)
        prs.slides._sldIdLst.remove(slide_id)


def _build(spec: dict[str, Any], output: Path) -> tuple[Presentation, list[dict[str, str]]]:
    _configure_theme(spec)
    input_path = spec.get("inputPath")
    template_path = spec.get("templatePath")
    source_path = input_path or template_path
    if source_path:
        source = Path(source_path)
        if not source.exists():
            raise ValueError(f"Input/template deck not found: {source}")
        if source.resolve() == output.resolve():
            raise ValueError("Inputs are immutable; output path must differ from input/template")
        prs = Presentation(str(source))
        if template_path and not input_path:
            _remove_existing_slides(prs)
    else:
        prs = Presentation()
        prs.slide_width = WIDE_WIDTH
        prs.slide_height = WIDE_HEIGHT

    changes: list[dict[str, str]] = []
    if input_path:
        changes.extend(_apply_edits(prs, spec.get("edits", [])))
    else:
        if template_path and any(not item.get("templateLayout") for item in spec.get("slides", [])):
            raise ValueError("Every slide must name templateLayout when a user template is supplied")
        for item in spec.get("slides", []):
            layout = str(item.get("layout", "")).lower()
            renderer = RENDERERS.get(layout)
            if renderer is None:
                raise ValueError(f"Unsupported slide layout: {layout}")
            if template_path:
                _render_template_item(prs, item)
            else:
                renderer(prs, item)
        sources = spec.get("sources", [])
        has_sources_slide = any(str(item.get("layout", "")).lower() == "sources" for item in spec.get("slides", []))
        if template_path and sources and not has_sources_slide:
            raise ValueError("Template decks with sources require an explicit sources slide and templateLayout")
        if sources and not has_sources_slide:
            locale = str(spec.get("job", {}).get("locale", "ru-RU")).lower()
            title = "Источники" if locale.startswith("ru") else "Sources"
            _render_sources(prs, {"title": title, "entries": sources})

    if not input_path and not template_path:
        for number, slide in enumerate(prs.slides, 1):
            if number > 1:
                _add_footer_number(slide, number)

    changes.extend(spec.get("changeLog", []))
    # A targeted revision must not silently rewrite document metadata outside
    # the requested slide(s). New and template-based decks still receive useful
    # provenance; an input deck retains its original core properties verbatim.
    if not input_path:
        prs.core_properties.title = spec.get("job", {}).get("goal", output.stem)
        prs.core_properties.subject = spec.get("job", {}).get("audience", "")
        prs.core_properties.comments = (
            f"Generated by pptx skill {SKILL_VERSION}; inputs treated as immutable."
        )
    return prs, changes


def _issue(code: str, severity: str, message: str, target: str | None = None) -> dict[str, Any]:
    result = {"code": code, "severity": severity, "message": message}
    if target:
        result["target"] = target
    return result


def _text_exceeds_shape_capacity(shape) -> bool:
    if not getattr(shape, "has_text_frame", False) or not shape.text.strip():
        return False
    frame = shape.text_frame
    width_pt = max(
        (shape.width - frame.margin_left - frame.margin_right) / 12700,
        1,
    )
    height_pt = max(
        (shape.height - frame.margin_top - frame.margin_bottom) / 12700,
        1,
    )
    required_pt = 0.0
    measured = False
    for paragraph in frame.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        sizes = [
            run.font.size.pt
            for run in paragraph.runs
            if run.text.strip() and run.font.size is not None
        ]
        if not sizes:
            continue
        measured = True
        font_size = max(sizes)
        max_chars = max(int(width_pt / max(font_size * 0.5, 1)), 1)
        required_pt += _estimated_line_count(text, max_chars) * font_size * 1.02
        if paragraph.space_after is not None:
            required_pt += paragraph.space_after.pt
    return measured and required_pt > height_pt * 1.04


def _check_structure(path: Path, spec: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    checks: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    try:
        prs = Presentation(str(path))
        checks.append({"name": "reopen", "status": "passed", "message": f"PPTX reopens with {len(prs.slides)} slides"})
    except Exception as exc:
        return ([{"name": "reopen", "status": "failed", "message": str(exc)}], [_issue("pptx-reopen", "critical", str(exc))])

    if not prs.slides:
        issues.append(_issue("empty-deck", "critical", "Deck has no slides"))
    source_path = spec.get("inputPath") or spec.get("templatePath")
    if source_path:
        source = Presentation(str(source_path))
        if spec.get("templatePath"):
            source_layouts = sum(len(master.slide_layouts) for master in source.slide_masters)
            output_layouts = sum(len(master.slide_layouts) for master in prs.slide_masters)
            preserved = (
                len(source.slide_masters) == len(prs.slide_masters)
                and source_layouts == output_layouts
                and source.slide_width == prs.slide_width
                and source.slide_height == prs.slide_height
            )
            checks.append({"name": "template-preservation", "status": "passed" if preserved else "failed", "message": "Template masters, layouts, and slide geometry are preserved" if preserved else "Template masters, layouts, or slide geometry changed"})
            if not preserved:
                issues.append(_issue("template-damaged", "critical", "Template masters, layouts, or slide geometry changed"))
        if spec.get("inputPath"):
            same_count = len(source.slides) == len(prs.slides)
            checks.append({"name": "targeted-edit", "status": "passed" if same_count else "failed", "message": "Targeted edit preserved the original slide count" if same_count else "Targeted edit changed the slide count"})
            if not same_count:
                issues.append(_issue("edit-scope", "critical", "Targeted edit changed unaffected deck structure"))
            edited_parts = {
                f"ppt/slides/slide{int(edit.get('slide', 0))}.xml"
                for edit in spec.get("edits", [])
            }
            try:
                changed_parts = _changed_package_parts(Path(source_path), path)
                unexpected_parts = sorted(changed_parts - edited_parts)
                scope_preserved = not unexpected_parts
                scope_message = (
                    "Only requested slide XML changed"
                    if scope_preserved
                    else "Unexpected package parts changed: " + ", ".join(unexpected_parts)
                )
            except Exception as exc:
                scope_preserved = False
                scope_message = (
                    "Could not verify targeted edit scope "
                    f"({type(exc).__name__})"
                )
            checks.append(
                {
                    "name": "targeted-edit-scope",
                    "status": "passed" if scope_preserved else "failed",
                    "message": scope_message,
                }
            )
            if not scope_preserved:
                issues.append(
                    _issue(
                        "edit-scope",
                        "critical",
                        "Targeted edit changed content outside the requested slide XML",
                    )
                )
    off_slide = 0
    dense = 0
    title_risks = 0
    undersized_text = 0
    overflow_risks = 0
    native_charts = 0
    for slide_index, slide in enumerate(prs.slides, 1):
        for shape in slide.shapes:
            if shape.left < 0 or shape.top < 0 or shape.left + shape.width > prs.slide_width or shape.top + shape.height > prs.slide_height:
                off_slide += 1
                issues.append(_issue("off-slide", "critical", f"Shape '{shape.name}' crosses the slide boundary", f"Slide {slide_index}"))
            if shape.shape_type == MSO_SHAPE_TYPE.CHART:
                native_charts += 1
            if getattr(shape, "has_text_frame", False):
                text = shape.text.strip()
                if _text_exceeds_shape_capacity(shape):
                    overflow_risks += 1
                    # Name the text, not just the shape. Two long labels on one
                    # slide produced two identical messages, so the reader could
                    # not tell which one to shorten and retried blindly until the
                    # agent runtime cut the turn off.
                    snippet = text if len(text) <= 60 else text[:57].rstrip() + "…"
                    issues.append(
                        _issue(
                            "text-overflow-risk",
                            "critical",
                            f"Text is unlikely to fit inside '{shape.name}' at the configured "
                            f'font size: "{snippet}" — shorten it',
                            f"Slide {slide_index}",
                        )
                    )
                if shape.name in {"Slide title", "Deck title", "Section title"} and len(text) > 100:
                    title_risks += 1
                    issues.append(_issue("title-wrap", "warning", "Title is likely to wrap excessively", f"Slide {slide_index}"))
                if shape.name in {"Bullet list", "Column bullets", "Summary bullets"} and len(text) > 900:
                    dense += 1
                    issues.append(_issue("dense-text", "warning", "Body text is too dense for a presentation", f"Slide {slide_index}"))
                if shape.name not in {"Source note", "Slide number", "Image caption"}:
                    minimum = 35 if shape.name == "Slide title" else 16
                    sizes = [
                        run.font.size.pt
                        for paragraph in shape.text_frame.paragraphs
                        for run in paragraph.runs
                        if run.text.strip() and run.font.size is not None
                    ]
                    if sizes and min(sizes) < minimum:
                        undersized_text += 1
                        issues.append(
                            _issue(
                                "undersized-text",
                                "warning",
                                f"Text in '{shape.name}' is smaller than {minimum} pt",
                                f"Slide {slide_index}",
                            )
                        )

    checks.append({"name": "slide-bounds", "status": "failed" if off_slide else "passed", "message": f"{off_slide} shapes cross slide bounds" if off_slide else "All shapes stay inside slide bounds"})
    checks.append({"name": "text-density", "status": "warning" if dense or title_risks else "passed", "message": f"{dense + title_risks} slides need text review" if dense or title_risks else "Titles and body text fit presentation limits"})
    checks.append({"name": "text-fit", "status": "failed" if overflow_risks else "passed", "message": f"{overflow_risks} text boxes are likely to overflow" if overflow_risks else "Text fits the configured shape capacities"})
    checks.append({"name": "type-scale", "status": "warning" if undersized_text else "passed", "message": f"{undersized_text} text boxes use undersized presentation text" if undersized_text else "Presentation type scale meets minimums"})
    requested_charts = sum(1 for slide in spec.get("slides", []) if slide.get("layout") == "chart")
    chart_status = "passed" if native_charts >= requested_charts else "failed"
    checks.append({"name": "native-charts", "status": chart_status, "message": f"Found {native_charts} editable native charts", "details": {"requested": requested_charts, "found": native_charts}})
    if native_charts < requested_charts:
        issues.append(_issue("missing-native-chart", "critical", "One or more requested charts are not editable PowerPoint charts"))
    if spec.get("sources"):
        source_text = " ".join(shape.text for slide in prs.slides for shape in slide.shapes if getattr(shape, "has_text_frame", False)).lower()
        present = "sources" in source_text or "источ" in source_text
        checks.append({"name": "sources", "status": "passed" if present else "failed", "message": "Sources slide is present" if present else "Sources were supplied but no sources slide was found"})
        if not present:
            issues.append(_issue("missing-sources", "critical", "Supplied sources are not traceable in the deck"))
        bare = _bare_domain_sources(spec)
        checks.append(
            {
                "name": "source-specificity",
                "status": "failed" if bare else "passed",
                "message": "Every web source points at a specific page"
                if not bare
                else "Sources point at a site's front page, not the page carrying the fact: "
                + ", ".join(bare),
            }
        )
        if bare:
            issues.append(
                _issue(
                    "unspecific-source",
                    "critical",
                    "A source that names only a site does not let the reader check the fact",
                )
            )

    fact_layouts = {"claim", "chart", "table", "metrics"}
    missing_slide_sources = [
        index
        for index, slide in enumerate(spec.get("slides", []), 1)
        if str(slide.get("layout", "")).lower() in fact_layouts
        and not str(slide.get("source", "")).strip()
    ]
    checks.append(
        {
            "name": "slide-sources",
            "status": "failed" if missing_slide_sources else "passed",
            "message": (
                f"Fact slides without a visible source: {', '.join(map(str, missing_slide_sources))}"
                if missing_slide_sources
                else "Every fact slide has a visible source"
            ),
        }
    )
    for slide_number in missing_slide_sources:
        issues.append(
            _issue(
                "missing-slide-source",
                "critical",
                "Fact slide has no visible source note",
                f"Slide {slide_number}",
            )
        )
    return checks, issues


def _render(
    path: Path, keep_pdf: bool, expected_slides: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Path | None]:
    checks: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        checks.append({"name": "render", "status": "failed", "message": "LibreOffice is unavailable"})
        issues.append(_issue("render-unavailable", "critical", "LibreOffice render could not run"))
        return checks, issues, None
    render_dir = Path(tempfile.mkdtemp(prefix="pptx-qa-"))
    profile_dir = render_dir / "profile"
    command = [
        soffice,
        "--headless",
        "--norestore",
        "--nodefault",
        "--nofirststartwizard",
        f"-env:UserInstallation=file://{profile_dir}",
        "--convert-to",
        "pdf",
        "--outdir",
        str(render_dir),
        str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=45, check=False)
        pdf = render_dir / f"{path.stem}.pdf"
        if result.returncode != 0 or not pdf.exists() or pdf.stat().st_size == 0:
            message = (result.stderr or result.stdout or "LibreOffice did not create a PDF").strip()[-400:]
            checks.append({"name": "render", "status": "failed", "message": message})
            issues.append(_issue("render-failed", "critical", "LibreOffice could not render the deck"))
            return checks, issues, None
        checks.append({"name": "render", "status": "passed", "message": "Every slide rendered through LibreOffice"})

        raster = shutil.which("pdftoppm")
        if raster:
            prefix = render_dir / "slide"
            raster_result = subprocess.run([raster, "-png", "-r", "110", str(pdf), str(prefix)], capture_output=True, text=True, timeout=60, check=False)
            images = sorted(render_dir.glob("slide-*.png"))
            if raster_result.returncode == 0 and images:
                from PIL import Image, ImageStat

                blank = 0
                image_hashes: list[str] = []
                for image_path in images:
                    with Image.open(image_path) as source_image:
                        rgb = source_image.convert("RGB")
                        stat = ImageStat.Stat(rgb.convert("L"))
                        if stat.var[0] < 2.0:
                            blank += 1
                        image_hashes.append(hashlib.sha256(rgb.tobytes()).hexdigest())
                wrong_count = len(images) != expected_slides
                failed = bool(blank or wrong_count)
                message = (
                    f"Rendered {len(images)} of {expected_slides} expected slides"
                    if wrong_count
                    else f"{blank} blank slide renders"
                    if blank
                    else f"Raster-checked {len(images)} rendered slides"
                )
                checks.append(
                    {
                        "name": "visual-raster",
                        "status": "failed" if failed else "passed",
                        "message": message,
                        "details": {"imageHashes": image_hashes},
                    }
                )
                if blank:
                    issues.append(_issue("blank-render", "critical", f"{blank} slides rendered blank"))
                if wrong_count:
                    issues.append(
                        _issue(
                            "render-page-count",
                            "critical",
                            f"Rendered {len(images)} of {expected_slides} expected slides",
                        )
                    )
            else:
                checks.append({"name": "visual-raster", "status": "warning", "message": "PDF rasterization was unavailable"})
                issues.append(_issue("raster-unavailable", "warning", "Rendered PDF could not be raster-checked"))
        else:
            checks.append({"name": "visual-raster", "status": "warning", "message": "Poppler rasterizer is unavailable"})
            issues.append(_issue("raster-unavailable", "warning", "Rendered PDF could not be raster-checked"))
        preview_pdf = None
        if keep_pdf:
            preview_pdf = path.with_suffix(".pdf")
            shutil.copy2(pdf, preview_pdf)
        return checks, issues, preview_pdf
    except subprocess.TimeoutExpired:
        checks.append({"name": "render", "status": "failed", "message": "LibreOffice render timed out"})
        issues.append(_issue("render-timeout", "critical", "LibreOffice render exceeded 45 seconds"))
        return checks, issues, None
    finally:
        shutil.rmtree(render_dir, ignore_errors=True)


def _report(spec: dict[str, Any], checks: list[dict[str, Any]], issues: list[dict[str, Any]], changes: list[dict[str, str]], preview_pdf: Path | None, repair_iterations: int = 0) -> dict[str, Any]:
    status = "needs_review" if any(issue.get("severity") == "critical" for issue in issues) else "ready"
    return {
        "status": status,
        "format": "pptx",
        "sourceFileIds": list(spec.get("job", {}).get("sourceFileIds", [])),
        "previewAssets": ([{"filename": preview_pdf.name, "kind": "pdf"}] if preview_pdf else []),
        "qaChecks": checks,
        "issues": issues,
        "changeLog": changes,
        "skillVersion": SKILL_VERSION,
        "repairIterations": min(max(repair_iterations, 0), MAX_REPAIR_ITERATIONS),
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: build_presentation.py SPEC.json OUTPUT.pptx", file=sys.stderr)
        return 2
    spec_path = Path(sys.argv[1])
    output = Path(sys.argv[2])
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    _job(spec, output)
    source_path = spec.get("inputPath") or spec.get("templatePath")
    source_hash = _sha256(Path(source_path)) if source_path else None
    output.parent.mkdir(parents=True, exist_ok=True)
    prs, changes = _build(spec, output)
    prs.save(str(output))
    checks, issues = _check_structure(output, spec)
    if source_path:
        immutable = source_hash == _sha256(Path(source_path))
        checks.append({"name": "immutable-input", "status": "passed" if immutable else "failed", "message": "Input/template file was not modified" if immutable else "Input/template file changed during authoring"})
        if not immutable:
            issues.append(_issue("input-modified", "critical", "Input/template file changed during authoring"))
    render_checks, render_issues, rendered_pdf = _render(
        output,
        keep_pdf=bool(spec.get("outputPdf", True)),
        expected_slides=len(prs.slides),
    )
    checks.extend(render_checks)
    issues.extend(render_issues)
    preview_pdf = rendered_pdf
    report = _report(spec, checks, issues, changes, preview_pdf, int(spec.get("repairIterations", 0)))
    report_path = Path(f"{output}.artifact-report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    reports = [str(report_path)]
    if preview_pdf:
        pdf_report = {
            **report,
            "format": "pdf",
            "previewAssets": [],
            "changeLog": [*changes, {"target": preview_pdf.name, "summary": "Derived PDF from the verified editable presentation"}],
        }
        pdf_report_path = Path(f"{preview_pdf}.artifact-report.json")
        pdf_report_path.write_text(json.dumps(pdf_report, ensure_ascii=False, indent=2), encoding="utf-8")
        reports.append(str(pdf_report_path))
    print(json.dumps({"artifact": str(output), "reports": reports, "status": report["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
