# AwenTrace architecture

## Development layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Public ESM entry point |
| `src/types.ts` | Versioned event types and public interfaces |
| `src/recorder.ts` | Browser listeners, event ordering and lifecycle |
| `src/text.ts` | ASCII checks, edit deltas and reconstruction |
| `src/export.ts` | JSON, JSONL and CSV serialization |
| `index.html`, `demo/` | Demo markup, controls and styles |
| `tests/core.test.mjs` | Text reconstruction and export tests |
| `tests/package.test.mjs` | Packed files, installation, declarations and browser consumption |
| `tests/browser/fixtures/` | Minimal textarea fixture and test-only API bridge |
| `tests/browser/recorder.spec.ts` | Library browser tests |
| `tests/browser/demo.spec.ts` | Demo controls, history and download tests |

The core has no runtime dependencies. It observes the editor without rendering UI, changing text or sending data over a network. Importing it in Node is safe; creating a recorder requires a browser textarea.

The demo and fixture consume the public API separately. Only the fixture exposes `window.awenTest`; the demo has no test bridge. Playwright gives each test an isolated browser context.

`npm run build` emits only the library into `dist/`. `npm run build:demo` emits the static site into `demo-dist/`, using relative asset paths. The npm package includes `src/` for declaration-map navigation and this architecture document. Neither the demo nor the tests are included. Generated builds and test results are ignored by Git.

Run one browser suite with `npm run test:browser -- --project=library` or `--project=demo`. To reproduce the full Tests workflow in a separate container, run `docker compose run --rm -e CI=true dev sh -c "npm test && npm run test:pages"`.

## Public API

See the [API reference](../README.md#api) for functions and recorder methods.

A supplied `sessionId` must be unique across recordings. Generated IDs use `crypto.randomUUID()`, with a UUID v4 fallback based on `crypto.getRandomValues()` for HTTP origins. Metadata and marker data must be JSON-compatible.

Callbacks run synchronously and receive deeply frozen events. Callback errors go to `onError` or the console without stopping capture. Keep expensive work out of callbacks; snapshots and exports clone the complete trace.

## Session and event format

A trace is `{ header, events, finalText, stopped }`, with schema `awentrace/0.1`. Each recorder starts a new session and clock. The header stores initial text/selection, capture settings, environment, `performanceTimeOrigin` and `startPerformanceMs`.

| Event field | Meaning |
| --- | --- |
| `id`, `sequence` | Session-scoped ID and consecutive order, starting at 1 |
| `kind`, `payload` | Event type and its evidence |
| `elapsedMs` | Monotonic elapsed time at handler observation |
| `wallTime` | Client ISO-8601 time; subject to system-clock changes |
| `domTimeStamp` | Native timestamp, or null for generated records |
| `trusted` | Native `isTrusted`, or null for generated records |
| `defaultPrevented` | Cancellation state when observed |
| `state` | Selection, text length, revision, ASCII status, focus and scroll |

Timestamps do not guarantee millisecond accuracy, synchronization between computers or tamper resistance. Events remain in chronological order in all exports. JSONL wraps them with a header and a final-text/stop-status footer.

## Edit evidence

An `input` event carries a replacement delta: remove `removed` at `start`, then insert `inserted`. Positions use UTF-16 code units and half-open ranges. A nonchanging input has a null delta and does not increment the revision.

`beforeInputSequence` links preceding intent when available; `selectionBefore` is null without reliable evidence. Beforeinput evidence expires after the current event-loop task, and cancelled evidence is not reused. Observing beforeinput alone does not establish an edit.

When selection and text agree, the delta is anchored to that selection. Otherwise, a prefix/suffix comparison yields a reconstructable replacement labeled `text-difference`; repeated text can make the actual edit location ambiguous.

Programmatic changes observed without input events produce `checkpoint` records. Hosts should call `sync()` after setting `textarea.value`; intermediate unobserved changes cannot be recovered. Unsupported input retains its text patch and issue flags. Non-ASCII initial text is rejected.

`reconstructText` checks session IDs, sequence, revision transitions, patch contents, checkpoints and final text. It detects structural inconsistencies, not maliciously rewritten logs.

## Interaction and lifecycle

Keyboard events retain logical `key` and physical `code`; keyup links to the first matching keydown, including repeated presses. Interrupted presses are reported without inventing release times. System-reserved shortcuts may never reach the page.

Mouse/pointer pairs are separate observations, not separate user actions. With movement capture enabled, movement is unthrottled. Releases and enabled movement outside the editor are retained only for interactions that began inside it.

Clipboard text comes from browser events or the current selection. Copy/cut selections do not prove what reached the system clipboard; paste text may be unavailable. Only exposed file metadata is retained. The core does not request clipboard permissions or read arbitrary clipboard/file contents.

Focus state is resolved through the owning document and any enclosing shadow roots. Listeners never call `preventDefault()`; later application handlers may still cancel an event. Hosts control editing policy and must stop capture before unmounting the editor. Stop listeners run after native listeners are detached and the trace is marked stopped; `stop()` and `getTrace()` inside a stop callback return the completed snapshot.

Pausing preserves the session and suspends native capture and automatic synchronization. Exports retain the last captured text. The `pause` event records interrupted keys; `resume` records the suspension duration in `pausedMs`. Repeated calls are idempotent, and explicit markers remain permitted while paused.

The library does not lock the editor. Resuming after a text change adds a checkpoint with reason `resume`; stopping while paused also reconciles final text. The demo locks its editor during pause and discards the session on reset.

## Storage and analysis

Events live in memory. Hosts can persist them through `onEvent` or `subscribe`, keeping the session header, stable IDs and sequence. Page lifecycle events cannot guarantee delivery after a crash or forced termination.

Analysis should consume traces and produce separate results with algorithm versions, parameters and source event IDs. Manual recording suspension is distinct from an inferred writing pause. See the [README TODO](../README.md#todo) for planned capabilities and validation.
