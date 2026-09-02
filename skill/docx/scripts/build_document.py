#!/usr/bin/env python3
"""Deterministic DOCX builder with structural and rendered QA."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import zipfile
from pathlib import Path
from typing import Any, Iterable, Iterator

from docx import Document
from docx.document import Document as DocumentObject
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph
from lxml import etree


SKILL_VERSION = "1.0.0"
MAX_REPAIR_ITERATIONS = 2
DEFAULT_FONT = "Arial"
ALLOWED_FONTS = {"Arial", "Calibri", "PT Sans", "Liberation Sans"}
PAGE_WIDTH_DXA = 9638  # A4 with 20 mm left/right margins.

COLORS = {
    "ink": "20242A",
    "muted": "606A78",
    "accent": "2458A6",
    "accent_dark": "183B70",
    "line": "D8DEE8",
    "surface": "F3F6FA",
    "table_header": "E9EFF7",
    "white": "FFFFFF",
}

RU_LABELS = {
    "memo": "\u0417\u0410\u041f\u0418\u0421\u041a\u0410 \u041a \u0420\u0415\u0428\u0415\u041d\u0418\u042e",
    "report": "\u0411\u0418\u0417\u041d\u0415\u0421-\u041e\u0422\u0427\u0401\u0422",
    "sop": "\u0421\u0422\u0410\u041d\u0414\u0410\u0420\u0422\u041d\u0410\u042f \u041e\u041f\u0415\u0420\u0410\u0426\u0418\u041e\u041d\u041d\u0410\u042f \u041f\u0420\u041e\u0426\u0415\u0414\u0423\u0420\u0410",
    "assumptions": "\u0414\u043e\u043f\u0443\u0449\u0435\u043d\u0438\u044f",
    "sources": "\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0438",
    "page": "\u0421\u0442\u0440. ",
    "of": " \u0438\u0437 ",
    "source_stem": "\u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a",
    "accessed": "\u0434\u0430\u0442\u0430 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f",
    "change_template": "\u0417\u0430\u043f\u043e\u043b\u043d\u0435\u043d \u0443\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d\u043d\u044b\u0439 \u0448\u0430\u0431\u043b\u043e\u043d Word",
    "change_edit": "\u0412\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0430 \u0442\u043e\u0447\u0435\u0447\u043d\u0430\u044f \u043f\u0440\u0430\u0432\u043a\u0430 \u0442\u0435\u043a\u0441\u0442\u0430",
    "change_created": "\u0421\u043e\u0437\u0434\u0430\u043d \u043d\u043e\u0432\u044b\u0439 \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0435\u043c\u044b\u0439 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442",
    "change_pdf": "\u0421\u043e\u0437\u0434\u0430\u043d PDF \u0438\u0437 \u043f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u043d\u043e\u0433\u043e \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0435\u043c\u043e\u0433\u043e \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430",
}


def _issue(code: str, severity: str, message: str, target: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"code": code, "severity": severity, "message": message}
    if target:
        result["target"] = target
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _zip_part_sha256(archive: zipfile.ZipFile, name: str) -> str:
    digest = hashlib.sha256()
    with archive.open(name) as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _changed_package_parts(source: Path, output: Path) -> set[str]:
    with zipfile.ZipFile(source) as before, zipfile.ZipFile(output) as after:
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


def _web_source_url(value: Any) -> str:
    url = str(value or "")
    if not url.strip():
        return ""
    if any(
        character.isspace()
        or character == "\\"
        or ord(character) < 32
        or 127 <= ord(character) <= 159
        for character in url
    ):
        raise ValueError("sources[].url must not contain whitespace, control characters, or backslashes")
    try:
        parsed = urllib.parse.urlsplit(url)
        hostname = parsed.hostname
        parsed.port
    except ValueError as exc:
        raise ValueError("sources[].url must be a well-formed absolute HTTP(S) URL") from exc
    if parsed.scheme.lower() not in {"http", "https"} or not hostname:
        raise ValueError("sources[].url must be an absolute HTTP(S) URL with a host")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("sources[].url must not contain credentials")
    return url


def _validate_source_urls(spec: dict[str, Any]) -> None:
    sources = spec.get("sources") or []
    if not isinstance(sources, list):
        raise ValueError("sources must be an array")
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("sources must contain objects")
        _web_source_url(source.get("url"))


def _output_pdf_requested(spec: dict[str, Any]) -> bool:
    requested = spec.get("outputPdf", False)
    if not isinstance(requested, bool):
        raise ValueError("outputPdf must be true or false")
    return requested


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
    if raw["format"] != "docx":
        raise ValueError("ArtifactJob.format must be 'docx'")
    if Path(str(raw["filename"])).suffix.lower() != ".docx":
        raise ValueError("ArtifactJob.filename must end in .docx")
    if Path(str(raw["filename"])).name != output.name:
        raise ValueError("ArtifactJob.filename must match the output filename")
    if output.suffix.lower() != ".docx":
        raise ValueError("Output path must end in .docx")
    if not isinstance(raw["sourceFileIds"], list):
        raise ValueError("ArtifactJob.sourceFileIds must be an array")
    if not isinstance(raw["immutableElements"], list):
        raise ValueError("ArtifactJob.immutableElements must be an array")
    if not isinstance(raw["acceptanceCriteria"], list) or not raw["acceptanceCriteria"]:
        raise ValueError("ArtifactJob.acceptanceCriteria must be a non-empty array")
    repair_iterations = int(spec.get("repairIterations", 0))
    if not 0 <= repair_iterations <= MAX_REPAIR_ITERATIONS:
        raise ValueError("repairIterations must be between 0 and 2")

    input_path = spec.get("inputPath")
    template_path = spec.get("templatePath")
    if input_path and template_path:
        raise ValueError("Use inputPath or templatePath, not both")
    source_path = input_path or template_path
    if source_path:
        source = Path(str(source_path))
        if source.suffix.lower() != ".docx" or not source.is_file():
            raise ValueError("Input/template path must point to an existing .docx")
        if source.resolve() == output.resolve():
            raise ValueError("Input/template and output paths must differ")

    mode_count = sum(
        bool(value)
        for value in (
            spec.get("sections"),
            spec.get("placeholders"),
            spec.get("edits"),
        )
    )
    if not source_path and not spec.get("sections"):
        raise ValueError("New documents require sections")
    if input_path and not spec.get("edits"):
        raise ValueError("inputPath requires edits")
    if template_path and not spec.get("placeholders"):
        raise ValueError("templatePath requires placeholders")
    if source_path and mode_count != 1:
        raise ValueError("Template/edit modes cannot be combined with other authoring modes")
    _validate_source_urls(spec)
    _output_pdf_requested(spec)
    return raw


def _set_run_font(run, name: str, size: float | None = None, color: str | None = None) -> None:
    run.font.name = name
    if run._element.rPr is None:
        run._element.get_or_add_rPr()
    fonts = run._element.rPr.get_or_add_rFonts()
    for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(f"w:{attr}"), name)
    if size is not None:
        run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = RGBColor.from_string(color)


def _set_style_font(style, name: str, size: float, color: str = COLORS["ink"], bold: bool = False) -> None:
    style.font.name = name
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.color.rgb = RGBColor.from_string(color)
    rpr = style.element.get_or_add_rPr()
    fonts = rpr.get_or_add_rFonts()
    for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(f"w:{attr}"), name)
    lang = rpr.find(qn("w:lang"))
    if lang is None:
        lang = OxmlElement("w:lang")
        rpr.append(lang)
    lang.set(qn("w:val"), "ru-RU")
    lang.set(qn("w:eastAsia"), "ru-RU")


def _get_or_add_style(document: DocumentObject, name: str, style_type: WD_STYLE_TYPE):
    try:
        return document.styles[name]
    except KeyError:
        return document.styles.add_style(name, style_type)


def _configure_styles(document: DocumentObject, font_name: str) -> None:
    if font_name not in ALLOWED_FONTS:
        raise ValueError("theme.font must be Arial, Calibri, PT Sans, or Liberation Sans")

    normal = document.styles["Normal"]
    _set_style_font(normal, font_name, 10.5)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.15

    title = document.styles["Title"]
    _set_style_font(title, font_name, 26, COLORS["ink"], True)
    title.paragraph_format.space_before = Pt(0)
    title.paragraph_format.space_after = Pt(8)
    title.paragraph_format.keep_with_next = True

    subtitle = document.styles["Subtitle"]
    _set_style_font(subtitle, font_name, 13, COLORS["muted"])
    subtitle.paragraph_format.space_before = Pt(0)
    subtitle.paragraph_format.space_after = Pt(16)
    subtitle.paragraph_format.keep_with_next = True

    heading_tokens = {
        "Heading 1": (16, COLORS["accent_dark"], 16, 7),
        "Heading 2": (13, COLORS["accent"], 12, 5),
        "Heading 3": (11.5, COLORS["accent_dark"], 9, 4),
    }
    for name, (size, color, before, after) in heading_tokens.items():
        style = document.styles[name]
        _set_style_font(style, font_name, size, color, True)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.keep_together = True

    for style_name, size, color, bold in (
        ("Document Kicker", 9, COLORS["accent"], True),
        ("Document Metadata", 9.5, COLORS["muted"], False),
        ("Document Callout", 10.5, COLORS["ink"], False),
        ("Document Source", 8.5, COLORS["muted"], False),
    ):
        style = _get_or_add_style(document, style_name, WD_STYLE_TYPE.PARAGRAPH)
        _set_style_font(style, font_name, size, color, bold)
        style.paragraph_format.space_before = Pt(0)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.line_spacing = 1.1


def _configure_page(document: DocumentObject) -> None:
    for section in document.sections:
        section.page_width = Cm(21)
        section.page_height = Cm(29.7)
        section.top_margin = Cm(2)
        section.right_margin = Cm(2)
        section.bottom_margin = Cm(2)
        section.left_margin = Cm(2)
        section.header_distance = Cm(1)
        section.footer_distance = Cm(1)


def _paragraph_shading(paragraph: Paragraph, fill: str) -> None:
    ppr = paragraph._p.get_or_add_pPr()
    shading = ppr.find(qn("w:shd"))
    if shading is None:
        shading = OxmlElement("w:shd")
        ppr.append(shading)
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:color"), "auto")
    shading.set(qn("w:fill"), fill)


def _paragraph_left_border(paragraph: Paragraph, color: str) -> None:
    ppr = paragraph._p.get_or_add_pPr()
    borders = ppr.find(qn("w:pBdr"))
    if borders is None:
        borders = OxmlElement("w:pBdr")
        ppr.append(borders)
    left = borders.find(qn("w:left"))
    if left is None:
        left = OxmlElement("w:left")
        borders.append(left)
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), "18")
    left.set(qn("w:space"), "8")
    left.set(qn("w:color"), color)


def _add_field(paragraph: Paragraph, instruction: str, display: str) -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = display
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for element in (begin, instr, separate, text, end):
        run._r.append(element)


def _configure_header_footer(
    document: DocumentObject,
    short_title: str,
    font_name: str,
    locale: str,
) -> None:
    is_russian = locale.lower().startswith("ru")
    for section in document.sections:
        header = section.header
        paragraph = header.paragraphs[0]
        paragraph.text = short_title[:90]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        paragraph.paragraph_format.space_after = Pt(0)
        for run in paragraph.runs:
            _set_run_font(run, font_name, 8.5, COLORS["muted"])

        footer = section.footer
        paragraph = footer.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        lead = paragraph.add_run(RU_LABELS["page"] if is_russian else "Page ")
        _set_run_font(lead, font_name, 8.5, COLORS["muted"])
        _add_field(paragraph, " PAGE ", "1")
        middle = paragraph.add_run(RU_LABELS["of"] if is_russian else " of ")
        _set_run_font(middle, font_name, 8.5, COLORS["muted"])
        _add_field(paragraph, " NUMPAGES ", "1")


def _next_numbering_id(numbering, tag: str, attr: str) -> int:
    values = [int(node.get(qn(attr))) for node in numbering.findall(qn(tag))]
    return max(values, default=0) + 1


def _add_numbering(document: DocumentObject, kind: str, font_name: str) -> int:
    numbering = document.part.numbering_part.element
    abstract_id = _next_numbering_id(numbering, "w:abstractNum", "w:abstractNumId")
    num_id = _next_numbering_id(numbering, "w:num", "w:numId")

    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    multi = OxmlElement("w:multiLevelType")
    multi.set(qn("w:val"), "multilevel")
    abstract.append(multi)

    markers = ["•", "◦", "▪"]
    for level in range(3):
        lvl = OxmlElement("w:lvl")
        lvl.set(qn("w:ilvl"), str(level))
        start = OxmlElement("w:start")
        start.set(qn("w:val"), "1")
        num_fmt = OxmlElement("w:numFmt")
        num_fmt.set(qn("w:val"), "bullet" if kind == "bullet" else "decimal")
        lvl_text = OxmlElement("w:lvlText")
        lvl_text.set(qn("w:val"), markers[level] if kind == "bullet" else f"%{level + 1}.")
        align = OxmlElement("w:lvlJc")
        align.set(qn("w:val"), "left")
        ppr = OxmlElement("w:pPr")
        tabs = OxmlElement("w:tabs")
        tab = OxmlElement("w:tab")
        tab.set(qn("w:val"), "num")
        tab.set(qn("w:pos"), str(720 * (level + 1)))
        tabs.append(tab)
        indent = OxmlElement("w:ind")
        indent.set(qn("w:left"), str(720 * (level + 1)))
        indent.set(qn("w:hanging"), "360")
        ppr.append(tabs)
        ppr.append(indent)
        rpr = OxmlElement("w:rPr")
        fonts = OxmlElement("w:rFonts")
        fonts.set(qn("w:ascii"), font_name)
        fonts.set(qn("w:hAnsi"), font_name)
        rpr.append(fonts)
        for element in (start, num_fmt, lvl_text, align, ppr, rpr):
            lvl.append(element)
        abstract.append(lvl)
    numbering.append(abstract)

    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    abstract_ref = OxmlElement("w:abstractNumId")
    abstract_ref.set(qn("w:val"), str(abstract_id))
    num.append(abstract_ref)
    numbering.append(num)
    return num_id


def _apply_numbering(paragraph: Paragraph, num_id: int, level: int) -> None:
    ppr = paragraph._p.get_or_add_pPr()
    num_pr = ppr.find(qn("w:numPr"))
    if num_pr is None:
        num_pr = OxmlElement("w:numPr")
        ppr.append(num_pr)
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), str(level))
    num = OxmlElement("w:numId")
    num.set(qn("w:val"), str(num_id))
    num_pr.append(ilvl)
    num_pr.append(num)
    paragraph.paragraph_format.left_indent = None
    paragraph.paragraph_format.first_line_indent = None
    paragraph.paragraph_format.space_after = Pt(4)
    paragraph.paragraph_format.line_spacing = 1.15


def _set_repeat_table_header(row) -> None:
    trpr = row._tr.get_or_add_trPr()
    header = trpr.find(qn("w:tblHeader"))
    if header is None:
        header = OxmlElement("w:tblHeader")
        trpr.append(header)
    header.set(qn("w:val"), "true")


def _set_cell_margins(cell: _Cell, top: int = 90, start: int = 120, bottom: int = 90, end: int = 120) -> None:
    tc = cell._tc
    tcpr = tc.get_or_add_tcPr()
    margins = tcpr.first_child_found_in("w:tcMar")
    if margins is None:
        margins = OxmlElement("w:tcMar")
        tcpr.append(margins)
    for edge, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        element = margins.find(qn(f"w:{edge}"))
        if element is None:
            element = OxmlElement(f"w:{edge}")
            margins.append(element)
        element.set(qn("w:w"), str(value))
        element.set(qn("w:type"), "dxa")


def _set_cell_shading(cell: _Cell, fill: str) -> None:
    tcpr = cell._tc.get_or_add_tcPr()
    shading = tcpr.find(qn("w:shd"))
    if shading is None:
        shading = OxmlElement("w:shd")
        tcpr.append(shading)
    shading.set(qn("w:fill"), fill)


def _set_cell_width(cell: _Cell, width: int) -> None:
    tcpr = cell._tc.get_or_add_tcPr()
    tcw = tcpr.find(qn("w:tcW"))
    if tcw is None:
        tcw = OxmlElement("w:tcW")
        tcpr.append(tcw)
    tcw.set(qn("w:w"), str(width))
    tcw.set(qn("w:type"), "dxa")


def _set_table_geometry(table: Table, widths: list[int]) -> None:
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    tblpr = table._tbl.tblPr
    layout = tblpr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tblpr.append(layout)
    layout.set(qn("w:type"), "fixed")
    table_width = tblpr.find(qn("w:tblW"))
    if table_width is None:
        table_width = OxmlElement("w:tblW")
        tblpr.append(table_width)
    table_width.set(qn("w:w"), str(sum(widths)))
    table_width.set(qn("w:type"), "dxa")
    indent = tblpr.find(qn("w:tblInd"))
    if indent is None:
        indent = OxmlElement("w:tblInd")
        tblpr.append(indent)
    indent.set(qn("w:w"), "0")
    indent.set(qn("w:type"), "dxa")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths:
        column = OxmlElement("w:gridCol")
        column.set(qn("w:w"), str(width))
        grid.append(column)
    for row in table.rows:
        cannot_split = row._tr.get_or_add_trPr().find(qn("w:cantSplit"))
        if cannot_split is None:
            cannot_split = OxmlElement("w:cantSplit")
            row._tr.get_or_add_trPr().append(cannot_split)
        for index, cell in enumerate(row.cells):
            _set_cell_width(cell, widths[index])
            _set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def _column_widths(raw: Any, count: int) -> list[int]:
    if not raw:
        weights = [1.0] * count
    else:
        if not isinstance(raw, list) or len(raw) != count:
            raise ValueError("table.widths must contain one value per column")
        weights = [float(value) for value in raw]
        if any(value <= 0 for value in weights):
            raise ValueError("table.widths must contain positive values")
    total = sum(weights)
    widths = [round(PAGE_WIDTH_DXA * value / total) for value in weights]
    widths[-1] += PAGE_WIDTH_DXA - sum(widths)
    return widths


def _add_hyperlink(paragraph: Paragraph, text: str, url: str, font_name: str) -> None:
    relationship_id = paragraph.part.relate_to(
        url,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relationship_id)
    run = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), COLORS["accent"])
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    fonts = OxmlElement("w:rFonts")
    fonts.set(qn("w:ascii"), font_name)
    fonts.set(qn("w:hAnsi"), font_name)
    rpr.extend([fonts, color, underline])
    text_element = OxmlElement("w:t")
    text_element.text = text
    run.extend([rpr, text_element])
    hyperlink.append(run)
    paragraph._p.append(hyperlink)


def _add_opening(document: DocumentObject, spec: dict[str, Any], font_name: str) -> None:
    document_type = str(spec.get("documentType", "report")).lower()
    if document_type not in {"memo", "report", "sop"}:
        raise ValueError("documentType must be memo, report, or sop")
    locale = str(spec.get("job", {}).get("locale", "ru-RU"))
    labels = (
        {key: RU_LABELS[key] for key in ("memo", "report", "sop")}
        if locale.lower().startswith("ru")
        else {"memo": "DECISION MEMO", "report": "BUSINESS REPORT", "sop": "STANDARD OPERATING PROCEDURE"}
    )
    kicker = document.add_paragraph(labels[document_type], style="Document Kicker")
    kicker.paragraph_format.space_after = Pt(5)
    title = str(spec.get("title", "")).strip()
    if not title:
        raise ValueError("New documents require a title")
    document.add_paragraph(title, style="Title")
    subtitle = str(spec.get("subtitle", "")).strip()
    if subtitle:
        document.add_paragraph(subtitle, style="Subtitle")
    for item in spec.get("metadata", []):
        if not isinstance(item, dict):
            raise ValueError("metadata entries must be objects")
        label = str(item.get("label", "")).strip()
        value = str(item.get("value", "")).strip()
        if not label or not value:
            raise ValueError("metadata entries require label and value")
        paragraph = document.add_paragraph(style="Document Metadata")
        label_run = paragraph.add_run(f"{label}: ")
        _set_run_font(label_run, font_name, 9.5, COLORS["ink"])
        label_run.bold = True
        value_run = paragraph.add_run(value)
        _set_run_font(value_run, font_name, 9.5, COLORS["muted"])
    if spec.get("metadata"):
        spacer = document.add_paragraph()
        spacer.paragraph_format.space_after = Pt(4)


def _list_item(item: Any) -> tuple[str, int]:
    if isinstance(item, str):
        return item, 0
    if not isinstance(item, dict):
        raise ValueError("list items must be strings or objects")
    text = str(item.get("text", "")).strip()
    level = int(item.get("level", 0))
    if not text or not 0 <= level <= 2:
        raise ValueError("list item text is required and level must be 0..2")
    return text, level


def _add_table(document: DocumentObject, block: dict[str, Any], font_name: str) -> None:
    columns = block.get("columns") or []
    rows = block.get("rows") or []
    if not isinstance(columns, list) or not columns or len(columns) > 6:
        raise ValueError("table.columns must contain 1..6 values")
    if not isinstance(rows, list):
        raise ValueError("table.rows must be an array")
    for row in rows:
        if not isinstance(row, list) or len(row) != len(columns):
            raise ValueError("every table row must match the column count")
    widths = _column_widths(block.get("widths"), len(columns))
    table = document.add_table(rows=len(rows) + 1, cols=len(columns))
    _set_table_geometry(table, widths)
    _set_repeat_table_header(table.rows[0])
    for column, value in enumerate(columns):
        cell = table.cell(0, column)
        cell.text = str(value)
        _set_cell_shading(cell, COLORS["table_header"])
        for paragraph in cell.paragraphs:
            paragraph.paragraph_format.space_after = Pt(0)
            for run in paragraph.runs:
                _set_run_font(run, font_name, 9, COLORS["accent_dark"])
                run.bold = True
    for row_index, row in enumerate(rows, start=1):
        for column, value in enumerate(row):
            cell = table.cell(row_index, column)
            cell.text = str(value)
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.line_spacing = 1.05
                for run in paragraph.runs:
                    _set_run_font(run, font_name, 9, COLORS["ink"])
    source = str(block.get("source", "")).strip()
    if source:
        source_paragraph = document.add_paragraph(source, style="Document Source")
        source_paragraph.paragraph_format.space_before = Pt(3)
        source_paragraph.paragraph_format.space_after = Pt(8)
    else:
        document.add_paragraph().paragraph_format.space_after = Pt(3)


def _add_block(
    document: DocumentObject,
    block: dict[str, Any],
    font_name: str,
) -> None:
    block_type = str(block.get("type", "paragraph")).lower()
    if block_type == "paragraph":
        text = str(block.get("text", "")).strip()
        if not text:
            raise ValueError("paragraph blocks require text")
        paragraph = document.add_paragraph()
        bold_lead = str(block.get("boldLead", "")).strip()
        if bold_lead:
            lead = paragraph.add_run(f"{bold_lead} ")
            lead.bold = True
            _set_run_font(lead, font_name)
        run = paragraph.add_run(text)
        _set_run_font(run, font_name)
        return
    if block_type in {"bullets", "numbered"}:
        items = block.get("items") or []
        if not isinstance(items, list) or not items:
            raise ValueError(f"{block_type} blocks require items")
        num_id = _add_numbering(document, "bullet" if block_type == "bullets" else "decimal", font_name)
        keep_group = len(items) <= 6
        for index, item in enumerate(items):
            text, level = _list_item(item)
            paragraph = document.add_paragraph(text)
            _apply_numbering(paragraph, num_id, level)
            paragraph.paragraph_format.keep_with_next = keep_group and index < len(items) - 1
            paragraph.paragraph_format.keep_together = True
            for run in paragraph.runs:
                _set_run_font(run, font_name)
        return
    if block_type == "callout":
        text = str(block.get("text", "")).strip()
        if not text:
            raise ValueError("callout blocks require text")
        paragraph = document.add_paragraph(style="Document Callout")
        label = str(block.get("label", "")).strip()
        if label:
            lead = paragraph.add_run(f"{label}. ")
            lead.bold = True
            _set_run_font(lead, font_name, 10.5, COLORS["accent_dark"])
        body = paragraph.add_run(text)
        _set_run_font(body, font_name, 10.5, COLORS["ink"])
        paragraph.paragraph_format.left_indent = Cm(0.3)
        paragraph.paragraph_format.right_indent = Cm(0.2)
        paragraph.paragraph_format.space_before = Pt(4)
        paragraph.paragraph_format.space_after = Pt(9)
        _paragraph_shading(paragraph, COLORS["surface"])
        _paragraph_left_border(paragraph, COLORS["accent"])
        return
    if block_type == "table":
        _add_table(document, block, font_name)
        return
    if block_type == "page_break":
        document.add_page_break()
        return
    raise ValueError(f"unsupported block type: {block_type}")


def _add_sections(document: DocumentObject, spec: dict[str, Any], font_name: str) -> None:
    locale = str(spec.get("job", {}).get("locale", "ru-RU"))
    is_russian = locale.lower().startswith("ru")
    for section in spec.get("sections", []):
        if not isinstance(section, dict):
            raise ValueError("sections must contain objects")
        heading = str(section.get("heading", "")).strip()
        level = int(section.get("level", 1))
        if not heading or not 1 <= level <= 3:
            raise ValueError("sections require a heading and level 1..3")
        document.add_paragraph(heading, style=f"Heading {level}")
        blocks = section.get("blocks") or []
        if not isinstance(blocks, list) or not blocks:
            raise ValueError("sections require at least one block")
        for block in blocks:
            if not isinstance(block, dict):
                raise ValueError("section blocks must be objects")
            _add_block(document, block, font_name)

    assumptions = spec.get("assumptions") or []
    if assumptions:
        document.add_paragraph(RU_LABELS["assumptions"] if is_russian else "Assumptions", style="Heading 1")
        assumptions_num_id = _add_numbering(document, "bullet", font_name)
        for index, assumption in enumerate(assumptions):
            paragraph = document.add_paragraph(str(assumption))
            _apply_numbering(paragraph, assumptions_num_id, 0)
            paragraph.paragraph_format.keep_with_next = index < len(assumptions) - 1
            paragraph.paragraph_format.keep_together = True
            for run in paragraph.runs:
                _set_run_font(run, font_name)

    sources = spec.get("sources") or []
    if sources:
        document.add_paragraph(RU_LABELS["sources"] if is_russian else "Sources", style="Heading 1")
        sources_num_id = _add_numbering(document, "decimal", font_name)
        for index, source in enumerate(sources):
            if not isinstance(source, dict) or not str(source.get("label", "")).strip():
                raise ValueError("sources require a label")
            paragraph = document.add_paragraph()
            _apply_numbering(paragraph, sources_num_id, 0)
            paragraph.paragraph_format.keep_with_next = index < len(sources) - 1
            paragraph.paragraph_format.keep_together = True
            label = str(source["label"]).strip()
            location = str(source.get("location", "")).strip()
            url = _web_source_url(source.get("url"))
            accessed = str(source.get("accessed", "")).strip()
            lead = paragraph.add_run(label)
            lead.bold = True
            _set_run_font(lead, font_name)
            if location:
                run = paragraph.add_run(f" — {location}")
                _set_run_font(run, font_name)
            if url:
                paragraph.add_run(" — ")
                _add_hyperlink(paragraph, url, url, font_name)
            if accessed:
                accessed_label = RU_LABELS["accessed"] if is_russian else "accessed"
                run = paragraph.add_run(f" ({accessed_label}: {accessed})")
                _set_run_font(run, font_name, 9, COLORS["muted"])


def _part_name(paragraph: Paragraph) -> str:
    return str(paragraph.part.partname).lstrip("/")


def _iter_cell_paragraphs(cell: _Cell) -> Iterator[Paragraph]:
    for paragraph in cell.paragraphs:
        yield paragraph
    for table in cell.tables:
        for row in table.rows:
            for nested in row.cells:
                yield from _iter_cell_paragraphs(nested)


def _iter_story_paragraphs(document: DocumentObject) -> Iterator[Paragraph]:
    seen: set[int] = set()

    def emit(paragraphs: Iterable[Paragraph]) -> Iterator[Paragraph]:
        for paragraph in paragraphs:
            key = id(paragraph._p)
            if key not in seen:
                seen.add(key)
                yield paragraph

    yield from emit(document.paragraphs)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from emit(_iter_cell_paragraphs(cell))
    # Accessing section.header/footer properties can create missing relationship
    # parts as a side effect. A targeted edit must not rewrite package topology,
    # so inspect only header/footer parts that already exist in the source.
    class _PartParent:
        def __init__(self, part):
            self.part = part

    seen_parts: set[str] = set()
    for part in document.part.related_parts.values():
        part_name = str(getattr(part, "partname", ""))
        if part_name in seen_parts or not re.fullmatch(r"/word/(?:header|footer)\d+\.xml", part_name):
            continue
        seen_parts.add(part_name)
        parent = _PartParent(part)
        paragraphs = (Paragraph(node, parent) for node in part.element.xpath(".//w:p"))
        yield from emit(paragraphs)


def _find_offsets(text: str, needle: str) -> list[int]:
    offsets: list[int] = []
    start = 0
    while True:
        index = text.find(needle, start)
        if index < 0:
            return offsets
        offsets.append(index)
        start = index + len(needle)


def _replace_run_range(paragraph: Paragraph, old: str, new: str, occurrence: int) -> bool:
    runs = list(paragraph.runs)
    full_text = "".join(run.text for run in runs)
    offsets = _find_offsets(full_text, old)
    if occurrence >= len(offsets):
        return False
    start = offsets[occurrence]
    end = start + len(old)
    positions: list[tuple[int, int]] = []
    cursor = 0
    for run in runs:
        positions.append((cursor, cursor + len(run.text)))
        cursor += len(run.text)
    start_run = next(index for index, (_, finish) in enumerate(positions) if finish > start)
    end_run = next(index for index, (_, finish) in enumerate(positions) if finish >= end)
    start_offset = start - positions[start_run][0]
    end_offset = end - positions[end_run][0]
    if start_run == end_run:
        text = runs[start_run].text
        runs[start_run].text = text[:start_offset] + new + text[end_offset:]
        return True
    runs[start_run].text = runs[start_run].text[:start_offset] + new
    for index in range(start_run + 1, end_run):
        runs[index].text = ""
    runs[end_run].text = runs[end_run].text[end_offset:]
    return True


def _replace_everywhere(
    document: DocumentObject,
    old: str,
    new: str,
    require_single: bool,
) -> tuple[int, set[str]]:
    if not old:
        raise ValueError("replacement old text must not be empty")
    paragraphs = list(_iter_story_paragraphs(document))
    matches = [(paragraph, len(_find_offsets("".join(run.text for run in paragraph.runs), old))) for paragraph in paragraphs]
    total = sum(count for _, count in matches)
    if total == 0:
        raise ValueError(f"text to replace was not found: {old!r}")
    if require_single and total != 1:
        raise ValueError(f"text to replace must occur exactly once, found {total}: {old!r}")
    changed_parts: set[str] = set()
    for paragraph, count in matches:
        for occurrence in range(count - 1, -1, -1):
            if _replace_run_range(paragraph, old, new, occurrence):
                changed_parts.add(_part_name(paragraph))
    return total, changed_parts


def _build(spec: dict[str, Any], output: Path) -> tuple[DocumentObject, list[dict[str, str]], set[str]]:
    input_path = spec.get("inputPath")
    template_path = spec.get("templatePath")
    source_path = input_path or template_path
    changes = list(spec.get("changeLog", []))
    is_russian = str(spec.get("job", {}).get("locale", "ru-RU")).lower().startswith("ru")
    changed_parts: set[str] = set()
    if source_path:
        document = Document(str(source_path))
        if template_path:
            placeholders = spec.get("placeholders") or {}
            if not isinstance(placeholders, dict):
                raise ValueError("placeholders must be an object")
            for token, value in placeholders.items():
                _, parts = _replace_everywhere(document, str(token), str(value), require_single=False)
                changed_parts.update(parts)
            changes.append(
                {
                    "target": "Template placeholders",
                    "summary": RU_LABELS["change_template"] if is_russian else "Filled the supplied Word template",
                }
            )
        else:
            for edit in spec.get("edits", []):
                if not isinstance(edit, dict):
                    raise ValueError("edits must contain objects")
                old = str(edit.get("oldText", ""))
                new = str(edit.get("newText", ""))
                _, parts = _replace_everywhere(document, old, new, require_single=not bool(edit.get("all", False)))
                changed_parts.update(parts)
                changes.append(
                    {
                        "target": ", ".join(sorted(parts)) or "Document",
                        "summary": str(
                            edit.get(
                                "summary",
                                RU_LABELS["change_edit"] if is_russian else "Applied a targeted text revision",
                            )
                        ),
                    }
                )
        document.save(str(output))
        return document, changes, changed_parts

    document = Document()
    font_name = str((spec.get("theme") or {}).get("font", DEFAULT_FONT)).strip()
    _configure_page(document)
    _configure_styles(document, font_name)
    title = str(spec.get("title", "")).strip()
    locale = str(spec.get("job", {}).get("locale", "ru-RU"))
    _configure_header_footer(document, title, font_name, locale)
    _add_opening(document, spec, font_name)
    _add_sections(document, spec, font_name)
    document.core_properties.title = title
    document.core_properties.subject = str(spec.get("job", {}).get("goal", ""))
    document.core_properties.comments = f"Generated by docx skill {SKILL_VERSION}; inputs treated as immutable."
    document.save(str(output))
    if not changes:
        changes.append(
            {
                "target": "Document",
                "summary": (
                    RU_LABELS["change_created"]
                    if is_russian
                    else f"Created a professional {spec.get('documentType', 'report')}"
                ),
            }
        )
    return document, changes, changed_parts


def _bare_domain_sources(spec: dict[str, Any]) -> list[str]:
    bare: list[str] = []
    for source in spec.get("sources", []):
        url = _web_source_url(source.get("url")) if isinstance(source, dict) else ""
        if not url:
            continue
        parsed = urllib.parse.urlsplit(url)
        if (parsed.path in {"", "/"}) and not parsed.query and not parsed.fragment:
            bare.append(url)
    return bare


def _table_geometry_issues(document: DocumentObject) -> list[str]:
    problems: list[str] = []
    for index, table in enumerate(document.tables, start=1):
        tblpr = table._tbl.tblPr
        tblw = tblpr.find(qn("w:tblW"))
        layout = tblpr.find(qn("w:tblLayout"))
        grid = table._tbl.tblGrid
        grid_widths = [int(column.get(qn("w:w"), "0")) for column in grid.findall(qn("w:gridCol"))]
        expected = int(tblw.get(qn("w:w"), "0")) if tblw is not None else 0
        if tblw is None or tblw.get(qn("w:type")) != "dxa" or expected <= 0:
            problems.append(f"table {index} has no fixed DXA width")
        if layout is None or layout.get(qn("w:type")) != "fixed":
            problems.append(f"table {index} does not use fixed layout")
        if not grid_widths or sum(grid_widths) != expected:
            problems.append(f"table {index} grid width does not match table width")
        for row in table.rows:
            heights = row._tr.get_or_add_trPr().findall(qn("w:trHeight"))
            if any(height.get(qn("w:hRule")) == "exact" for height in heights):
                problems.append(f"table {index} contains an exact row height")
            widths = []
            for cell in row.cells:
                tcw = cell._tc.get_or_add_tcPr().find(qn("w:tcW"))
                widths.append(int(tcw.get(qn("w:w"), "0")) if tcw is not None else 0)
            if widths != grid_widths:
                problems.append(f"table {index} cell widths do not match its grid")
                break
    return problems


def _style_ids(path: Path) -> set[str]:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/styles.xml")
    tree = etree.fromstring(xml)
    return {str(node.get(qn("w:styleId"))) for node in tree.findall(qn("w:style"))}


def _section_geometry(document: DocumentObject) -> list[tuple[int, ...]]:
    return [
        (
            int(section.page_width or 0),
            int(section.page_height or 0),
            int(section.top_margin or 0),
            int(section.right_margin or 0),
            int(section.bottom_margin or 0),
            int(section.left_margin or 0),
        )
        for section in document.sections
    ]


def _check_structure(
    path: Path,
    spec: dict[str, Any],
    requested_changed_parts: set[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    checks: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError("duplicate OPC package part names")
            if "word/document.xml" not in names or "[Content_Types].xml" not in names:
                raise ValueError("required DOCX package parts are missing")
        document = Document(str(path))
        checks.append({"name": "reopen", "status": "passed", "message": "DOCX reopens successfully"})
    except Exception as exc:
        return (
            [{"name": "reopen", "status": "failed", "message": str(exc)}],
            [_issue("docx-reopen", "critical", str(exc))],
        )

    all_paragraphs = list(_iter_story_paragraphs(document))
    text = "\n".join(paragraph.text for paragraph in all_paragraphs)
    unresolved = sorted(set(re.findall(r"\{\{[^{}]+\}\}", text)))
    checks.append(
        {
            "name": "placeholders",
            "status": "failed" if unresolved else "passed",
            "message": f"Unresolved placeholders: {', '.join(unresolved)}" if unresolved else "No unresolved placeholders",
        }
    )
    if unresolved:
        issues.append(_issue("unresolved-placeholder", "critical", "The document still contains template placeholders"))

    fake_lists = [
        paragraph.text[:70]
        for paragraph in all_paragraphs
        if re.match(r"^\s*(?:[-*•◦▪]|\d+[.)])\s+", paragraph.text)
        and paragraph._p.get_or_add_pPr().find(qn("w:numPr")) is None
    ]
    checks.append(
        {
            "name": "semantic-lists",
            "status": "failed" if fake_lists else "passed",
            "message": f"Found {len(fake_lists)} fake list paragraphs" if fake_lists else "Lists use Word numbering definitions",
        }
    )
    if fake_lists:
        issues.append(_issue("fake-list", "critical", "One or more lists are plain text instead of editable Word lists"))

    source_mode = bool(spec.get("inputPath") or spec.get("templatePath"))
    geometry_problems = [] if source_mode else _table_geometry_issues(document)
    checks.append(
        {
            "name": "table-geometry",
            "status": "failed" if geometry_problems else "passed",
            "message": (
                "Source table geometry is preserved"
                if source_mode
                else "; ".join(geometry_problems)
                if geometry_problems
                else "Tables use fixed matching DXA geometry without clipping-prone row heights"
            ),
        }
    )
    if geometry_problems:
        issues.append(_issue("table-geometry", "critical", "One or more tables have unstable or clipping-prone geometry"))

    footer_xml = " ".join(
        " ".join(node.text or "" for node in section.footer._element.iter())
        for section in document.sections
    )
    page_fields = "PAGE" in footer_xml and "NUMPAGES" in footer_xml
    if not spec.get("inputPath") and not spec.get("templatePath"):
        checks.append(
            {
                "name": "page-fields",
                "status": "passed" if page_fields else "failed",
                "message": "Footer contains PAGE and NUMPAGES fields" if page_fields else "Page number fields are missing",
            }
        )
        if not page_fields:
            issues.append(_issue("page-fields", "critical", "Generated document has no live page number fields"))

    if spec.get("sources"):
        present = "sources" in text.lower() or RU_LABELS["source_stem"] in text.lower()
        checks.append(
            {
                "name": "sources",
                "status": "passed" if present else "failed",
                "message": "Sources section is present" if present else "Sources were supplied but are not visible",
            }
        )
        if not present:
            issues.append(_issue("missing-sources", "critical", "Supplied sources are not traceable in the document"))
        bare = _bare_domain_sources(spec)
        checks.append(
            {
                "name": "source-specificity",
                "status": "failed" if bare else "passed",
                "message": "Every web source points to a specific page" if not bare else "Sources use a site homepage: " + ", ".join(bare),
            }
        )
        if bare:
            issues.append(_issue("unspecific-source", "critical", "A web source points only to a site homepage"))

    source_path = spec.get("inputPath") or spec.get("templatePath")
    if source_path and spec.get("templatePath"):
        source_document = Document(str(source_path))
        styles_preserved = _style_ids(Path(source_path)).issubset(_style_ids(path))
        geometry_preserved = _section_geometry(source_document) == _section_geometry(document)
        preserved = styles_preserved and geometry_preserved
        checks.append(
            {
                "name": "template-preservation",
                "status": "passed" if preserved else "failed",
                "message": "Template styles and section geometry are preserved" if preserved else "Template styles or section geometry changed",
            }
        )
        if not preserved:
            issues.append(_issue("template-damaged", "critical", "Template styles or page geometry changed"))

    if source_path and spec.get("inputPath"):
        try:
            changed = _changed_package_parts(Path(source_path), path)
            unexpected = sorted(changed - requested_changed_parts)
            scoped = not unexpected and bool(changed)
            message = (
                "Only requested Word parts changed"
                if scoped
                else "Unexpected package parts changed: " + ", ".join(unexpected)
                if unexpected
                else "No package part changed"
            )
        except Exception as exc:
            scoped = False
            message = f"Could not verify targeted edit scope ({type(exc).__name__})"
        checks.append({"name": "targeted-edit-scope", "status": "passed" if scoped else "failed", "message": message})
        if not scoped:
            issues.append(_issue("edit-scope", "critical", "Targeted revision changed content outside the requested Word parts"))

    return checks, issues


def _pdf_page_count(pdf: Path) -> int | None:
    binary = shutil.which("pdfinfo")
    if not binary:
        return None
    result = subprocess.run([binary, str(pdf)], capture_output=True, text=True, timeout=15, check=False)
    match = re.search(r"^Pages:\s+(\d+)", result.stdout, flags=re.MULTILINE)
    return int(match.group(1)) if match else None


def _render(
    path: Path,
    keep_pdf: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Path | None]:
    checks: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        checks.append({"name": "render", "status": "failed", "message": "LibreOffice is unavailable"})
        issues.append(_issue("render-unavailable", "critical", "LibreOffice render could not run"))
        return checks, issues, None
    render_dir = Path(tempfile.mkdtemp(prefix="docx-qa-"))
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
        result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
        pdf = render_dir / f"{path.stem}.pdf"
        if result.returncode != 0 or not pdf.exists() or pdf.stat().st_size == 0:
            message = (result.stderr or result.stdout or "LibreOffice did not create a PDF").strip()[-400:]
            checks.append({"name": "render", "status": "failed", "message": message})
            issues.append(_issue("render-failed", "critical", "LibreOffice could not render the document"))
            return checks, issues, None
        page_count = _pdf_page_count(pdf)
        checks.append(
            {
                "name": "render",
                "status": "passed",
                "message": f"LibreOffice rendered {page_count} pages" if page_count else "LibreOffice rendered the document",
            }
        )

        raster = shutil.which("pdftoppm")
        if raster:
            prefix = render_dir / "page"
            raster_result = subprocess.run(
                [raster, "-png", "-r", "120", str(pdf), str(prefix)],
                capture_output=True,
                text=True,
                timeout=90,
                check=False,
            )
            images = sorted(render_dir.glob("page-*.png"))
            if raster_result.returncode == 0 and images:
                from PIL import Image

                blank_pages: list[int] = []
                edge_risks: list[int] = []
                image_hashes: list[str] = []
                for page_number, image_path in enumerate(images, start=1):
                    with Image.open(image_path) as source:
                        gray = source.convert("L")
                        width, height = gray.size
                        body = gray.crop((int(width * 0.04), int(height * 0.06), int(width * 0.96), int(height * 0.90)))
                        histogram = body.histogram()
                        ink_ratio = sum(histogram[:245]) / max(body.width * body.height, 1)
                        if ink_ratio < 0.0005:
                            blank_pages.append(page_number)
                        edge = gray.crop((0, 0, width, 3))
                        if sum(edge.histogram()[:225]) > max(4, width // 80):
                            edge_risks.append(page_number)
                        image_hashes.append(hashlib.sha256(gray.tobytes()).hexdigest())
                wrong_count = page_count is not None and len(images) != page_count
                failed = bool(blank_pages or wrong_count)
                message = (
                    f"Rendered {len(images)} of {page_count} expected pages"
                    if wrong_count
                    else f"Blank rendered pages: {blank_pages}"
                    if blank_pages
                    else f"Raster-checked {len(images)} rendered pages"
                )
                checks.append(
                    {
                        "name": "visual-raster",
                        "status": "failed" if failed else "warning" if edge_risks else "passed",
                        "message": message,
                        "details": {"pageCount": len(images), "imageHashes": image_hashes, "edgeRisks": edge_risks},
                    }
                )
                if blank_pages:
                    issues.append(_issue("blank-render", "critical", f"Pages rendered blank: {blank_pages}"))
                if wrong_count:
                    issues.append(_issue("render-page-count", "critical", "Raster page count does not match the rendered PDF"))
                if edge_risks:
                    issues.append(_issue("page-edge-ink", "warning", f"Review possible top-edge clipping on pages {edge_risks}"))
            else:
                checks.append({"name": "visual-raster", "status": "warning", "message": "PDF rasterization was unavailable"})
                issues.append(_issue("raster-unavailable", "warning", "Rendered PDF could not be raster-checked"))
        else:
            checks.append({"name": "visual-raster", "status": "warning", "message": "Poppler rasterizer is unavailable"})
            issues.append(_issue("raster-unavailable", "warning", "Rendered PDF could not be raster-checked"))

        text_binary = shutil.which("pdftotext")
        source_text = "\n".join(paragraph.text for paragraph in _iter_story_paragraphs(Document(str(path))))
        if text_binary and re.search(r"[\u0400-\u04FF]", source_text):
            extracted = render_dir / "rendered.txt"
            text_result = subprocess.run([text_binary, str(pdf), str(extracted)], capture_output=True, text=True, timeout=30, check=False)
            rendered_text = extracted.read_text(encoding="utf-8", errors="replace") if extracted.exists() else ""
            cyrillic_ok = text_result.returncode == 0 and bool(re.search(r"[\u0400-\u04FF]", rendered_text)) and "�" not in rendered_text
            checks.append(
                {
                    "name": "cyrillic-render",
                    "status": "passed" if cyrillic_ok else "failed",
                    "message": "Cyrillic text survives PDF rendering" if cyrillic_ok else "Cyrillic text could not be recovered from the rendered PDF",
                }
            )
            if not cyrillic_ok:
                issues.append(_issue("cyrillic-render", "critical", "Cyrillic text did not survive PDF rendering"))

        preview_pdf = None
        if keep_pdf:
            preview_pdf = path.with_suffix(".pdf")
            shutil.copy2(pdf, preview_pdf)
        return checks, issues, preview_pdf
    except subprocess.TimeoutExpired:
        checks.append({"name": "render", "status": "failed", "message": "LibreOffice or raster render timed out"})
        issues.append(_issue("render-timeout", "critical", "Document render exceeded the time limit"))
        return checks, issues, None
    finally:
        shutil.rmtree(render_dir, ignore_errors=True)


def _report(
    spec: dict[str, Any],
    checks: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    changes: list[dict[str, str]],
    preview_pdf: Path | None,
) -> dict[str, Any]:
    status = "needs_review" if any(issue.get("severity") == "critical" for issue in issues) else "ready"
    return {
        "status": status,
        "format": "docx",
        "sourceFileIds": list(spec.get("job", {}).get("sourceFileIds", [])),
        "previewAssets": ([{"filename": preview_pdf.name, "kind": "pdf"}] if preview_pdf else []),
        "qaChecks": checks,
        "issues": issues,
        "changeLog": changes,
        "skillVersion": SKILL_VERSION,
        "repairIterations": int(spec.get("repairIterations", 0)),
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: build_document.py SPEC.json OUTPUT.docx", file=sys.stderr)
        return 2
    spec_path = Path(sys.argv[1])
    output = Path(sys.argv[2])
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    _job(spec, output)
    source_path_value = spec.get("inputPath") or spec.get("templatePath")
    source_path = Path(str(source_path_value)) if source_path_value else None
    source_hash = _sha256(source_path) if source_path else None
    output.parent.mkdir(parents=True, exist_ok=True)
    _, changes, requested_changed_parts = _build(spec, output)
    checks, issues = _check_structure(output, spec, requested_changed_parts)
    if source_path:
        immutable = source_hash == _sha256(source_path)
        checks.append(
            {
                "name": "immutable-input",
                "status": "passed" if immutable else "failed",
                "message": "Input/template file was not modified" if immutable else "Input/template file changed during authoring",
            }
        )
        if not immutable:
            issues.append(_issue("input-modified", "critical", "Input/template file changed during authoring"))
    render_checks, render_issues, preview_pdf = _render(output, keep_pdf=_output_pdf_requested(spec))
    checks.extend(render_checks)
    issues.extend(render_issues)
    report = _report(spec, checks, issues, changes, preview_pdf)
    report_path = Path(f"{output}.artifact-report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    reports = [str(report_path)]
    if preview_pdf:
        pdf_report = {
            **report,
            "format": "pdf",
            "previewAssets": [],
            "changeLog": [
                *changes,
                {
                    "target": preview_pdf.name,
                    "summary": (
                        RU_LABELS["change_pdf"]
                        if str(spec.get("job", {}).get("locale", "ru-RU")).lower().startswith("ru")
                        else "Derived PDF from the verified editable document"
                    ),
                },
            ],
        }
        pdf_report_path = Path(f"{preview_pdf}.artifact-report.json")
        pdf_report_path.write_text(json.dumps(pdf_report, ensure_ascii=False, indent=2), encoding="utf-8")
        reports.append(str(pdf_report_path))
    print(json.dumps({"artifact": str(output), "reports": reports, "status": report["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
