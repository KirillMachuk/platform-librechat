# Document quality benchmark

This benchmark exercises the production DOCX builder in the real LibreOffice and Poppler toolchain.

The matrix contains ten Russian-first scenarios: memo, report, SOP, long Cyrillic copy, multi-page tables, source traceability, template filling, targeted editing, deliberate page breaks, and mixed Russian/English typography. Every critical scenario runs three times in CI.

Run the unit and structural checks:

```bash
python -m unittest discover -s bench/documents -p 'test_*.py'
```

Run the complete render matrix:

```bash
python bench/documents/run_goldens.py --runs 3
```

The command fails when a file cannot reopen, a critical QA issue remains, render output is missing, source immutability fails, or a case-specific structural requirement is not met. Page montages and report sidecars are retained as CI review evidence.
