import { applyDelta, createTrace, toCSV, toJSON, toJSONL } from '../src/index.js';
import type { Recorder, TraceEvent } from '../src/index.js';
import './style.css';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing ${id}`);
  return found as T;
}

const writer = element<HTMLTextAreaElement>('writer');
const start = element<HTMLButtonElement>('start');
const reset = element<HTMLButtonElement>('reset');
const formats = ['json', 'jsonl', 'csv'] as const;
const downloads = formats.map(format => element<HTMLButtonElement>(format));
const status = element('status');
const eventCount = element('event-count');
const textCount = element('text-count');
const rows = element<HTMLTableSectionElement>('events');
const replay = element<HTMLInputElement>('replay');
const replayText = element('replay-text');
const replayIndex = element('replay-index');
let recorder: Recorder | null = null;
let events: TraceEvent[] = [];
let frame = 0;
let followHistory = true;

function showHistory(text: string) {
  replayText.textContent = text || '(empty text)';
  replayText.classList.toggle('placeholder', text.length === 0);
}

function render() {
  frame = 0;
  eventCount.textContent = String(events.length);
  const words = writer.value.trim() ? writer.value.trim().split(/\s+/).length : 0;
  textCount.textContent = `${writer.value.length} characters · ${words} words`;
  rows.replaceChildren();
  if (!events.length) {
    const row = rows.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5; cell.className = 'empty'; cell.textContent = 'No records yet.';
  } else {
    for (const event of events.slice(-200).reverse()) {
      const row = rows.insertRow();
      for (const value of [String(event.sequence), event.elapsedMs.toFixed(2), event.kind,
        `${event.state.selection.start}–${event.state.selection.end}`, JSON.stringify(event.payload)]) {
        row.insertCell().textContent = value;
      }
    }
  }
  replay.max = String(events.length);
  replay.disabled = events.length === 0;
  if (followHistory) {
    replay.value = replay.max;
    replayIndex.textContent = replay.value;
    showHistory(writer.value);
  }
}

function scheduleRender() {
  if (!frame) frame = requestAnimationFrame(render);
}

start.addEventListener('click', () => {
  if (!recorder) {
    writer.readOnly = false;
    recorder = createTrace({
      target: writer,
      capturePointerMoves: false,
      metadata: { application: 'AwenTrace demo' },
      onEvent(event) { events.push(event); scheduleRender(); },
    });
    for (const button of downloads) button.disabled = false;
  } else if (recorder.paused) {
    writer.readOnly = false;
    recorder.resume();
  } else {
    recorder.pause();
    writer.readOnly = true;
    start.textContent = 'Resume the session';
    start.title = 'Resume recording in the same session and unlock the writing area.';
    status.textContent = 'Paused';
    return;
  }
  start.textContent = 'Pause recording';
  start.title = 'Pause recording and lock the writing area. Keep all existing records.';
  status.textContent = 'Recording';
  writer.focus();
});

reset.addEventListener('click', () => {
  recorder?.stop();
  recorder = null;
  events = [];
  cancelAnimationFrame(frame);
  frame = 0;
  writer.value = '';
  writer.readOnly = true;
  writer.setSelectionRange(0, 0);
  writer.scrollTop = writer.scrollLeft = 0;
  writer.style.height = '';
  for (const button of downloads) button.disabled = true;
  start.textContent = 'Start a session';
  start.title = 'Start a new recording session.';
  status.textContent = 'Ready';
  followHistory = true;
  replay.value = '0';
  document.querySelector('.table-wrap')!.scrollTop = 0;
  render();
});

replay.addEventListener('input', () => {
  const limit = Number(replay.value);
  followHistory = limit === events.length;
  let text = '';
  for (const event of events.slice(0, limit)) {
    if ((event.kind === 'input' || event.kind === 'checkpoint') && event.payload.delta) {
      text = applyDelta(text, event.payload.delta);
    }
  }
  replayIndex.textContent = String(limit);
  showHistory(text);
});

for (const selected of formats) element(selected).addEventListener('click', () => {
  if (!recorder) return;
  const trace = recorder.getTrace();
  const content = selected === 'csv' ? toCSV(trace) : selected === 'jsonl' ? toJSONL(trace) : toJSON(trace, true);
  const type = selected === 'csv' ? 'text/csv;charset=utf-8'
    : selected === 'jsonl' ? 'application/x-ndjson;charset=utf-8' : 'application/json;charset=utf-8';
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `awentrace-${trace.header.sessionId}.${selected}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
