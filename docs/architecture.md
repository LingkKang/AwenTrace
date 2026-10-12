# AwenTrace architecture

## Development layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Public ESM entry point |
| `src/types.ts` | Versioned event types and public interfaces |
| `src/recorder.ts` | Browser listeners, event ordering and lifecycle |
| `src/text.ts` | Content checks, UTF-16 edit deltas and reconstruction |
| `src/export.ts` | JSON, JSONL and CSV serialization |
| `src/compression.ts` | Native gzip, pull-based JSONL streams and Blob exports |
| `index.html`, `demo/` | Demo markup, controls and styles |
| `tests/core.test.mjs` | Text reconstruction and export tests |
| `tests/compression.test.mjs` | Compression, stream backpressure, cancellation and cleanup tests |
| `tests/package.test.mjs` | Packed files, installation, declarations and browser consumption |
| `tests/browser/fixtures/` | Minimal textarea fixture and test-only API bridge |
| `tests/browser/recorder.spec.ts` | Library browser tests |
| `tests/browser/unicode.spec.ts` | Unicode edits/exports and composition boundary tests |
| `tests/browser/demo.spec.ts` | Demo controls, history and download tests |

The core has no runtime dependencies. It observes the editor without rendering UI, changing text or sending data over a network. Importing it in Node is safe; creating a recorder requires a browser textarea.

The demo and fixture consume the public API separately. Only the fixture exposes `window.awenTest`; the demo has no test bridge. Playwright gives each test an isolated browser context.

`npm run build` emits only the library into `dist/`. `npm run build:demo` emits the static site into `demo-dist/`, using relative asset paths. The npm package includes `src/` for declaration-map navigation, the changelog and this architecture document. Neither the demo nor the tests are included. Generated builds and test results are ignored by Git.

Compression unit tests cover format fidelity, pull behavior and subscription cleanup.
Library browser tests cover native compression and its integration with recorder
lifecycle; demo tests verify download names, file contents and UI behavior. Package
tests check public imports/types and one installed-browser gzip export. Static-site
tests reuse the demo scenarios under root and project-subpath hosting to catch
asset-routing differences.

Run one browser suite with `npm run test:browser -- --project=library` or `--project=demo`. To reproduce the full Tests workflow in a separate container, run `docker compose run --rm -e CI=true dev sh -c "npm test && npm run test:pages"`.

## Public API

