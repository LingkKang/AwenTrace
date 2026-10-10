# Changelog

## Unreleased

- Separate Tests and Pages workflows; deploy the exact artifact from a successful master test run.

- Build and test the static demo at its project base path, then deploy passing master updates to GitHub Pages.

- Decouple library browser tests from the demo with a minimal textarea fixture and separate Playwright projects.
- Refine the development demo with start/pause/resume/reset, whitespace word counts, the latest 200 detailed records and placeholder-styled text history; remove promotional copy, the statistics sidebar and the test global.
- Add manual recorder pause/resume with explicit timeline boundaries and checkpoint reconciliation.
- Validate demo session controls, history, counts and actual JSON/JSONL/CSV downloads through end-to-end tests.

## 0.1.0

- Framework-independent, zero-runtime-dependency TypeScript capture core for ASCII textarea writing.
- Keyboard, text/selection, mouse/pointer, clipboard, scrolling, page lifecycle and research-marker records.
- Original versioned session schema with exact text patches and explicit evidence/unsupported-input flags.
- Deterministic text reconstruction, JSON/JSONL/CSV exports and idempotent recorder cleanup.
- Browser demo with event inspection and text-history reconstruction.
- Docker development environment and core/Chromium regression tests.
