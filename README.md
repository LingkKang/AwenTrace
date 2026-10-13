# AwenTrace

A framework-independent TypeScript library for recording English writing in browser textareas, with reconstructable text changes and JSON, JSONL and CSV exports.

## Usage

Install the package in your application:

```sh
npm install awentrace
```

Import in your browser application using a bundler or an import map:

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

The package provides ESM JavaScript and TypeScript declarations.
Attach the recorder after the textarea mounts and call `stop()` before removing it.
After changing `textarea.value` in application code, call `sync()`.

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

See [API details and event format](docs/architecture.md#public-api), also included in the npm package.

### Unicode text and composition

Unicode text, including Chinese, punctuation and emoji, can be recorded and reconstructed without normalization, whether present initially, typed or pasted.
Trace positions use UTF-16 offsets; Unicode content does not invalidate later English edits.

Browser-exposed composition events and interruptions are recorded.
Their text changes remain reconstructable, with uncertain edits flagged.
Capture is limited to what the browser exposes; the measurement scope remains English writing.
See [composition evidence and limits](docs/architecture.md#composition-evidence).

### JSONL gzip and streaming

```ts
// Start consuming while recording. sink is an application-owned WritableStream.
const done = recorder.streamJSONL().pipeTo(sink);
// Later:
recorder.stop();
await done; // Includes the stop event, JSONL footer and final gzip trailer.
```

Gzip uses native `CompressionStream` with no added dependencies and may buffer output.
Set `gzip: false` for plain JSONL, including browsers without native gzip.
`toJSON`, `toJSONL` and `toCSV` always return plain text.
See [stream lifecycle and browser requirements](docs/architecture.md#jsonl-compression-and-streaming).

## What AwenTrace Records

| Stream | Recorded information |
| --- | --- |
| Keyboard | Key down/up, logical key, physical code, modifiers and repeat |
| Text input | Before/input events, insert/delete/replace changes and revisions |
| Composition | Browser-exposed start, updates, end and interrupted boundaries |
| Selection | Caret position, selection range and direction |
| Mouse and pointer | Clicks, presses/releases, coordinates, pointer properties and optional movement |
| Clipboard | Copy/cut/paste, available text, MIME types and file metadata |
| Scrolling | Editor scroll position and wheel deltas |
| Environment | Focus, visibility, connectivity, resize and page lifecycle |
| Session context | Browser, viewport, editor settings, initial and final text |
| Application markers | Custom labels and JSON data |

Capture is scoped to the supplied textarea and its relevant page context.
Mouse/pointer movement is disabled by default and in the demo; set `capturePointerMoves: true` to enable it.

## Development with Docker

```sh
docker compose up -d --build
docker compose exec dev npm test
docker compose exec dev npm run build
docker compose exec dev npm run test:pages
```

Open [localhost:5174](http://localhost:5174/) for the demo.
`npm test` checks types, unit behavior, Chromium and the installed package; `test:pages` verifies static hosting at root and project-subpath URLs.
See [development layout](docs/architecture.md#development-layout).

## Hosted Demo

[awentrace.lingkang.dev](https://awentrace.lingkang.dev/) provides session controls, text history and downloads.
Recordings stay in page memory; download before resetting or leaving.
Counts use grapheme clusters and English word segmentation, with labeled fallbacks on older browsers.
See [counting rules](docs/architecture.md#demo-text-counts).

## TODO

The following items are not yet supported or fully validated:

- **Compatibility:** validate more browsers, operating systems and mobile input.
- **Editing workflows:** support and test undo/redo, drag-and-drop, native autocorrection and rich text.
- **Measurement:** evaluate timing accuracy, interrupted key sequences, clipboard/menu actions and ambiguous edit locations across browsers.
- **Persistence:** add durable storage, crash/reload recovery and long-session performance checks; explore server synchronization and cross-tab sessions.
- **Analysis:** add writing summaries, pause/burst analysis, revision tracking and language-specific segmentation.
- **Interoperability:** explore IDFX export and compatibility with other writing-process tools.
