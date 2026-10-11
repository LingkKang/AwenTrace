# AwenTrace

A framework-independent TypeScript library for writing activity recording in a browser textarea. Current version captures English/ASCII input and exports browser events with reconstructable text changes.

## How to Use AwenTracer

Install the package in your application:

```sh
npm install awentrace
```

Import the ESM entry point in your browser application using a bundler or an import map:

```ts
import { createTrace } from 'awentrace';

const target = document.querySelector<HTMLTextAreaElement>('#writing')!;
const recorder = createTrace({
  target,
  gzip: true, // Default; false selects uncompressed JSONL exports/streams.
  metadata: { taskId: 'task-1' },
});

// Later, when the session ends:
recorder.stop();
const blob = await recorder.exportJSONL(); // application/gzip; save as .jsonl.gz
```

The package provides ESM JavaScript and TypeScript declarations. Attach the recorder after the textarea mounts and call `stop()` before removing it. After changing `textarea.value` in application code, call `sync()`.

### API

| API | Purpose |
| --- | --- |
| `createTrace({ target, gzip?, sessionId?, metadata?, capturePointerMoves?, onEvent?, onError? })` | Start a recording; JSONL compression defaults to true. |
| `recorder.subscribe(listener)` | Receive new events; returns an unsubscribe function. |
| `recorder.mark(name, data?)` | Add an application marker. |
| `recorder.sync(reason?)` | Capture programmatic text and selection changes. |
| `recorder.getTrace()` | Get a snapshot without stopping. |
| `recorder.exportJSONL()` | Export a detached snapshot as a gzip Blob, or plain JSONL when gzip is false. |
| `recorder.streamJSONL()` | Stream all existing and future records; closes after stop. Uses the recorder's gzip option. |
| `recorder.pause()`, `recorder.resume()`, `recorder.paused` | Pause or resume capture in the same session. |
| `recorder.stop()` | End capture and return the final trace. |
| `recorder.eventCount`, `recorder.sessionId`, `recorder.stopped`, `recorder.gzip` | Read recorder status and export setting. |
| `reconstructText(trace)` | Validate changes and reconstruct the final text. |
| `applyDelta(text, delta)` | Validate and apply a text replacement. |
| `toJSON(trace, pretty?)`, `toJSONL(trace)`, `toCSV(trace)` | Export as JSON, JSONL or CSV. |
| `toJSONLStream(trace, { gzip? })`, `toJSONLBlob(trace, { gzip? })` | Export an existing trace with native gzip by default. |

