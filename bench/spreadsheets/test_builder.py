"""Structural and real-office checks for the focused XLSX builder."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

from skill.xlsx.scripts.build_spreadsheet import SpecError, _office_convert, _validate


ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / "skill/xlsx/scripts/build_spreadsheet.py"
RUSSIAN_FIXTURE = ROOT / "bench/spreadsheets/fixtures/ru_service_cost.json"


def example_spec() -> dict:
    return {
        "job": {
            "format": "xlsx",
            "audience": "Operations lead",
            "goal": "Review service cost",
            "sourceFileIds": ["pilot-notes.csv"],
            "immutableElements": [],
            "locale": "ru-RU",
            "filename": "service-cost.xlsx",
            "acceptanceCriteria": ["Formulas update", "Every sheet renders"],
        },
        "title": "Service cost",
        "table": {
            "sheetName": "Data",
            "name": "ServiceCosts",
            "columns": [
                {"key": "service", "header": "Service", "type": "text", "choices": ["Support", "Training"]},
                {"key": "units", "header": "Units", "type": "integer", "minimum": 0},
                {"key": "unit_cost", "header": "Unit cost", "type": "number", "minimum": 0},
            ],
            "rows": [
                {"service": "Support", "units": 12, "unit_cost": 125},
                {"service": "Training", "units": 4, "unit_cost": 300},
            ],
            "calculatedColumns": [
                {"key": "cost", "header": "Cost", "operation": "multiply", "inputs": ["units", "unit_cost"]}
            ],
        },
        "summary": [{"label": "Total cost", "operation": "sum", "column": "cost"}],
        "chart": {"kind": "bar", "title": "Cost by service", "category": "service", "value": "cost"},
        "sources": [{"label": "Pilot data", "location": "pilot-notes.csv"}],
        "changeLog": [],
        "repairIterations": 0,
    }


class SpreadsheetBuilderTests(unittest.TestCase):
    def test_russian_single_sheet_total_stays_below_table(self):
        spec = example_spec()
        spec["job"]["sourceFileIds"] = []
        spec["job"]["filename"] = "prodazhi.xlsx"
        spec["title"] = "Учёт продаж"
        spec["table"]["sheetName"] = "Продажи"
        spec["table"]["name"] = "Sales2026"
        spec["summary"] = [{"label": "Итоговая выручка, BYN", "operation": "sum", "column": "cost"}]
        spec["summaryPlacement"] = "below_table"
        spec["chart"] = None
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            spec_path = root / "spec.json"
            spec_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
            output = root / "prodazhi.xlsx"
            result = subprocess.run(
                [sys.executable, str(BUILDER), str(spec_path), str(output)],
                capture_output=True, text=True, timeout=180, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(Path(f"{output}.artifact-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "ready", report)
            workbook = load_workbook(output, data_only=False)
            self.assertEqual(workbook.sheetnames, ["Продажи"])
            self.assertEqual(workbook["Продажи"]["A7"].value, "Итоговая выручка, BYN")
            self.assertEqual(workbook["Продажи"]["D7"].value, "=SUM(D4:D5)")
            self.assertEqual(workbook["Продажи"].tables["Sales2026"].ref, "A3:D5")
            workbook.close()
            cached = load_workbook(output, data_only=True)
            self.assertEqual(cached["Продажи"]["D7"].value, 2700)
            cached.close()

    def test_inline_total_rejects_chart_and_single_column(self):
        spec = example_spec()
        spec["summaryPlacement"] = "below_table"
        with self.assertRaisesRegex(SpecError, "summaryPlacement"):
            _validate(spec, Path("service-cost.xlsx"))
        spec["chart"] = None
        spec["table"]["columns"] = [spec["table"]["columns"][0]]
        spec["table"]["calculatedColumns"] = []
        spec["table"]["rows"] = [{"service": "Support"}]
        spec["summary"] = [{"label": "Count", "operation": "count", "column": "service"}]
        with self.assertRaisesRegex(SpecError, "summaryPlacement"):
            _validate(spec, Path("service-cost.xlsx"))
        spec = example_spec()
        spec["summaryPlacement"] = []
        with self.assertRaisesRegex(SpecError, "summaryPlacement"):
            _validate(spec, Path("service-cost.xlsx"))

    def test_localized_summary_name_cannot_conflict_with_data_sheet(self):
        spec = example_spec()
        spec["table"]["sheetName"] = "Итоги"
        with self.assertRaisesRegex(SpecError, "summary sheet name"):
            _validate(spec, Path("service-cost.xlsx"))

    def test_russian_fixture_renders_localized_summary_and_chart(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "stoimost-uslug.xlsx"
            result = subprocess.run(
                [sys.executable, str(BUILDER), str(RUSSIAN_FIXTURE), str(output)],
                capture_output=True, text=True, timeout=180, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(Path(f"{output}.artifact-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "ready", report)
            workbook = load_workbook(output, data_only=False)
            self.assertEqual(workbook.sheetnames[:2], ["Итоги", "Данные"])
            workbook.close()
            pdf = output.with_name("_qa_stoimost-uslug-preview.pdf")
            rendered = subprocess.run(
                ["pdftotext", "-layout", str(pdf), "-"],
                capture_output=True, text=True, timeout=30, check=True,
            ).stdout
            self.assertIn("Показатель", rendered)
            self.assertIn("Значение", rendered)
            self.assertIn("Стоимость по услугам", rendered)
            self.assertIn("Источник: Демонстрационные данные", rendered)
            self.assertNotIn("Metric", rendered)

    def test_real_office_roundtrip_keeps_formula_table_chart_and_values(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "pilot-notes.csv"
            source.write_bytes(b"original source bytes")
            spec_path = root / "spec.json"
            spec_path.write_text(json.dumps(example_spec()), encoding="utf-8")
            output = root / "service-cost.xlsx"
            result = subprocess.run(
                [sys.executable, str(BUILDER), str(spec_path), str(output)],
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(Path(f"{output}.artifact-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "ready", report)
            self.assertEqual(report["sourceFileIds"], ["pilot-notes.csv"])
            self.assertEqual(report["acceptanceCriteriaReview"], {
                "status": "pending", "criteria": example_spec()["job"]["acceptanceCriteria"],
            })
            self.assertEqual(
                [(check["name"], check["status"]) for check in report["qaChecks"] if check["name"] == "acceptance-criteria"],
                [("acceptance-criteria", "warning")],
            )
            self.assertEqual(source.read_bytes(), b"original source bytes")
            self.assertTrue((root / "_qa_service-cost-preview.pdf").is_file())
            cached = load_workbook(output, data_only=True)
            self.assertEqual(cached["Data"]["D4"].value, 1500)
            self.assertEqual(cached["Итоги"]["B3"].value, 2700)
            cached.close()
            workbook = load_workbook(output, data_only=False)
            self.assertEqual(workbook.sheetnames, ["Итоги", "Data"])
            self.assertEqual(workbook["Data"]["D4"].value, "=B4*C4")
            self.assertEqual(workbook["Итоги"]["B3"].value, "=SUM('Data'!D4:D5)")
            self.assertIn("ServiceCosts", workbook["Data"].tables)
            self.assertEqual(workbook["Data"].tables["ServiceCosts"].tableStyleInfo.name, "TableStyleMedium2")
            self.assertEqual(len(workbook["Итоги"]._charts), 1)
            self.assertTrue(workbook["Data"].data_validations.dataValidation)
            workbook["Data"]["B4"] = 20
            workbook.save(output)
            workbook.close()
            recalculated = _office_convert(output, root / "updated", "xlsx", root / "updated-profile")
            values = load_workbook(recalculated, data_only=True)
            self.assertEqual(values["Data"]["D4"].value, 2500)
            self.assertEqual(values["Итоги"]["B3"].value, 3700)
            values.close()

    def test_source_text_that_looks_like_a_formula_remains_literal(self):
        spec = example_spec()
        spec["table"]["columns"][0].pop("choices")
        spec["table"]["rows"][0]["service"] = '=WEBSERVICE("https://example.invalid")'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            spec_path = root / "spec.json"
            spec_path.write_text(json.dumps(spec), encoding="utf-8")
            output = root / "service-cost.xlsx"
            result = subprocess.run(
                [sys.executable, str(BUILDER), str(spec_path), str(output)],
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            workbook = load_workbook(output, data_only=False)
            self.assertEqual(workbook["Data"]["A4"].data_type, "s")
            self.assertEqual(workbook["Data"]["A4"].value, '=WEBSERVICE("https://example.invalid")')
            workbook.close()

    def test_zero_divisor_rejected_before_file_creation(self):
        spec = example_spec()
        spec["table"]["calculatedColumns"][0]["operation"] = "divide"
        spec["table"]["rows"][1]["unit_cost"] = 0
        with self.assertRaisesRegex(SpecError, "zero divisor"):
            _validate(spec, Path("service-cost.xlsx"))

    def test_raw_formulas_and_template_paths_are_not_accepted(self):
        for field, value in (("rawFormulas", ["=WEBSERVICE(...)"],), ("templatePath", "/tmp/untrusted.xlsx")):
            with self.subTest(field=field):
                spec = example_spec()
                spec[field] = value
                with self.assertRaisesRegex(SpecError, "not supported"):
                    _validate(spec, Path("service-cost.xlsx"))
        spec = example_spec()
        spec["job"]["templateFileId"] = "file-1"
        with self.assertRaisesRegex(SpecError, "not supported"):
            _validate(spec, Path("service-cost.xlsx"))
        spec = example_spec()
        spec["job"]["immutableElements"] = ["Preserve the original layout"]
        with self.assertRaisesRegex(SpecError, "not supported"):
            _validate(spec, Path("service-cost.xlsx"))

    def test_missing_numeric_input_is_not_silently_zero(self):
        spec = example_spec()
        spec["table"]["rows"][0]["units"] = None
        with self.assertRaisesRegex(SpecError, "finite number"):
            _validate(spec, Path("service-cost.xlsx"))

    def test_wide_worksheet_is_rejected_before_unreadable_render(self):
        spec = example_spec()
        for index in range(5):
            key = f"extra_{index}"
            spec["table"]["columns"].append({"key": key, "header": key, "type": "integer"})
            for row in spec["table"]["rows"]:
                row[key] = 1
        with self.assertRaisesRegex(SpecError, "1 to 8 total columns"):
            _validate(spec, Path("service-cost.xlsx"))

    def test_long_headers_exceed_print_width_even_with_eight_columns(self):
        spec = example_spec()
        for index in range(4):
            key = f"extra_{index}"
            spec["table"]["columns"].append({
                "key": key, "header": f"Extended explanatory column {index}", "type": "integer",
            })
            for row in spec["table"]["rows"]:
                row[key] = 1
        with self.assertRaisesRegex(SpecError, "print width"):
            _validate(spec, Path("service-cost.xlsx"))

    def test_long_table_repeats_header_on_later_pdf_pages(self):
        spec = example_spec()
        spec["summary"] = []
        spec["chart"] = None
        spec["table"]["rows"] = [
            {"service": "Support", "units": index, "unit_cost": 125}
            for index in range(1, 81)
        ]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            spec_path = root / "spec.json"
            spec_path.write_text(json.dumps(spec), encoding="utf-8")
            output = root / "service-cost.xlsx"
            result = subprocess.run(
                [sys.executable, str(BUILDER), str(spec_path), str(output)],
                capture_output=True, text=True, timeout=180, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(Path(f"{output}.artifact-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "ready", report)
            pdf = root / "_qa_service-cost-preview.pdf"
            page_two = subprocess.run(
                ["pdftotext", "-f", "2", "-l", "2", "-layout", str(pdf), "-"],
                capture_output=True, text=True, timeout=30, check=True,
            ).stdout
            self.assertIn("Unit cost", page_two)

    def test_clipped_source_text_does_not_receive_ready_status(self):
        spec = example_spec()
        spec["table"]["columns"][0].pop("choices")
        spec["table"]["rows"][0]["service"] = "Important source label " + "description" * 25
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            spec_path = root / "spec.json"
            spec_path.write_text(json.dumps(spec), encoding="utf-8")
            output = root / "service-cost.xlsx"
            result = subprocess.run(
                [sys.executable, str(BUILDER), str(spec_path), str(output)],
                capture_output=True, text=True, timeout=180, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(Path(f"{output}.artifact-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "needs_review", report)
            self.assertTrue(any(issue["code"] == "render" for issue in report["issues"]))

    def test_original_spec_is_not_modified_by_validation(self):
        spec = example_spec()
        original = copy.deepcopy(spec)
        _validate(spec, Path("service-cost.xlsx"))
        self.assertEqual(spec, original)

    def test_text_count_uses_counta_not_numeric_count(self):
        spec = example_spec()
        spec["summary"] = [{"label": "Number of services", "operation": "count", "column": "service"}]
        spec["chart"] = None
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            spec_path = root / "spec.json"
            spec_path.write_text(json.dumps(spec), encoding="utf-8")
            output = root / "service-cost.xlsx"
            result = subprocess.run(
                [sys.executable, str(BUILDER), str(spec_path), str(output)],
                capture_output=True, text=True, timeout=180, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(Path(f"{output}.artifact-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "ready", report)
            workbook = load_workbook(output, data_only=False)
            self.assertEqual(workbook["Итоги"]["B3"].value, "=COUNTA('Data'!A4:A5)")
            workbook.close()

    def test_invalid_excel_identifiers_and_lists_are_rejected(self):
        cases = [
            (lambda spec: spec["table"].update(name="A1"), "cell coordinate"),
            (lambda spec: spec["table"].update(name="R"), "reserved name"),
            (lambda spec: spec["table"].update(name="R1C1"), "Excel reference"),
            (lambda spec: spec["table"].update(sheetName="Data!More"), "valid Excel sheet name"),
            (lambda spec: spec["table"]["columns"][0].update(choices=["A,B"]), "cannot contain"),
            (lambda spec: spec["table"]["calculatedColumns"][0].update(numberFormat=";;;"), "numberFormat is unsupported"),
            (lambda spec: spec["table"]["columns"][0].update(type=[]), "unsupported type"),
            (lambda spec: spec["table"]["columns"][0].update(choices=[{}]), "invalid or duplicate"),
            (lambda spec: spec["table"]["calculatedColumns"][0].update(operation=[]), "invalid header or operation"),
            (lambda spec: spec["table"]["calculatedColumns"][0].update(inputs=[{}, "units"]), "preceding numeric keys"),
            (lambda spec: spec["summary"][0].update(operation=[]), "unsupported operation"),
            (lambda spec: spec.update(chart={"kind": [], "title": "Test"}), "chart.kind"),
            (lambda spec: spec.update(repairIterations=True), "repairIterations"),
        ]
        for change, error in cases:
            with self.subTest(error=error):
                spec = example_spec()
                change(spec)
                with self.assertRaisesRegex(SpecError, error):
                    _validate(spec, Path("service-cost.xlsx"))

    def test_unknown_specification_fields_are_rejected(self):
        cases = [
            lambda spec: spec.update(template_path="/mnt/data/template.xlsx"),
            lambda spec: spec["job"].update(templatedFileId="file-1"),
            lambda spec: spec["table"].update(joins=[]),
            lambda spec: spec["table"]["columns"][0].update(formula="=1+1"),
            lambda spec: spec["table"]["calculatedColumns"][0].update(formula="=B4*C4"),
            lambda spec: spec["summary"][0].update(value=999),
            lambda spec: spec["chart"].update(externalData="https://example.invalid"),
            lambda spec: spec["sources"][0].update(authToken="secret"),
            lambda spec: spec["changeLog"].append({"target": "Data!A1", "summary": "Edit", "oldValue": "x"}),
        ]
        for change in cases:
            with self.subTest(change=change):
                spec = example_spec()
                change(spec)
                with self.assertRaisesRegex(SpecError, "unsupported field"):
                    _validate(spec, Path("service-cost.xlsx"))

    def test_existing_output_is_never_overwritten_even_during_repair(self):
        for repair_iteration in (0, 1):
            with self.subTest(repair_iteration=repair_iteration), tempfile.TemporaryDirectory() as folder:
                spec = example_spec()
                spec["repairIterations"] = repair_iteration
                root = Path(folder)
                spec_path = root / "spec.json"
                spec_path.write_text(json.dumps(spec), encoding="utf-8")
                output = root / "service-cost.xlsx"
                output.write_bytes(b"existing workbook bytes")
                result = subprocess.run(
                    [sys.executable, str(BUILDER), str(spec_path), str(output)],
                    capture_output=True, text=True, timeout=30, check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("cannot be overwritten", result.stderr)
                self.assertEqual(output.read_bytes(), b"existing workbook bytes")


if __name__ == "__main__":
    unittest.main()
