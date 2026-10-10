# AwenTrace

A framework-independent TypeScript library for writing activity recording in a browser textarea. Current version captures English/ASCII input and exports browser events with reconstructable text changes.

## How to Use AwenTracer

Install the package in your application:

```sh
npm install awentrace
```

Import the ESM entry point in your browser application using a bundler or an import map:

```ts
import { createTrace, toJSONL } from 'awentrace';

const target = document.querySelector<HTMLTextAreaElement>('#writing')!;
const recorder = createTrace({
  target,
  metadata: { taskId: 'task-1' },
});

// Later, when the session ends:
const trace = recorder.stop();
const jsonl = toJSONL(trace);
```

The package provides ESM JavaScript and TypeScript declarations. Attach the recorder after the textarea mounts and call `stop()` before removing it. After changing `textarea.value` in application code, call `sync()`.

### API

| API | Purpose |
| --- | --- |
| `createTrace({ target, sessionId?, metadata?, capturePointerMoves?, onEvent?, onError? })` | Start a recording on the textarea. |
| `recorder.subscribe(listener)` | Receive new events; returns an unsubscribe function. |
| `recorder.mark(name, data?)` | Add an application marker. |
| `recorder.sync(reason?)` | Capture programmatic text and selection changes. |
| `recorder.getTrace()` | Get a snapshot without stopping. |
| `recorder.pause()`, `recorder.resume()`, `recorder.paused` | Pause or resume capture in the same session. |
| `recorder.stop()` | End capture and return the final trace. |
| `recorder.eventCount`, `recorder.sessionId`, `recorder.stopped` | Read recorder status. |
| `reconstructText(trace)` | Validate changes and reconstruct the final text. |
| `applyDelta(text, delta)` | Validate and apply a text replacement. |
| `toJSON(trace, pretty?)`, `toJSONL(trace)`, `toCSV(trace)` | Export as JSON, JSONL or CSV. |

See [API details and event format](docs/architecture.md#public-api) for callback behavior and trace semantics. This document is also included at `node_modules/awentrace/docs/architecture.md`.

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

The demo supports start, pause, resume, reset, text history playback and downloads. Recordings stay in page memory, so download them before resetting or leaving.

## TODO

The following items are not yet supported or fully validated:

- **Browsers:** validate Firefox, Safari/WebKit and behavior across operating systems.
- **Languages and Unicode:** support non-ASCII text, IMEs/composition, grapheme-aware positions and language-aware word segmentation.
- **Editing workflows:** support and test undo/redo, drag-and-drop, autocorrection, rich text and mobile input.
- **Measurement:** evaluate timing accuracy, interrupted key sequences, clipboard/menu actions and ambiguous edit locations across browsers.
- **Persistence:** add durable storage, crash/reload recovery, incremental export and long-session performance checks; explore server synchronization and cross-tab sessions.
- **Analysis:** add writing summaries, pause and typing-burst analysis, revision tracking and fluency charts.
- **Interoperability:** explore IDFX export and compatibility with other writing-process tools.
