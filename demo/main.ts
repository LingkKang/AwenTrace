import { applyDelta, createTrace, toCSV, toJSON } from '../src/index.js';
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
const formats = ['csv', 'json', 'jsonl'] as const;
const downloads = formats.map(format => element<HTMLButtonElement>(format));
const status = element('status');
const exportError = element('export-error');
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
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
const wordSegments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'word' }) : null;

function showHistory(text: string) {
  replayText.textContent = text || '(empty text)';
  replayText.classList.toggle('placeholder', text.length === 0);
}

function render() {
  frame = 0;
  eventCount.textContent = String(events.length);
  const characters = graphemes ? [...graphemes.segment(writer.value)].length : [...writer.value].length;
  const words = wordSegments ? [...wordSegments.segment(writer.value)].filter(part => part.isWordLike).length :
    (writer.value.trim() ? writer.value.trim().split(/\s+/).length : 0);
  textCount.textContent = `${characters} ${graphemes ? 'characters' : 'code points'} · ${words} ${wordSegments ? 'words' : 'space-separated tokens'}`;
  textCount.title = graphemes ? 'Characters use grapheme clusters; words use English word segmentation.' :
    'This browser lacks text segmentation; counts use code points and whitespace-separated tokens.';
  rows.replaceChildren();
  if (!events.length) {
    const row = rows.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5; cell.className = 'empty'; cell.textContent = 'No records yet.';
  } else {
    for (const event of events.slice(-200).reverse()) {
      const row = rows.insertRow();
      for (const value of [String(event.sequence), event.elapsedMs.toFixed(2), event.kind,
      `${event.state.selection.start}-${event.state.selection.end}`, JSON.stringify(event.payload)]) {
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
      gzip: true,
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
  exportError.textContent = '';
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
  let text = events[0]?.kind === 'start' ? events[0].payload.text : '';
  for (const event of events.slice(0, limit)) {
    if ((event.kind === 'input' || event.kind === 'checkpoint') && event.payload.delta) {
      text = applyDelta(text, event.payload.delta);
    }
  }
  replayIndex.textContent = String(limit);
  showHistory(text);
});

for (const selected of formats) element(selected).addEventListener('click', async () => {
  const current = recorder;
  if (!current) return;
  exportError.textContent = '';
  try {
    const blob = selected === 'jsonl' ? await current.exportJSONL() : new Blob([
      selected === 'csv' ? toCSV(current.getTrace()) : toJSON(current.getTrace(), true),
    ], { type: selected === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
    // A reset during asynchronous compression discards the old session's download.
    if (recorder !== current) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `awentrace-${current.sessionId}.${selected}${selected === 'jsonl' && current.gzip ? '.gz' : ''}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    if (recorder === current) exportError.textContent = 'Export failed. Try downloading JSON or CSV instead.';
  }
});