See the [API reference](../README.md#api) for functions and recorder methods.

A supplied `sessionId` must be unique across recordings. Generated IDs use `crypto.randomUUID()`, with a UUID v4 fallback based on `crypto.getRandomValues()` for HTTP origins. Metadata and marker data must be JSON-compatible.

Callbacks run synchronously and receive deeply frozen events. Callback errors go to `onError` or the console without stopping capture. Keep expensive work out of callbacks; snapshots and exports clone the complete trace.

## Session and event format

A trace is `{ header, events, finalText, stopped }`, with schema `awentrace/0.1`. Each recorder starts a new session and clock. The header stores initial text/selection, capture settings, environment, `performanceTimeOrigin` and `startPerformanceMs`.

Current capture emits `supportedInput: 'unicode'`; older traces used `'ascii'`.
The additive composition events/fields retain the existing reconstruction schema:
only input/checkpoint deltas change the reconstructed text. Readers should tolerate
unknown event kinds. Composition fields are optional in the public types because
older traces lack them; absence is not evidence that no composition occurred.
`recorderVersion` follows the package release version; changes under Unreleased
are development changes until the next version is assigned.

| Event field | Meaning |
| --- | --- |
| `id`, `sequence` | Session-scoped ID and consecutive order, starting at 1 |
| `kind`, `payload` | Event type and its evidence |
| `elapsedMs` | Monotonic elapsed time at handler observation |
| `wallTime` | Client ISO-8601 time; subject to system-clock changes |
| `domTimeStamp` | Native timestamp, or null for generated records |
| `trusted` | Native `isTrusted`, or null for generated records |
| `defaultPrevented` | Cancellation state when observed |
| `state` | Selection, UTF-16 text length, revision, descriptive ASCII status, observed composition state, focus and scroll |

Timestamps do not guarantee millisecond accuracy, synchronization between computers or tamper resistance. Events remain in chronological order in all exports. JSONL wraps them with a header and a final-text/stop-status footer.

## Edit evidence

An `input` event carries a replacement delta: remove `removed` at `start`, then insert `inserted`. Positions use UTF-16 code units and half-open ranges. A nonchanging input has a null delta and does not increment the revision.

`beforeInputSequence` links preceding intent when available; `selectionBefore` is null without reliable evidence. Beforeinput evidence expires after the current event-loop task, and cancelled evidence is not reused. Observing beforeinput alone does not establish an edit.

When selection and text agree without splitting a surrogate pair, the delta is anchored to that selection. Otherwise, a prefix/suffix comparison yields a reconstructable replacement labeled `text-difference`; repeated text can make the actual edit location ambiguous. Inferred replacement boundaries expand as needed to avoid splitting valid surrogate pairs. The observed selections remain unchanged. This is code-point boundary protection, not grapheme segmentation: browsers can legitimately edit combining marks or parts of an emoji sequence.

Programmatic changes observed without input events produce `checkpoint` records. Hosts should call `sync()` after setting `textarea.value`; intermediate unobserved changes cannot be recovered. Unsupported input retains its text patch and issue flags. Initial text may contain Unicode. No normalization, punctuation replacement or language filtering is applied. The stored value is the textarea's DOM value, including any line-ending processing already performed by the browser. Even unpaired UTF-16 surrogates are preserved; JSON serialization escapes them before UTF-8 transport.

`supported` describes a supported non-composition edit family, not language,
keystroke completeness or suitability for every analysis. Ordinary insertion,
paste, `insertReplacementText` and supported deletions are not rejected because
of Unicode content. Missing beforeinput and inferred locations remain separate
issue flags. Unknown input types and external checkpoints remain unsupported.

`reconstructText` checks session IDs, sequence, revision transitions, patch contents, checkpoints and final text. It detects structural inconsistencies, not maliciously rewritten logs.

## Composition evidence

The recorder observes browser composition events without controlling the system
IME. `compositionstart`, `compositionupdate` and `compositionend` payloads contain
`data`, the observed selection and `startSequence`. The latter links to the start
event, or is null when the start was not observed. Updates may precede a DOM edit;
composition events themselves never apply text deltas. Empty end data is recorded
as observed, not interpreted as proof of cancellation.

For edit evidence, `nativeComposing` preserves the browser's `isComposing` value
(null for checkpoints). `composing` also accounts for a tracked composition or a
composition input type. `compositionStartSequence` supplies the observed start
link when available. `state.composing` describes the currently tracked session.
Composition edits carry `composition-out-of-scope` and `supported: false` while
their exact text patches remain reconstructable.

The final input can occur before or after `compositionend`. After an end event,
the recorder conservatively flags edits in the remainder of that task with
`composition-boundary`. At a zero-delay timer boundary it reconciles a changed
value with a checkpoint if no input captured it, then clears the boundary. A fresh
non-composing keydown also clears the tail after reconciliation. This is a bounded
observation heuristic, not a universal IME commit detector: later-task commits
without composition indicators cannot be reliably identified. Consumers must
retain the raw composition boundaries rather than treating `supported` alone as
proof that an interval is suitable for pause or keystroke analysis.

Pause, stop, editor/window blur, hidden visibility, pagehide or a new start before
the previous end emit `compositioninterrupted` for an active tracked composition.
Its `reason` and `startSequence` mark lost continuity; no synthetic compositionend
or commit is emitted. Tracking is cleared so unrelated future edits are not
permanently marked unsupported. Native composing flags and later updates still
identify exposed continuation. While recording is paused, native composition
events are ignored along with other native events. Stopping during composition
retains the textarea's current, possibly provisional text and its interruption.

Browser tests cover real Unicode clipboard/edit/export paths and synthetic
composition ordering, cancellation, missing starts and lifecycle interruption.
Synthetic tests validate recorder behavior, not real OS input methods. Chinese,
Japanese, Korean, dead-key and mobile IME compatibility still needs a selected
browser/OS/input-method validation matrix. Analysis should treat these boundaries
locally and never exclude later English editing merely because text contains
Unicode. No language-specific analysis is implemented in the capture entry.

## Interaction and lifecycle

Keyboard events retain logical `key` and physical `code`; keyup links to the first matching keydown, including repeated presses. Interrupted presses are reported without inventing release times. System-reserved shortcuts may never reach the page.

Mouse/pointer pairs are separate observations, not separate user actions. With movement capture enabled, movement is unthrottled. Releases and enabled movement outside the editor are retained only for interactions that began inside it.

Clipboard text comes from browser events or the current selection. Copy/cut selections do not prove what reached the system clipboard; paste text may be unavailable. Only exposed file metadata is retained. The core does not request clipboard permissions or read arbitrary clipboard/file contents.

Focus state is resolved through the owning document and any enclosing shadow roots. Listeners never call `preventDefault()`; later application handlers may still cancel an event. Hosts control editing policy and must stop capture before unmounting the editor. Stop listeners run after native listeners are detached and the trace is marked stopped; `stop()` and `getTrace()` inside a stop callback return the completed snapshot.

Pausing preserves the session and suspends native capture and automatic synchronization. Exports retain the last captured text. The `pause` event records interrupted keys; `resume` records the suspension duration in `pausedMs`. Repeated calls are idempotent, and explicit markers remain permitted while paused.

The library does not lock the editor. Resuming after a text change adds a checkpoint with reason `resume`; stopping while paused also reconciles final text. The demo locks its editor during pause and discards the session on reset.

## Demo text counts

Character counts use grapheme clusters and word counts use English-locale
`Intl.Segmenter` word-like segments: contractions stay together; hyphenated words
can have multiple segments. These are descriptive counts, not multilingual
linguistic analysis. Browsers without `Intl.Segmenter` display explicitly labeled
code-point and whitespace-token counts instead; trace offsets do not change.

## Storage and analysis

Events live in memory. Hosts can persist them through `onEvent` or `subscribe`, keeping the session header, stable IDs and sequence. Page lifecycle events cannot guarantee delivery after a crash or forced termination.

Analysis should consume traces and produce separate results with algorithm versions, parameters and source event IDs. Manual recording suspension is distinct from an inferred writing pause. See the [README TODO](../README.md#todo) for planned capabilities and validation.

## JSONL compression and streaming

`createTrace({ target, gzip: true })` is the default. `recorder.gzip` reports the
fixed export setting. This transport setting is not written into the trace header
and does not change capture or reconstruction. `gzip: false` disables compression
for both recorder export methods. No third-party compression library is installed.

- `recorder.exportJSONL()` synchronously captures a detached snapshot, then returns
  a `Promise<Blob>`. A recording or paused session gets a complete snapshot footer
  with `stopped: false`; it does not wait for or stop the session. Later events
  cannot change this export. Gzip uses `application/gzip` and the `.jsonl.gz`
  suffix; plain output uses `application/x-ndjson;charset=utf-8` and `.jsonl`.
- `recorder.streamJSONL()` returns a fresh `ReadableStream<Uint8Array>` from the
  session's beginning, including existing events. It then follows future events,
  including pause/resume, until `stop()` emits its event and final footer. Pausing
  keeps the stream open. Called after stop, it emits the complete session and
  closes. Each stream is independent; no automatic network requests are made.
- `toJSONLStream(trace, { gzip? })` and `toJSONLBlob(trace, { gzip? })` operate on a
  supplied snapshot, default to gzip, and finish without waiting for a recorder.
  Do not mutate that trace until consumption completes. `toJSONL(trace)` remains
  a synchronous uncompressed string export for compatibility.

The compression module reads one JSONL record at a time as the consumer pulls.
Capture callbacks only wake a waiting reader; they do not serialize records or
compress them. Live streams use a cursor over the recorder's existing frozen
events, so a slow sink creates no second unbounded event queue. The recorder still
retains the complete event history, and Blob export buffers the final file. One
large event/metadata record is still encoded as one string/byte chunk. This is not
durable storage, a bounded-history recorder, or an automatic upload mechanism.

Consume a live stream concurrently with recording; do not await its completion
before stopping the recorder. For example:

```ts
const abort = new AbortController();
const completion = recorder.streamJSONL().pipeTo(sink, { signal: abort.signal });
// When the session finishes:
recorder.stop();
await completion;
// Alternatively, abort.abort() cancels only this stream; handle completion's rejection.
```

Cancellation, sink abort and serialization errors release the stream subscription
and pending reader. They do not stop recording or affect other streams. Cancel
unused live streams to release their subscription. Reentrant callbacks that stop
the recorder retain event order and exactly one footer. Native gzip errors reach
the stream consumer or export Promise rather than the recorder's `onError` hook.

Compression is created lazily when exporting or opening a stream. Missing native
`CompressionStream` causes an explicit export error; it never silently writes
plain bytes with a gzip name, and does not prevent recording. Use `gzip: false`
or plain JSON/CSV on unsupported browsers. Importing the library in Node remains
safe without browser globals. Only compression methods need the Web Streams,
TextEncoder, Response (Blob helper), and native CompressionStream APIs.

`CompressionStream('gzip')` emits a standard gzip stream that can be read by
`DecompressionStream('gzip')` or standard gzip tools. Native compression chooses
its own level and buffering; there is no public manual-flush control. Output can
arrive before stop for sufficiently large input, but per-event delivery latency
is not guaranteed. Await normal stream completion to receive/check the gzip
trailer. Cancellation or a page crash may leave an incomplete stream. Consumers
should also require the JSONL footer and handle records split across arbitrary
network chunks. No new binary format or custom framing is introduced.
