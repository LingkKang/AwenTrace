# AwenTrace

**A framework-independent TypeScript library for observing how browser writing unfolds.**

Version 0.1 captures English/ASCII writing in a native `<textarea>`. It records raw browser interactions alongside reconstructable text changes. It has **zero runtime dependencies** and emits ESM JavaScript and TypeScript declarations.

This is an independently designed implementation. No Inputlog, FlexKeyLogger or CyWrite code, modules or data structures are incorporated.

## Development with Docker

From the repository directory (Windows PowerShell or another terminal):

```sh
docker compose up -d --build
docker compose exec dev npm test
docker compose exec dev npm run build
```

Open **http://localhost:5174**. The development container is `awentrace-dev`. Port 5174 is bound to loopback only. Source files are bind-mounted; Linux dependencies live in a dedicated named volume. Chromium and its system dependencies are installed in the image for browser tests.

```sh
docker compose logs --tail 50 dev
docker compose stop
docker compose start
docker compose down
```

`down` removes the development container, not the source or named dependency volume. The demo keeps recordings in page memory, so export sessions before refreshing, closing or stopping development. Starting a new demo session also replaces the previous in-memory session.

Without Docker, use Node 22+ (Node 24 is used by the image):

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run dev -- --port 5174 --strictPort
```

## Use the library

Build with `npm run build`, then import the generated ESM entry point. This repository does not imply that a package has been published to npm.

```ts
import { createTrace, reconstructText, toJSONL } from './dist/index.js';

const target = document.querySelector<HTMLTextAreaElement>('#writing')!;
const recorder = createTrace({
  target,
  metadata: { taskId: 'task-1', participantId: 'anonymous-17' },
  onEvent(event) {
    // Read-only event. A host can enqueue it for its own persistence/transport.
    // Avoid synchronous network or expensive analysis inside this callback.
  },
  onError(error) { console.error(error); },
});

recorder.mark('feedback-visible', { feedbackId: 'feedback-3' });

// If application code changes textarea.value without firing input:
// recorder.sync('application-update');

