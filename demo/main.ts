import { applyDelta, createTrace, reconstructText, toCSV, toJSON, toJSONL } from '../src/index.js';
import type { Recorder, Trace } from '../src/index.js';
import './style.css';

document.body.innerHTML = `
  <main>
    <header><a class="brand" href="/">Awen<span>Trace</span><small>0.1</small></a><span class="tag">WRITING PROCESS LAB</span></header>
    <section class="intro"><p class="eyebrow">A RECORD OF HOW WORDS ARRIVE</p><h1>Every word has a history.</h1>
      <p>Capture the small actions behind a piece of writing. Type, select, revise, copy and paste — then inspect the trace.</p></section>
    <div class="toolbar"><button id="start">Start a session</button><button id="stop" disabled>Finish recording</button>
      <span id="status" role="status">Ready when you are</span></div>
    <section class="workspace">
      <div class="paper"><div class="section-label"><label for="writer">YOUR WRITING</label><span>ENGLISH / ASCII</span></div>
        <textarea id="writer" name="writing" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" placeholder="Start a session, then write something here…" readonly></textarea>
        <footer><span id="characters">0 characters</span><span>Plain text · Browser events</span></footer>
      </div>
      <aside><div class="section-label">SESSION SNAPSHOT</div><strong id="event-count">0</strong><p>recorded events</p>
        <dl><div><dt>Text changes</dt><dd id="edit-count">0</dd></div><div><dt>Key presses</dt><dd id="key-count">0</dd></div>
        <div><dt>Mouse clicks</dt><dd id="click-count">0</dd></div><div><dt>Clipboard actions</dt><dd id="clipboard-count">0</dd></div></dl>
        <p class="note">This session captures this writing box and page lifecycle events. Your text and clipboard actions stay in this page's memory. Export before closing or reloading.</p>
        <p id="scope-note" class="note">Undo, drag-and-drop, autocorrection and non-ASCII input are outside v0.1. Unexpected changes are retained and flagged.</p>
      </aside>
    </section>
    <section class="trace-section"><div class="trace-heading"><div><p class="eyebrow">THE OBSERVATION LAYER</p><h2>Follow the trace</h2></div>
      <div class="exports"><button id="json" disabled>JSON ↓</button><button id="jsonl" disabled>JSONL ↓</button><button id="csv" disabled>CSV ↓</button></div></div>
      <p class="note">The latest 80 events are shown below. Exports contain the entire session. Pointer and mouse events are separate native streams.</p>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Elapsed (ms)</th><th>Event</th><th>Selection</th><th>Detail</th></tr></thead><tbody id="events"><tr><td colspan="5" class="empty">Your first interaction starts the story.</td></tr></tbody></table></div>
    </section>
    <section id="replay-section" hidden><div class="trace-heading"><h2>Text history</h2><span id="verified"></span></div>
      <label for="replay">Inspect text after event <output id="replay-index">0</output></label>
      <input id="replay" type="range" min="0" value="0" aria-label="Text history event" />
      <pre id="replay-text"></pre><p class="note">Event-by-event text reconstruction. Pause and burst analysis will be added in later versions.</p>
    </section>
    <footer class="page-footer">AwenTrace · Framework-independent TypeScript · No runtime dependencies</footer>
  </main>`;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing ${id}`);
  return found as T;
}
const writer = element<HTMLTextAreaElement>('writer');
const start = element<HTMLButtonElement>('start');
const stop = element<HTMLButtonElement>('stop');
let recorder: Recorder | null = null;
let completed: Trace | null = null;
let frame = 0;
let dirty = false;
const counts = { edits: 0, keys: 0, clicks: 0, clipboard: 0 };
let recent: { sequence: number; elapsedMs: number; kind: string; selection: string; detail: string }[] = [];

const render = () => {
  frame = 0;
  if (!dirty || !recorder) return;
  dirty = false;
  element('event-count').textContent = String(recorder.eventCount);
  element('characters').textContent = `${writer.value.length} characters`;
  element('edit-count').textContent = String(counts.edits);
  element('key-count').textContent = String(counts.keys);
  element('click-count').textContent = String(counts.clicks);
  element('clipboard-count').textContent = String(counts.clipboard);
  const body = element('events');
  body.replaceChildren(...recent.map(event => {
    const row = document.createElement('tr');
    for (const value of [String(event.sequence), event.elapsedMs.toFixed(2), event.kind, event.selection, event.detail]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    return row;
  }));
};

function begin() {
  if (recorder && !recorder.stopped) recorder.stop();
  completed = null; recent = []; counts.edits = counts.keys = counts.clicks = counts.clipboard = 0;
  writer.value = ''; writer.readOnly = false;
  element('replay-section').hidden = true;
  recorder = createTrace({ target: writer, metadata: { application: 'AwenTrace demo' },
    onEvent(event) {
      if (event.kind === 'input' && event.payload.delta) counts.edits++;
      if (event.kind === 'keydown') counts.keys++;
      if (event.kind === 'click') counts.clicks++;
      if (['copy', 'cut', 'paste'].includes(event.kind)) counts.clipboard++;
      if (event.kind === 'input' && !event.payload.supported) {
        element('scope-note').textContent = `Outside v0.1 scope: ${event.payload.issues.join(', ')}. Text is still retained.`;
      }
      recent.push({ sequence: event.sequence, elapsedMs: event.elapsedMs, kind: event.kind,
        selection: `${event.state.selection.start}–${event.state.selection.end}`,
        detail: JSON.stringify(event.payload).slice(0, 180) });
      recent = recent.slice(-80); dirty = true;
      if (!frame) frame = requestAnimationFrame(render);
    },
  });
  start.disabled = true; stop.disabled = false;
  element('status').textContent = '● Recording';
  for (const id of ['json', 'jsonl', 'csv']) element<HTMLButtonElement>(id).disabled = false;
  writer.focus();
}

const replay = element<HTMLInputElement>('replay');
function showReplay() {
  if (!completed) return;
  const limit = Number(replay.value);
  let text = completed.header.initialText;
  for (const event of completed.events.slice(0, limit)) {
    if ((event.kind === 'input' || event.kind === 'checkpoint') && event.payload.delta) text = applyDelta(text, event.payload.delta);
  }
  element('replay-index').textContent = String(limit);
  element('replay-text').textContent = text || '(empty text)';
}
start.addEventListener('click', begin);
stop.addEventListener('click', () => {
  if (!recorder) return;
  completed = recorder.stop(); writer.readOnly = true;
  start.disabled = false; start.textContent = 'Start a new session'; stop.disabled = true;
  element('status').textContent = 'Session finished';
  element('verified').textContent = reconstructText(completed) === completed.finalText ? '✓ Reconstruction verified' : 'Mismatch';
  element('replay-section').hidden = false;
  replay.max = String(completed.events.length); replay.value = replay.max; showReplay(); render();
});
replay.addEventListener('input', showReplay);
for (const format of ['json', 'jsonl', 'csv'] as const) {
  element(format).addEventListener('click', () => {
    if (!recorder) return;
    const trace = completed ?? recorder.getTrace();
    const content = format === 'json' ? toJSON(trace, true) : format === 'jsonl' ? toJSONL(trace) : toCSV(trace);
    const url = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `awentrace-${trace.header.sessionId}.${format}`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// Demo/test integration only. This global is not part of the published library.
Object.assign(window, { awen: { get recorder() { return recorder; }, begin, createTrace, reconstructText } });
