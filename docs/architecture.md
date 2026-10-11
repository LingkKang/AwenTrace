# AwenTrace architecture

## Development layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Public ESM entry point |
| `src/types.ts` | Versioned event types and public interfaces |
| `src/recorder.ts` | Browser listeners, event ordering and lifecycle |
| `src/text.ts` | ASCII checks, edit deltas and reconstruction |
| `src/export.ts` | JSON, JSONL and CSV serialization |
| `src/compression.ts` | Native gzip, pull-based JSONL streams and Blob exports |
| `src/analysis/index.ts` | Independent `awentrace/analysis` public entry point |
| `src/analysis/pauses.ts`, `types.ts`, `timeline.ts` | Pure pause analysis, result contracts and shared timeline validation |
| `index.html`, `demo/` | Demo markup, controls and styles |
| `tests/core.test.mjs` | Text reconstruction and export tests |
| `tests/compression.test.mjs` | Compression, stream backpressure, cancellation and cleanup tests |
| `tests/analysis.test.mjs` | Pause measurements, interruption/range rules and evidence validation |
| `tests/package.test.mjs` | Packed files, installation, declarations and browser consumption |
| `tests/browser/fixtures/` | Minimal textarea fixture and test-only API bridge |
| `tests/browser/recorder.spec.ts` | Library browser tests |
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

Analysis consumes traces and produces separate results with algorithm versions,
parameters and source event IDs. The package exports `awentrace/analysis`
independently; the root capture entry never imports or re-exports analysis code.
Analysis modules only depend on data types and DOM-free text/timeline helpers,
not the recorder or export/compression pipeline. There are no runtime dependencies,
DOM calls, network requests, or implicit persistence. Future burst/revision modules
can be added behind this entry without growing the capture dependency graph.

### Pause analysis

`analyzePauses(trace, options?)` returns a detached `PauseAnalysis` with algorithm
`awentrace/pause-analysis`, algorithm version `1`, and basis `text-change`.
It accepts a complete `Trace` object, including a live snapshot with `stopped: false`.
Decode/import exported data into that trace shape before analysis; this API does
not parse JSONL or gzip. Analysis uses captured `elapsedMs`, never `wallTime`,
`domTimeStamp`, server receipt times or the current clock.

An anchor is an `input` event with a non-null text delta. Consecutive anchors form
candidate intervals. Paste, cut, deletion and replacement are edits; keyboard,
pointer, selection, marker and nonchanging input events do not reset the interval.
Consequently a pause here means absence of observed text changes, not absence of
all interaction, and does not establish a cognitive state. This is not an
implementation of Inputlog's measurement algorithms or linguistic pause categories.

Options and boundaries:

- `thresholdMs` defaults to 2000; it must be finite and strictly positive.
  Eligible intervals with duration **>=** this threshold are returned in `pauses`.
- `range: { startMs, endMs }` uses session-relative milliseconds and defaults to
  `[0, last captured event time]`. Bounds must be finite and satisfy
  `0 <= startMs <= endMs`. Both anchor times must lie within the range, inclusively.
  Intervals crossing a range boundary are omitted, not clipped. The full trace is
  still validated and scanned, so an earlier blur or suspension remains effective.
  Hosts may use marker times to specify a stage; markers do not split intervals
  automatically. Initial latency and trailing inactivity lack two edit anchors
  and are never inferred as complete pauses, even in stopped traces.
- `excludeHidden` and `excludeWindowBlur` default to true. Hidden visibility or a
  pagehide/pageshow gap excludes an interval; window focus/blur is tracked
  independently. The header supplies initial visibility; initial window focus is
  unknown, and only observed window transitions are used. Restored visibility
  alone does not close a pagehide gap. Missing recovery events are not invented.
- `excludeEditorBlur` defaults to false; enabling it excludes intervals that
  contain an event whose editor state is unfocused. An editor losing focus does
  not imply that the participant left the page: they may be reading feedback.
- A recording `pause`/`resume`, a text-changing `checkpoint`, or unsupported input
  always excludes the affected interval. A checkpoint cannot reveal the timing of
  intermediate unobserved edits. An unsupported text-changing input is still an
  anchor and excludes both adjacent intervals; unsupported nonchanging input
  excludes its containing interval. These exclusions cannot be disabled.

Exclusion evidence is retained across each entire candidate interval, including
its endpoints. Reasons accumulate without double-counting overlapping states;
an interrupted interval is excluded as a whole. We do not subtract the off-page
duration to invent a shorter continuous pause. `excludedIntervals` contains all
excluded in-range candidates, including those shorter than the threshold. Reasons
are machine-readable and deterministically ordered. Recording suspension is a
capture gap and must not be used to mark a participant's ordinary writing pause.

Each interval preserves start/end event IDs and sequences, elapsed times,
duration, boundary revisions, the selection after the preceding edit and the
selection before the following edit (null if unavailable). Positions retain the
trace's UTF-16 code-unit convention and refer to their respective text versions;
no word/sentence location or unobserved caret is inferred. Raw events retain
additional evidence such as inferred edit locations, input types and markers.

`summary` reports pause count and total/mean/median/min/max durations, all eligible
interval counts/durations, and excluded interval counts/durations. `pauseRatio`
is `totalDurationMs / eligibleDurationMs`, **not** a proportion of the entire task
or recording duration. With no pauses, total/count are zero and distribution
statistics are null. With no positive eligible duration, the proportion is null.

Validation calls `reconstructText` to verify session IDs, sequence, revisions,
patch contents and final text; it also rejects missing/duplicate event IDs and
negative, nonfinite or decreasing elapsed timestamps. Equal timestamps are valid.
It never sorts, repairs, mutates or silently discards corrupt evidence. This is
structural validation, not a clock-accuracy or tamper-resistance guarantee. Input
support retains the recorder's current ASCII limitations. Runtime is linear in
the event scan plus sorting pause durations for the median and existing text
reconstruction costs. Results record the source event count and stopped state;
retain the original trace alongside them for reproducibility.

Package tests verify the installed analysis subpath and its TypeScript types,
analyze a real browser recording, and inspect bundled module graphs to ensure
capture never includes analysis and analysis never includes the recorder or gzip.
See the [README TODO](../README.md#todo) for remaining analysis capabilities.

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