const trace = recorder.stop(); // Idempotent; removes listeners.
console.assert(reconstructText(trace) === target.value);
const jsonl = toJSONL(trace);
```

For vanilla JS, omit the TypeScript generic and non-null assertion. The host can use React, Vue, Svelte or no framework: attach after the textarea mounts and call `stop()` before removing it. The library never renders UI, modifies the editor, disables browser actions or sends data over a network.

### API

| API | Purpose |
| --- | --- |
| `createTrace({ target, sessionId?, metadata?, capturePointerMoves?, onEvent?, onError? })` | Start a new recording. A second active recorder on the same textarea is rejected. |
| `recorder.subscribe(listener)` | Receive future events; returns an unsubscribe function. |
| `recorder.mark(name, data?)` | Add a research/task marker on the same timeline as input. |
| `recorder.sync(reason?)` | Observe programmatic text changes and selection changes; does nothing while paused. |
| `recorder.getTrace()` | Return a detached snapshot, synchronizing current text unless paused. Does not stop recording. |
| `recorder.pause()`, `recorder.resume()`, `recorder.paused` | Suspend/resume native capture within the same session; retain the timeline and existing records. |
| `recorder.stop()` | Synchronize, record final text, detach listeners, return a snapshot. |
| `recorder.eventCount`, `recorder.sessionId`, `recorder.stopped` | Current recorder status. |
| `reconstructText(trace)` | Validate ordering, session IDs, revisions and text patches, then reconstruct final text. |
| `applyDelta(text, delta)` | Apply a replacement after validating its location and removed text. |
| `toJSON(trace, pretty?)`, `toJSONL(trace)`, `toCSV(trace)` | Export. JSON/JSONL include complete session context; CSV is a raw event table. |

Options `metadata` and marker `data` must be JSON-compatible. Event callbacks are synchronous and receive deeply frozen objects; callback errors are sent to `onError` (or the console) and do not stop capture. Snapshot/export operations clone the full trace and should not run on every event in a long session.

## What v0.1 records

| Stream | Evidence |
| --- | --- |
| Keyboard | `keydown`, `keyup`, key, physical code, location, repeat, modifiers, composition flag, associated keydown sequence |
| Text input | `beforeinput`, `input`, browser input type/data, observed selections, insert/delete/replace delta, revision chain |
| Selection | Caret and range changes, direction, previous/current positions, observing event |
| Mouse | Down/up, movement, enter/leave, click/double-click/auxiliary-click/context menu, buttons, coordinates, modifiers |
| Pointer | Down/up/move/cancel, pointer ID/type, pressure, dimensions, tilt, twist and coordinates |
| Clipboard | Copy/cut/paste events, selected text, available pasted plain text, MIME types, file metadata |
| Scrolling | Textarea scroll position and wheel deltas/mode |
| Environment | Editor/window focus/blur, page visibility, online/offline, resize, pagehide/pageshow |
| Context | Browser/language/timezone/viewport/screen metadata, editor settings, initial and final text |
| Research markers | Application-defined labels and JSON data |

Mouse/pointer movement capture is disabled by default; set `capturePointerMoves: true` to enable both movement streams without throttling. The demo keeps this option disabled. Other pointer/mouse events remain enabled. A physical mouse action often produces both pointer and mouse events: these are distinct observations, **not two separate user actions**. Downstream analysis must choose or normalize a stream.

Capture is scoped to the supplied editor. Mouse/pointer releases and movements outside it are retained only while completing an interaction that started inside it. Unrelated fields, browser chrome, other sites and other applications are outside the scope. The library does not request clipboard permissions or read the system clipboard independently. For copy/cut, `textSource: 'selection'` describes selected text, not proof of what another handler ultimately wrote to the clipboard. For paste, text comes from the browser's clipboard event if exposed.

## Scope and measurement limits

- The validated target is desktop Chromium and plain ASCII editing (typing, selection replacement, deletion, copy/cut/paste, navigation). Other browsers require separate validation.
- Undo/redo, text drag-and-drop, autocorrection, IMEs, non-ASCII writing, rich text and mobile input are not supported workflows in v0.1. They are not blocked: observable results are retained with `supported: false` and issue flags so the trace does not silently drift. Non-ASCII initial text is rejected.
- Programmatic `.value` changes do not normally emit input events. Call `sync()` immediately after host updates. The recorder also checks at observed interaction boundaries, export and stop; it cannot recover intermediate script changes it never observed.
- Positions are UTF-16 code units and ranges are half-open. For supported ASCII text, code units, code points and characters coincide. No linguistic character/word interpretation is implied outside this scope.
- `elapsedMs` uses a monotonic browser clock within this recorder's lifetime. `wallTime` can jump with the system clock. `domTimeStamp` is preserved separately. Millisecond units do not establish millisecond measurement accuracy or synchronization with another computer.
- Lost key releases at blur/visibility/pagehide/stop are reported as interrupted keys. No duration is fabricated. Operating-system-reserved shortcuts may never reach the page.
- Raw browser events include `trusted` and the `defaultPrevented` value at observation time. Most handlers run in the capture phase; later application handlers can still cancel default actions. A beforeinput does not prove an edit occurred.
- A text-difference fallback is exact for reconstruction but can be ambiguous about edit location in repeated text; it is explicitly distinguished from selection-based evidence.
- Data is stored in memory. There is no built-in crash recovery, IndexedDB, server upload, automatic storage rotation or cross-tab merging. Hosts can persist events via `onEvent` plus session metadata. Pagehide delivery is not guaranteed after a process crash or forced termination.
- This is a capture library, not a calibrated research instrument or a complete Inputlog-compatible analysis suite. Pause/burst interpretation, word segmentation, revision classifications and IDFX export are future work.

## Verification

`npm test` runs strict TypeScript checks, deterministic text reconstruction/export tests (including randomized ASCII edits), and real Chromium interaction tests. Browser coverage includes ordinary typing, actual clipboard shortcuts, selection, pointer events, unsupported-operation flags, capture isolation, lifecycle, exports and cleanup. Synthetic events are explicitly distinguished in tests for fallback paths.

GitHub Actions runs the same checks on every push, pull request update and merge queue candidate, using Node 24 and Chromium on Ubuntu. Merging a pull request triggers another run through the resulting push. The workflow can also be started manually from the Actions tab. Failed browser tests retain screenshots and Playwright traces as a workflow artifact for 7 days. To reproduce CI in an isolated container, run `docker compose run --rm -e CI=true dev npm test`.

Browser tests are split into two Playwright projects:

- `library`: capture/lifecycle tests against `tests/browser/fixtures/editor.html`, a standalone textarea fixture with a test-only API bridge. These tests do not load the demo.
- `demo`: 2 end-to-end tests using visible controls and downloaded files to verify session start/pause/resume/reset, counts/history and complete JSON/JSONL/CSV exports. The demo exposes no test globals.

Run either suite with `npm run test:browser -- --project=library` or `npm run test:browser -- --project=demo`. The default `npm test` runs both.

See [architecture and event format](docs/architecture.md) for the schema and extension boundary. The demo provides a writing area, start/pause/resume/reset controls, character and whitespace-separated word counts, the latest 200 detailed records, text history and JSON/JSONL/CSV downloads. Pausing locks the demo editor and preserves the session. Reset discards the session and clears the UI; download first to keep its data.

## Hosted demo

The demo is published at [awentrace.lingkang.dev](https://awentrace.lingkang.dev/). The [GitHub Pages address](https://lingkkang.github.io/AwenTrace/) redirects to the configured custom domain.

- `npm run build` builds only the library into `dist/`.
- `npm run build:demo` builds the static demo into `demo-dist/`, with relative asset paths configured in `vite.demo.config.ts` to support both project subpaths and custom-domain roots.
- `npm run preview:demo -- --host 0.0.0.0 --port 4174` previews that build at `http://localhost:4174/` (publish the port separately if running inside Docker).
- `npm run test:pages` builds the demo and runs its end-to-end tests against static previews at both the project base path and the domain root.

Two independent workflows form the deployment pipeline. `Tests` (`.github/workflows/tests.yml`) runs `npm test` and `npm run test:pages` on pushes, PR updates, merge queue candidates and manual runs. Successful pushes to `master` (including merged PRs), or manual Tests runs on `master`, save the tested demo as a commit-named artifact.

`Pages` (`.github/workflows/pages.yml`) listens for completed `Tests` runs on `master` and deploys only if the originating run succeeded and came from this repository's push or manual event. It downloads the artifact by the originating run ID and commit SHA, then publishes those exact static files without checking out or rebuilding newer code. Failed or cancelled tests and PR/merge queue runs never deploy. To retry testing and deployment, rerun `Tests`; Pages has no standalone manual trigger that bypasses testing. Pages uses the `github-pages` environment. The custom domain is configured in the repository Pages settings.

Generated site files are ignored by Git and excluded from Docker's build context and the npm package. Only the static build is uploaded; the development server, test fixture and participant recordings are not deployed.


## License

MIT. See [LICENSE](LICENSE).
