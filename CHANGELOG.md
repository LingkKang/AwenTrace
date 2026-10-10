# Changelog

## Unreleased

- Finalize recorder state before stop callbacks; resolve focus through shadow roots and generate session IDs on HTTP origins.
- Document npm installation and include architecture documentation and declaration-map sources in the package.
- Test the packed library in an independent consumer alongside lifecycle, HTTP and shadow-focus regressions.

- Add recorder pause/resume within a session, with explicit boundaries and checkpoint reconciliation.
- Simplify demo controls, counts and history; display the latest 200 records newest first while exporting the full chronological trace.
- Disable mouse/pointer movement capture by default and in the demo.
- Isolate library browser tests from the demo and cover demo controls, history and downloads through end-to-end tests.
- Build the static demo with relative asset paths and verify project-subpath and domain-root hosting.
- Separate Tests and Pages workflows; deploy the tested artifact from successful master runs.
- Simplify the README and consolidate API details, event semantics and future work.

## 0.1.0

- Framework-independent, zero-runtime-dependency TypeScript capture core for ASCII textarea writing.
- Keyboard, text/selection, mouse/pointer, clipboard, scrolling, page lifecycle and research-marker records.
- Original versioned session schema with exact text patches and explicit evidence/unsupported-input flags.
- Deterministic text reconstruction, JSON/JSONL/CSV exports and idempotent recorder cleanup.
- Browser demo with event inspection and text-history reconstruction.
- Docker development environment and core/Chromium regression tests.
