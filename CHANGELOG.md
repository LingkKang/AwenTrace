# Changelog

## 0.1.0

- Framework-independent, zero-runtime-dependency TypeScript capture core for English/ASCII textarea writing.
- Keyboard, text/selection, mouse/pointer, clipboard, scrolling, page lifecycle and application-marker records; mouse/pointer movement capture is disabled by default.
- Versioned session schema with exact text patches, unsupported-input flags, deterministic reconstruction and JSON/JSONL/CSV exports.
- Session pause/resume with explicit boundaries and checkpoint reconciliation; idempotent cleanup and completed snapshots in stop callbacks.
- Focus tracking through shadow roots and automatic session IDs on HTTP origins.
- Browser demo with session controls, character/word counts, text history, the latest 200 records shown newest first and full chronological exports.
- Static demo builds for project subpaths and custom domains; separate Tests and Pages workflows deploy tested artifacts from successful master runs.
- Docker development environment with TypeScript checks, unit tests, isolated library browser tests, demo end-to-end tests and static-hosting checks.
- Independent npm package tests covering packed files, installation, ESM imports, TypeScript declarations and browser use.
- npm installation instructions and consolidated API, event-format and roadmap documentation; architecture documentation and declaration-map sources included in the package.
