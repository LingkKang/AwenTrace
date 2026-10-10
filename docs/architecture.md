# AwenTrace 0.1 architecture

## Boundaries

The core is an editor-scoped observer. It has no UI-framework imports, no runtime packages and no backend dependency. The Vite demo and Playwright tests are development consumers, not dependencies of the built library. Importing the ESM entry point is safe in Node; creating a recorder requires a browser textarea.

- `types.ts`: versioned event contract and public API.
- `recorder.ts`: browser listeners, ordered events, selection evidence and lifecycle.
- `text.ts`: ASCII checks, replacement derivation, patch validation and reconstruction.
- `export.ts`: serialization only; no implicit analysis or network activity.

Capture and analysis are separate. Future pause/burst analyzers should consume immutable traces and return a separate result containing their own algorithm version, parameters and source event IDs. They should never rewrite the raw trace. Feedback presentation can be associated with writing using `mark()` without introducing platform-specific feedback concepts into this library.

## Demo and browser-test isolation

The demo markup lives in the root `index.html`; `demo/main.ts` handles session controls and downloads, and `demo/style.css` contains its styles. It consumes only the public `src/index.ts` API and does not expose a recorder on `window`.

Library browser tests use `tests/browser/fixtures/editor.html` and `editor.ts`: a textarea and a test-only `window.awenTest` bridge that imports the public library entry point directly. No demo scripts, styles or controls are involved. `recorder.spec.ts` belongs to Playwright's `library` project; `demo.spec.ts` belongs to the `demo` project and checks visible UI behavior and downloaded data.

Both projects share the Vite development server, but each test gets an isolated browser context. Library builds still include only `src/`, and npm package contents exclude the demo and test fixtures.

## Session and event format

The canonical export is `{ header, events, finalText, stopped }` with schema `awentrace/0.1`. Each recorder creation starts a new session and monotonic clock. A host-supplied `sessionId` must be unique across its recordings; otherwise an ID is generated. There is no implicit resume across reloads.

Each event carries:

| Field | Semantics |
| --- | --- |
| `id` | Session ID and sequence, useful for a host's idempotent persistence |
| `sequence` | Strictly increasing observed order, starting at 1 |
| `kind`, `payload` | Discriminated event-specific evidence |
| `elapsedMs` | `performance.now()` minus recorder start; handler observation time |
| `wallTime` | Client ISO-8601 wall time |
| `domTimeStamp` | Raw native event timestamp, or null for generated records |
| `trusted` | Native `isTrusted`, or null for generated records |
| `defaultPrevented` | Native cancellation state at observation, not eventual cancellation |
| `state` | Observed selection, text length, revision, ASCII status, focus and scroll |

The header records `performanceTimeOrigin`, `startPerformanceMs`, initial text/selection, capture settings and environment. Client timestamps are observations and cannot establish server authority or tamper resistance.

## Edit evidence

An `input` event also carries normalized edit evidence. `beforeInputSequence` links the observed intent to the resulting edit when available; `selectionBefore` is null if it was not observed reliably. Beforeinput evidence expires after the current event-loop task and cancelled evidence is not reused. Input without beforeinput is still retained.

An edit delta is one replacement: remove the exact `removed` string at `start`, then insert `inserted`. Position ranges use UTF-16 code units. For supported ASCII this coincides with character offsets. A nonchanging input has a null delta and does not increment the revision.

When observed selection and resulting text agree, the replacement is anchored to that selection. This matters for insertion or deletion among repeated characters. Otherwise, a common-prefix/suffix difference provides a reconstructable replacement and is explicitly labeled `text-difference`; it does not claim to identify the actual cursor operation.

Script changes noticed without input events produce `checkpoint` records containing the observed text, delta and a reason. Unsupported native editing operations retain their `inputType`, text patch and issue flags. Neither path is reclassified as ordinary typing.

`reconstructText` checks consecutive event sequence/session IDs, revision transitions, deleted text at each patch location, checkpoints and final text. These checks detect structural inconsistencies, not maliciously rewritten logs. JSONL adds a header record before the event records and a footer with final text and stop status.

## Interaction details

Keyboard data retains both logical `key` and physical `code`. Keyup references the first matching keydown, including repeated presses. If focus or page lifecycle interrupts a press, its key identifier is reported and no release timing is invented. Pointer/mouse pairs remain separate raw events; analyses must avoid double counting.

Clipboard events describe what the page can observe. Copy/cut selected text is an observation of selection, not a guarantee of system clipboard contents. Paste plain text may be unavailable. File metadata is retained when exposed, but file contents and arbitrary MIME bodies are not read. No permission prompts are generated by the core.

All listeners are passive observers and never call `preventDefault()`. The host controls editing policy. A textarea gets at most one active recorder; `stop()` detaches every listener and is idempotent. Event subscribers receive frozen events; exports return detached copies. Hosts must stop before removing/unmounting an editor.

## Persistence and future analysis

v0.1 intentionally retains events in memory, including full raw movement streams by default. A host may subscribe and queue data for IndexedDB or a server. Persist the session header as well as events, acknowledge events by stable ID, and retain ordering. This release does not provide that transport or durability layer. Snapshotting the complete trace on each key is discouraged.

Future analyzers can derive inter-key intervals from selected keyboard timestamps, pauses from explicitly chosen thresholds and activity exclusions, and bursts from a declared segmentation rule. Those choices must be recorded with the analysis result. The core does not turn a raw time difference into a psychological pause or assume that adjacent input events are one word or burst.

## Design sources

The implementation and schema were designed independently for AwenTrace. Existing tools informed the functional scope only; no third-party implementation, modules or schema were copied.

- [W3C Input Events](https://www.w3.org/TR/input-events-2/)
- [MDN clipboardData](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData)
- [MDN textarea selectionchange](https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/selectionchange_event)
- [Inputlog](https://www.inputlog.net/)
- [FlexKeyLogger](https://github.com/terryyutian/keylogging-demo-webpage)
- [CyWrite](https://github.com/chukharev/cywrite)
