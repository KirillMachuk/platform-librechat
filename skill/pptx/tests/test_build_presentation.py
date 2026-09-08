"""Focused regression tests for the deterministic presentation builder."""

import importlib.util
import unittest
from pathlib import Path

from pptx import Presentation


BUILDER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "build_presentation.py"
SPEC = importlib.util.spec_from_file_location("pptx_builder", BUILDER_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - import setup failure
    raise RuntimeError(f"Unable to import builder from {BUILDER_PATH}")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class ChartLayoutRegressionTest(unittest.TestCase):
    def test_long_russian_takeaway_and_detail_do_not_overlap(self):
        presentation = Presentation()
        presentation.slide_width = BUILDER.WIDE_WIDTH
        presentation.slide_height = BUILDER.WIDE_HEIGHT
        item = {
            "layout": "chart",
            "title": "Жара в начале месяца, заметное похолодание к концу",
            "chart": {
                "type": "column",
                "categories": [str(day) for day in range(1, 32)],
                "series": [
                    {
                        "name": "Максимум днём, °C",
                        "values": [
                            29,
                            24,
                            24,
                            28,
                            30,
                            32,
                            23,
                            19,
                            22,
                            25,
                            22,
                            22,
                            22,
                            21,
                            25,
                            27,
                            21,
                            15,
                            20,
                            20,
                            22,
                            26,
                            18,
                            18,
                            18,
                            19,
                            19,
                            21,
                            23,
                            23,
                            25,
                        ],
                    }
                ],
            },
            "takeaway": "Пик +32°, к концу месяца +18…+21°",
            "takeawayDetail": (
                "Первая декада — по-летнему жаркая, во второй половине месяца "
                "погода смещается к осенней."
            ),
        }

        BUILDER._render_chart(presentation, item)
        slide = presentation.slides[0]
        text_shapes = {
            shape.name: shape
            for shape in slide.shapes
            if shape.name in {"Chart takeaway", "Chart takeaway detail"}
        }
        takeaway = text_shapes["Chart takeaway"]
        detail = text_shapes["Chart takeaway detail"]

        self.assertLessEqual(takeaway.top + takeaway.height, detail.top)
        self.assertLessEqual(detail.top + detail.height, BUILDER.Inches(6.58))
        detail_sizes = [
            run.font.size.pt
            for paragraph in detail.text_frame.paragraphs
            for run in paragraph.runs
            if run.text.strip() and run.font.size is not None
        ]
        self.assertTrue(detail_sizes)
        self.assertGreaterEqual(min(detail_sizes), 16)


if __name__ == "__main__":
    unittest.main()
