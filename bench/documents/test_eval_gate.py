#!/usr/bin/env python3
"""Tests for the DOCX golden-matrix acceptance gate."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from bench.documents.run_goldens import (
    _reset_run_dir,
    _write_montage,
    build_render_evidence_digest,
    evaluate_matrix_coverage,
)


class DocumentEvalGateTests(unittest.TestCase):
    def test_run_directory_is_cleared_before_each_build(self):
        with tempfile.TemporaryDirectory() as folder:
            run_dir = Path(folder) / "run-1"
            run_dir.mkdir()
            (run_dir / "stale.pdf").write_bytes(b"stale")

            _reset_run_dir(run_dir)

            self.assertTrue(run_dir.is_dir())
            self.assertEqual(list(run_dir.iterdir()), [])

    def test_gate_requires_every_case_in_every_run(self):
        results = [
            {"case": "memo", "run": 1, "status": "ready", "pages": 1},
            {"case": "memo", "run": 2, "status": "ready", "pages": 1},
            {"case": "report", "run": 1, "status": "ready", "pages": 2},
        ]

        issues = evaluate_matrix_coverage(results, ["memo", "report"], 2)

        self.assertEqual(issues, ["missing result for report run 2"])

    def test_gate_rejects_non_ready_or_unrendered_results(self):
        results = [
            {"case": "memo", "run": 1, "status": "needs_review", "pages": 0}
        ]

        issues = evaluate_matrix_coverage(results, ["memo"], 1)

        self.assertTrue(any("not ready" in issue for issue in issues))
        self.assertTrue(any("no rendered pages" in issue for issue in issues))

    def test_render_evidence_is_complete_and_order_independent(self):
        results = [
            {"case": "report", "run": 1, "imageHashes": ["b1", "b2"]},
            {"case": "memo", "run": 1, "imageHashes": ["a1"]},
            {"case": "memo", "run": 2, "imageHashes": ["later-run"]},
        ]

        digest, issues = build_render_evidence_digest(results, ["memo", "report"])
        reordered, reordered_issues = build_render_evidence_digest(results, ["report", "memo"])
        _missing, missing_issues = build_render_evidence_digest(results, ["memo", "sop"])

        self.assertFalse(issues)
        self.assertFalse(reordered_issues)
        self.assertEqual(digest, reordered)
        self.assertTrue(any("sop" in issue for issue in missing_issues))

    def test_montage_is_rebuilt_from_current_page_images(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            pages = [root / "page-1.png", root / "page-2.png"]
            Image.new("RGB", (210, 297), "#2458A6").save(pages[0])
            Image.new("RGB", (210, 297), "#F3F6FA").save(pages[1])
            output = root / "montage.png"

            _write_montage(pages, output)

            with Image.open(output) as montage:
                rgb = montage.convert("RGB")
                self.assertEqual(rgb.getpixel((30, 30)), (36, 88, 166))
                self.assertEqual(rgb.getpixel((384, 30)), (243, 246, 250))


if __name__ == "__main__":
    unittest.main()
