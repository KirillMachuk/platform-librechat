#!/usr/bin/env python3
"""Author the document fixtures used by the file-preview e2e specs.

The generated files are COMMITTED to the repository and CI never runs this
script. It exists so the fixtures have provenance: anyone can see how each one
was produced and regenerate the set after changing it.

The documents are written by the ordinary Office libraries (python-docx,
openpyxl, python-pptx) and reportlab, so they are real files with real internal
structure rather than hand-assembled XML — the point is to exercise the same
conversion path a client's own contract takes.

All content is invented. Nothing here comes from a real client, and the
repository is public, so keep it that way.

Usage (needs python-docx, openpyxl, python-pptx, reportlab, pillow, pikepdf):

    python e2e/fixtures/generate_fixtures.py
"""

from __future__ import annotations

import datetime
import io
import os
import shutil
import zipfile
from pathlib import Path

import pikepdf
from docx import Document
from docx.shared import Pt
from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageFilter
from pptx import Presentation
from pptx.util import Emu, Inches, Pt as PptPt
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent / "files"

# Fixed so regenerating does not churn the committed bytes.
FIXED_DATE = (2026, 1, 15, 12, 0, 0)
FIXED_DATETIME = datetime.datetime(*FIXED_DATE)
PDF_TIMESTAMP = "D:20260115120000+00'00'"

COMPANY = "ООО «Ромашка»"
COUNTERPARTY = "ИП Иванов Иван Иванович"

CLAUSES = [
    (
        "Предмет договора",
        "Исполнитель обязуется оказать Заказчику услуги по сопровождению "
        "информационной системы, а Заказчик обязуется принять и оплатить эти "
        "услуги в порядке и на условиях, предусмотренных настоящим Договором.",
    ),
    (
        "Права и обязанности сторон",
        "Исполнитель вправе привлекать третьих лиц для исполнения обязательств, "
        "оставаясь ответственным за результат. Заказчик обязуется предоставлять "
        "доступы и сведения, необходимые для оказания услуг, в течение пяти "
        "рабочих дней с момента получения запроса.",
    ),
    (
        "Стоимость услуг и порядок расчётов",
        "Стоимость услуг составляет 120 000 (сто двадцать тысяч) рублей в месяц. "
        "Оплата производится ежемесячно, не позднее десятого числа месяца, "
        "следующего за отчётным, на основании акта оказанных услуг.",
    ),
    (
        "Порядок сдачи и приёмки",
        "По окончании отчётного периода Исполнитель направляет Заказчику акт "
        "оказанных услуг. Заказчик обязан подписать акт либо направить "
        "мотивированный отказ в течение пяти рабочих дней.",
    ),
    (
        "Ответственность сторон",
        "За нарушение сроков оплаты Заказчик уплачивает пеню в размере 0,1 % от "
        "просроченной суммы за каждый день просрочки, но не более 10 % от общей "
        "стоимости услуг за соответствующий период.",
    ),
    (
        "Конфиденциальность",
        "Стороны обязуются не раскрывать третьим лицам сведения, ставшие им "
        "известными в ходе исполнения Договора, в течение трёх лет с момента "
        "его прекращения.",
    ),
    (
        "Обстоятельства непреодолимой силы",
        "Стороны освобождаются от ответственности за частичное или полное "
        "неисполнение обязательств, если оно явилось следствием обстоятельств "
        "непреодолимой силы, возникших после заключения Договора.",
    ),
    (
        "Срок действия и порядок расторжения",
        "Договор вступает в силу с момента подписания и действует до 31 декабря "
        "2026 года. Каждая из сторон вправе расторгнуть Договор, письменно "
        "уведомив другую сторону не менее чем за тридцать календарных дней.",
    ),
]


def freeze_core_properties(document) -> None:
    """Pin document dates so regenerating does not churn the committed bytes."""
    properties = document.core_properties
    properties.created = FIXED_DATETIME
    properties.modified = FIXED_DATETIME
    properties.last_modified_by = "fixtures"
    properties.author = "fixtures"