See [API details and event format](docs/architecture.md#public-api) for callback behavior and trace semantics. This document is also included at `node_modules/awentrace/docs/architecture.md`.

### Offline pause analysis

Capture and analysis have separate entry points. Student pages can keep importing
only `createTrace` from `awentrace`; researcher pages or Node.js scripts can load
the DOM-free analysis module without creating a recorder:

```ts
import type { Trace } from 'awentrace';
import { analyzePauses } from 'awentrace/analysis';

function analyzeSession(trace: Trace) {
  return analyzePauses(trace, {
    thresholdMs: 2000,
    excludeHidden: true,
    excludeWindowBlur: true,
    excludeEditorBlur: false,
    // Optional: include only complete intervals within a stage/marker window.
    // range: { startMs: 1000, endMs: 60000 },
  });
}
```

The first algorithm measures intervals between **actual text-changing input
events**, including paste, cut, deletion and replacement. This is an inter-edit
measure, not a keydown-to-keydown or key-release-to-keydown measure. A duration
equal to the threshold counts as a pause. The 2000 ms default is a configurable
software default, not a validated research threshold.

Results contain `pauses`, `excludedIntervals`, `summary`, the resolved options,
source session/event information and an algorithm version. Each interval links
its bounding events, revisions and observed selections. Statistics include count,
total/mean/median/min/max duration and the pause proportion of eligible inter-edit
time. Empty means and proportions without a denominator are `null`.

Recording suspension, unobserved programmatic changes and unsupported input are
always excluded; page hiding and window blur are excluded by default. Editor blur
is optional so within-page feedback viewing can remain in the observation window.
Entire interrupted intervals are excluded, without subtracting time or stitching
fragments. Initial and trailing inactivity are not counted as complete pauses.
Analysis neither mutates the trace nor performs network/storage operations.

See [pause-analysis semantics](docs/architecture.md#pause-analysis) for validation,
range boundaries and limitations. `analyzeBursts` is not implemented yet.

### JSONL gzip and streaming

```ts
// Start consuming while recording. sink is an application-owned WritableStream.
const done = recorder.streamJSONL().pipeTo(sink);
// Later:
recorder.stop();
await done; // Includes the stop event, JSONL footer and final gzip trailer.
```

Compression uses the browser's native `CompressionStream('gzip')` with no added
dependencies. Set `gzip: false` when creating the recorder to get UTF-8 `.jsonl`
instead. Existing `toJSON`, `toJSONL` and `toCSV` functions still return plain text.
The option changes exports, not captured event data or the trace schema.

Native compression can buffer output and does not expose manual flush or compression
level settings. Streaming does not promise immediate output for every event. If
`CompressionStream` is unavailable, gzip exports fail explicitly; recording and
plain exports remain available. See [stream lifecycle and memory behavior](docs/architecture.md#jsonl-compression-and-streaming).

## What AwenTrace Records

| Stream | Recorded information |
| --- | --- |
| Keyboard | Key down/up, logical key, physical code, modifiers and repeat |
| Text input | Before/input events, insert/delete/replace changes and revisions |
| Selection | Caret position, selection range and direction |
| Mouse and pointer | Clicks, presses/releases, coordinates, pointer properties and optional movement |
| Clipboard | Copy/cut/paste, available text, MIME types and file metadata |
| Scrolling | Editor scroll position and wheel deltas |
| Environment | Focus, visibility, connectivity, resize and page lifecycle |
| Session context | Browser, viewport, editor settings, initial and final text |
| Application markers | Custom labels and JSON data |

Capture is scoped to the supplied textarea and its relevant page context. Mouse/pointer movement is disabled by default and in the demo; set `capturePointerMoves: true` to enable it.

## Development with Docker

```sh
docker compose up -d --build
docker compose exec dev npm test
docker compose exec dev npm run build
docker compose exec dev npm run test:pages
```

Open [localhost:5174](http://localhost:5174/) for the demo. Source files are mounted into the `awentrace-dev` container; dependencies and Chromium are installed there.

`npm test` runs TypeScript, unit, browser and installed-package tests. Use `npm run test:package` to check packing, installation, declarations and browser use separately. Library browser tests use a minimal textarea fixture separate from the demo. `npm run test:pages` builds the static demo and checks both project-subpath and domain-root hosting.

Use `docker compose stop` / `start` to stop or restart development, and `docker compose down` to remove the container. See [development layout](docs/architecture.md#development-layout) for source and test locations.

## Hosted Demo

A dev build demo of AwenTrace is hosted at [awentrace.lingkang.dev](https://awentrace.lingkang.dev/).

The demo supports start, pause, resume, reset, text history playback and downloads.
Its JSONL download uses gzip (`.jsonl.gz`); JSON and CSV downloads remain plain text.
Recordings stay in page memory, so download them before resetting or leaving.

## TODO

The following items are not yet supported or fully validated:

- **Browsers:** validate Firefox, Safari/WebKit and behavior across operating systems.
- **Languages and Unicode:** support non-ASCII text, IMEs/composition, grapheme-aware positions and language-aware word segmentation.
- **Editing workflows:** support and test undo/redo, drag-and-drop, autocorrection, rich text and mobile input.
- **Measurement:** evaluate timing accuracy, interrupted key sequences, clipboard/menu actions and ambiguous edit locations across browsers.
- **Persistence:** add durable storage, crash/reload recovery and long-session performance checks; explore server synchronization and cross-tab sessions.
- **Analysis:** extend inter-edit pause analysis with validated linguistic pause locations and additional measurement bases; add typing-burst analysis, revision tracking, writing summaries and fluency charts.
- **Interoperability:** explore IDFX export and compatibility with other writing-process tools.
