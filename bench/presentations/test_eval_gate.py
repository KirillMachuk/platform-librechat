#!/usr/bin/env python3
"""Tests for the presentation benchmark acceptance gate."""

from __future__ import annotations

import unittest
import tempfile
from pathlib import Path

from PIL import Image

from bench.presentations.run_goldens import (
    _reset_run_dir,
    _write_montage,
    evaluate_visual_scorecard,
    evaluate_visual_scores,
)


class VisualGateTests(unittest.TestCase):
    def test_run_directory_is_cleared_before_each_build(self):
        with tempfile.TemporaryDirectory() as folder:
            run_dir = Path(folder) / "run-1"
            run_dir.mkdir()
            (run_dir / "stale.pdf").write_bytes(b"stale render")

            _reset_run_dir(run_dir)

            self.assertTrue(run_dir.is_dir())
            self.assertEqual(list(run_dir.iterdir()), [])

    def test_visual_gate_requires_professional_scores(self):
        passing = {f"case-{index}": 9.0 for index in range(10)}
        failing_average = {**passing, "case-0": 8.0, "case-1": 8.0}
        failing_floor = {**passing, "case-0": 7.9, "case-1": 9.2}

        self.assertEqual(evaluate_visual_scores(passing), [])
        self.assertTrue(any("average" in issue for issue in evaluate_visual_scores(failing_average)))
        self.assertTrue(any("below 8" in issue for issue in evaluate_visual_scores(failing_floor)))

    def test_montage_is_rebuilt_from_current_slide_images(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            slides = [root / "slide-1.png", root / "slide-2.png"]
            Image.new("RGB", (160, 90), "#E25843").save(slides[0])
            Image.new("RGB", (160, 90), "#25805C").save(slides[1])
            output = root / "montage.png"

            _write_montage(slides, output)

            with Image.open(output) as montage:
                rgb = montage.convert("RGB")
                self.assertEqual(rgb.getpixel((180, 110)), (226, 88, 67))
                self.assertEqual(rgb.getpixel((678, 110)), (37, 128, 92))

    def test_visual_scorecard_rejects_incomplete_or_inconsistent_rubrics(self):
        payload = {
            "rubric": {"narrative": 2, "readability": 2},
            "cases": {
                "case-a": {
                    "score": 4,
                    "dimensions": {"narrative": 2, "readability": 1},
                }
            },
        }

        issues = evaluate_visual_scorecard(payload, ["case-a"])

        self.assertTrue(any("dimension sum" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
