# Presentation quality benchmark

This benchmark exercises the model-agnostic, Russian-first PowerPoint builder in the real office toolchain. It covers ten golden scenarios, runs each scenario three times, reopens every deck, checks editability and source traceability, renders through LibreOffice, persists fresh full-slide PNGs and a montage, and compares slide pixel hashes between repeated runs.

Run the full structural matrix:

```bash
python3 bench/presentations/run_goldens.py --runs 3
```

Use `--skip-visual-gate` only while establishing a new baseline. After reviewing every distinct rendered slide at full size, record the five rubric dimensions and their sum in `visual_scores.json`, then run the complete command above. The runner rejects missing cases, incomplete dimensions, out-of-range values, and incorrect score arithmetic.

The visual gate requires an average score of at least 9.0, no result below 8.0, and at least 90% of cases at 9.0 or higher. A score is the sum of five two-point dimensions: narrative, hierarchy, readability, visual craft, and evidence/editability.

Padding-based overflow tools may be used as an additional check for builder-native slides. Do not use their result for inherited template placeholders: those tools enlarge the slide and shift slide-level shapes, while placeholder geometry is inherited from the master/layout and can therefore produce false positives. Template cases are checked through resolved structural bounds plus the unmodified full-size LibreOffice render.
