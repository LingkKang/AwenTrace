# Changelog

## Unreleased

- Decouple library browser tests from the demo with a minimal textarea fixture and separate Playwright projects.
- Simplify the demo to writing, session controls, event count and exports; remove the test global, event table, statistics sidebar and history slider.
- Validate demo session restart and actual JSON/JSONL/CSV downloads through end-to-end tests.

## 0.1.0

- Framework-independent, zero-runtime-dependency TypeScript capture core for ASCII textarea writing.
- Keyboard, text/selection, mouse/pointer, clipboard, scrolling, page lifecycle and research-marker records.
- Original versioned session schema with exact text patches and explicit evidence/unsupported-input flags.
- Deterministic text reconstruction, JSON/JSONL/CSV exports and idempotent recorder cleanup.
- Browser demo with event inspection and text-history reconstruction.
- Docker development environment and core/Chromium regression tests.