def normalize_zip(path: Path) -> None:
    """Rewrite a zip-based document with fixed timestamps and stable order."""
    with zipfile.ZipFile(path) as source:
        entries = sorted(source.infolist(), key=lambda item: item.filename)
        payload = [(item.filename, source.read(item.filename)) for item in entries]

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as target:
        for name, data in payload:
            info = zipfile.ZipInfo(name, date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            target.writestr(info, data)
    path.write_bytes(buffer.getvalue())


def add_heading(document: Document, text: str, level: int = 1) -> None:
    document.add_heading(text, level=level)


def build_contract(path: Path, *, repeats: int, title: str) -> None:
    document = Document()
    freeze_core_properties(document)

    document.add_heading(title, level=0)
    intro = document.add_paragraph()
    intro.add_run(f"{COMPANY}, именуемое в дальнейшем «Исполнитель», с одной стороны, и ")
    intro.add_run(f"{COUNTERPARTY}, именуемый в дальнейшем «Заказчик», с другой стороны, ")
    intro.add_run("заключили настоящий Договор о нижеследующем.")

    number = 0
    for _ in range(repeats):
        for heading, body in CLAUSES:
            number += 1
            add_heading(document, f"{number}. {heading}", level=1)
            document.add_paragraph(body)
            document.add_paragraph(
                "Стороны подтверждают, что положения настоящего раздела согласованы "
                "и не требуют дополнительного толкования.",
                style="List Bullet",
            )

    add_heading(document, "Реквизиты сторон", level=1)
    table = document.add_table(rows=4, cols=2)
    table.style = "Table Grid"
    rows = [
        ("Исполнитель", "Заказчик"),
        (COMPANY, COUNTERPARTY),
        ("ИНН 7700000000", "ИНН 7800000000"),
        ("Расчётный счёт 40702810000000000001", "Расчётный счёт 40802810000000000002"),
    ]
    for row_index, (left, right) in enumerate(rows):
        table.cell(row_index, 0).text = left
        table.cell(row_index, 1).text = right

    for paragraph in document.paragraphs:
        for run in paragraph.runs:
            if run.font.size is None:
                run.font.size = Pt(11)

    document.save(path)
    normalize_zip(path)


def noise_image(width: int, height: int, seed: int) -> Image.Image:
    """Deterministic, poorly compressible image used to inflate a document."""
    image = Image.new("RGB", (width, height))
    pixels = image.load()
    value = seed
    for y in range(height):
        for x in range(width):
            value = (value * 1103515245 + 12345) & 0x7FFFFFFF
            pixels[x, y] = (value >> 16 & 0xFF, value >> 8 & 0xFF, value & 0xFF)
    return image


def build_heavy_contract(path: Path) -> None:
    document = Document()
    freeze_core_properties(document)
    document.add_heading("Договор оказания услуг (с приложениями)", level=0)
    document.add_paragraph(
        f"{COMPANY} и {COUNTERPARTY} заключили настоящий Договор, включающий "
        "графические приложения — схемы информационного обмена."
    )

    number = 0
    for _ in range(3):
        for heading, body in CLAUSES:
            number += 1
            document.add_heading(f"{number}. {heading}", level=1)
            document.add_paragraph(body)

    # One incompressible image is enough to push the file past the 350 KB bound
    # where the backend stops using its CDN renderer; more only bloats the repo.
    for index in range(1):
        document.add_heading(f"Приложение {index + 1}. Схема обмена", level=1)
        buffer = io.BytesIO()
        noise_image(360, 360, seed=index + 1).save(buffer, format="PNG", compress_level=0)
        buffer.seek(0)
        document.add_picture(buffer, width=Inches(4.5))

    document.save(path)
    normalize_zip(path)


def build_registry(path: Path) -> None:
    workbook = Workbook()

    registry = workbook.active
    registry.title = "Реестр договоров"
    registry["A1"] = "Реестр действующих договоров на 15.01.2026"
    registry.merge_cells("A1:E1")
    # row 2 deliberately blank — real registries have one
    headers = ["№", "Контрагент", "Предмет", "Сумма, ₽", "Статус"]
    for column, header in enumerate(headers, start=1):
        registry.cell(row=3, column=column, value=header)

    contractors = [
        "ООО «Ромашка»",
        "ИП Иванов И. И.",
        "ООО «Василёк»",
        "АО «Одуванчик»",
        "ООО «Клевер»",
    ]
    subjects = ["Сопровождение", "Поставка", "Аренда", "Консультации", "Подряд"]
    statuses = ["действует", "продлён", "", "на подписании", "закрыт"]

    for index in range(40):
        row = 4 + index
        registry.cell(row=row, column=1, value=index + 1)
        registry.cell(row=row, column=2, value=contractors[index % len(contractors)])
        registry.cell(row=row, column=3, value=subjects[index % len(subjects)])
        # every seventh amount is deliberately missing
        if index % 7 != 6:
            registry.cell(row=row, column=4, value=100000 + index * 1250)
        registry.cell(row=row, column=5, value=statuses[index % len(statuses)])

    total_row = 4 + 40 + 1
    registry.cell(row=total_row, column=2, value="Итого")
    registry.merge_cells(start_row=total_row, start_column=2, end_row=total_row, end_column=3)
    registry.cell(row=total_row, column=4, value=f"=SUM(D4:D{4 + 39})")

    calc = workbook.create_sheet("Расчёт")
    calc["A1"] = "Показатель"
    calc["B1"] = "Значение"
    calc["A2"] = "Ставка НДС"
    calc["B2"] = 0.2
    calc["A3"] = "Сумма без НДС"
    calc["B3"] = 250000
    calc["A4"] = "НДС"
    calc["B4"] = "=B3*B2"
    calc["A5"] = "Итого с НДС"
    calc["B5"] = "=B3+B4"

    notes = workbook.create_sheet("Примечания")
    notes["A1"] = "Лист оставлен почти пустым намеренно."

    workbook.save(path)
    normalize_zip(path)


def build_big_rows(path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Операции"
    sheet.append(["№", "Дата", "Контрагент", "Сумма, ₽"])
    for index in range(6000):
        sheet.append(
            [
                index + 1,
                f"{(index % 28) + 1:02d}.01.2026",
                f"Контрагент {index % 250 + 1}",
                1000 + (index % 900) * 7,
            ]
        )
    workbook.save(path)
    normalize_zip(path)


def build_deck(path: Path, *, slides: int, widescreen: bool) -> None:
    presentation = Presentation()
    if widescreen:
        presentation.slide_width = Emu(12192000)
        presentation.slide_height = Emu(6858000)
    else:
        presentation.slide_width = Emu(9144000)
        presentation.slide_height = Emu(6858000)

    title_layout = presentation.slide_layouts[0]
    bullet_layout = presentation.slide_layouts[1]

    first = presentation.slides.add_slide(title_layout)
    first.shapes.title.text = "Итоги полугодия"
    first.placeholders[1].text = f"{COMPANY} · январь 2026"

    for index in range(1, slides):
        slide = presentation.slides.add_slide(bullet_layout)
        slide.shapes.title.text = f"Раздел {index}"
        body = slide.placeholders[1].text_frame
        body.text = f"Ключевой показатель {index}"
        for bullet in range(2):
            paragraph = body.add_paragraph()
            paragraph.text = f"Пояснение {index}.{bullet + 1}"
            paragraph.level = 1
            paragraph.font.size = PptPt(18)

    presentation.save(path)
    normalize_zip(path)


def build_markdown(path: Path) -> None:
    path.write_text(
        """# Заметки по проекту

Короткий документ, чтобы проверить читательский вид markdown.

## Что сделано

- собрана первая версия отчёта
- согласованы сроки приёмки
- заведён реестр договоров

## Таблица сроков

| Этап | Срок | Ответственный |
|---|---|---|
| Аналитика | 20.01.2026 | Иванов |
| Разработка | 14.02.2026 | Петрова |
| Приёмка | 28.02.2026 | Сидоров |

> Приёмка проходит только после подписания акта.

```python
def total(rows):
    return sum(row.amount for row in rows)
```

Подробности — на [внутреннем портале](https://example.invalid/handbook).
""",
        encoding="utf-8",
    )


def build_script(path: Path) -> None:
    path.write_text(
        '''"""Расчёт итогов по реестру договоров.

Учебный модуль: используется как фикстура предпросмотра исходного кода.
"""

from dataclasses import dataclass


VAT_RATE = 0.2


@dataclass
class Contract:
    """Одна строка реестра договоров."""

    number: int
    counterparty: str
    amount: float
    status: str


def is_active(contract: Contract) -> bool:
    """Договор считается действующим, пока он не закрыт."""
    return contract.status not in {"закрыт", "расторгнут"}


def total_amount(contracts: list[Contract]) -> float:
    """Сумма по действующим договорам без НДС."""
    return sum(contract.amount for contract in contracts if is_active(contract))


def with_vat(amount: float) -> float:
    """Сумма с НДС, округлённая до копеек."""
    return round(amount * (1 + VAT_RATE), 2)


def summary(contracts: list[Contract]) -> dict[str, float]:
    """Свод по реестру: количество, сумма и сумма с НДС."""
    active = [contract for contract in contracts if is_active(contract)]
    base = total_amount(active)
    return {
        "count": len(active),
        "amount": base,
        "amount_with_vat": with_vat(base),
    }


if __name__ == "__main__":
    rows = [
        Contract(1, "ООО «Ромашка»", 120000, "действует"),
        Contract(2, "ИП Иванов", 80000, "закрыт"),
        Contract(3, "ООО «Василёк»", 45000, "продлён"),
    ]
    print(summary(rows))
''',
        encoding="utf-8",
    )


def build_csv(path: Path) -> None:
    lines = ['№,Контрагент,Предмет,"Сумма, ₽",Комментарий']
    samples = [
        (1, "ООО «Ромашка»", "Сопровождение", 120000, 'акт подписан'),
        (2, "ИП Иванов", "Поставка", 80000, '"срочная" отгрузка'),
        (3, "ООО «Василёк»", "Аренда", 45000, ""),
        (4, "АО «Одуванчик»", "Консультации, аудит", 210000, "продление, с НДС"),
    ]
    for index in range(30):
        number, name, subject, amount, note = samples[index % len(samples)]
        lines.append(f'{index + 1},{name},"{subject}",{amount + index * 100},"{note}"')
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def register_font() -> str:
    """Register a font that can draw Cyrillic, falling back to a core font."""
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            pdfmetrics.registerFont(TTFont("FixtureSans", candidate))
            return "FixtureSans"
    return "Helvetica"


def build_digital_pdf(path: Path) -> None:
    font = register_font()
    pdf = canvas.Canvas(str(path), pagesize=A4)
    pdf.setTitle("Договор оказания услуг")
    width, height = A4
    for index, (heading, body) in enumerate(CLAUSES[:5]):
        pdf.setFont(font, 16)
        pdf.drawString(60, height - 80, f"Раздел {index + 1}. {heading}")
        pdf.setFont(font, 11)
        text = pdf.beginText(60, height - 120)
        for chunk in wrap_text(body, 78):
            text.textLine(chunk)
        pdf.drawText(text)
        pdf.showPage()
    pdf.save()
    stamp_pdf_dates(path)


def wrap_text(text: str, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def scan_page_image(index: int) -> Image.Image:
    """Render text into a raster so the page carries no extractable text."""
    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    draw.text((90, 110), f"AKT No {index + 1}", fill="black")
    draw.text((90, 170), "OOO Romashka  /  IP Ivanov", fill="black")
    for line in range(18):
        draw.text((90, 240 + line * 34), "-" * 60, fill=(40, 40, 40))
    draw.rectangle([(820, 1360), (1120, 1560)], outline=(120, 120, 120), width=3)
    draw.text((860, 1450), "STAMP", fill=(90, 90, 90))
    speckle = image.load()
    value = 7 + index
    for _ in range(4000):
        value = (value * 1103515245 + 12345) & 0x7FFFFFFF
        x = (value >> 8) % image.width
        y = (value >> 16) % image.height
        speckle[x, y] = (200, 200, 200)
    return image.rotate(0.4, fillcolor="white").filter(ImageFilter.GaussianBlur(0.3))


def build_scan_pdf(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=A4)
    width, height = A4
    for index in range(3):
        buffer = io.BytesIO()
        scan_page_image(index).save(buffer, format="JPEG", quality=70)
        buffer.seek(0)
        pdf.drawImage(ImageReader(buffer), 0, 0, width=width, height=height)
        pdf.showPage()
    pdf.save()
    stamp_pdf_dates(path)


def stamp_pdf_dates(path: Path) -> None:
    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        with pdf.open_metadata() as meta:
            meta["dc:title"] = "fixture"
        pdf.docinfo["/CreationDate"] = PDF_TIMESTAMP
        pdf.docinfo["/ModDate"] = PDF_TIMESTAMP
        pdf.save(path, deterministic_id=True)


def build_locked_pdf(source: Path, path: Path) -> None:
    with pikepdf.open(source) as pdf:
        # QPDF refuses a deterministic id for encrypted output.
        pdf.save(
            path,
            encryption=pikepdf.Encryption(user="secret123", owner="secret123", R=4),
        )


def build_broken_docx(source: Path, path: Path) -> None:
    """A file that announces itself as a docx but whose archive is truncated."""
    data = source.read_bytes()
    path.write_bytes(data[: len(data) // 3])


def build_archive(path: Path) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, text in (
            ("readme.txt", "Архив с двумя файлами — предпросмотр для него не предусмотрен.\n"),
            ("data.txt", "строка 1\nстрока 2\n"),
        ):
            info = zipfile.ZipInfo(name, date_time=FIXED_DATE)
            archive.writestr(info, text.encode("utf-8"))
    path.write_bytes(buffer.getvalue())


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    build_contract(OUT / "contract-short.docx", repeats=1, title="Договор оказания услуг")
    build_contract(
        OUT / "contract-long.docx", repeats=6, title="Договор оказания услуг (расширенный)"
    )
    build_heavy_contract(OUT / "contract-heavy.docx")
    build_registry(OUT / "registry.xlsx")
    build_big_rows(OUT / "big-rows.xlsx")
    build_deck(OUT / "deck-16x9.pptx", slides=12, widescreen=True)
    build_deck(OUT / "deck-4x3.pptx", slides=6, widescreen=False)
    build_deck(OUT / "deck-many.pptx", slides=60, widescreen=True)
    build_markdown(OUT / "notes.md")
    build_script(OUT / "script.py")
    build_csv(OUT / "data.csv")
    build_digital_pdf(OUT / "digital.pdf")
    build_scan_pdf(OUT / "scan.pdf")
    build_locked_pdf(OUT / "digital.pdf", OUT / "locked.pdf")
    build_broken_docx(OUT / "contract-short.docx", OUT / "broken.docx")
    build_archive(OUT / "archive.zip")

    for item in sorted(OUT.iterdir()):
        print(f"{item.name:24} {item.stat().st_size:>9,} bytes")


if __name__ == "__main__":
    main()
