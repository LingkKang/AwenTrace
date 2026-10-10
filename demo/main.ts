import { createTrace, toCSV, toJSON, toJSONL } from '../src/index.js';
import type { Recorder, Trace } from '../src/index.js';
import './style.css';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing ${id}`);
  return found as T;
}

const writer = element<HTMLTextAreaElement>('writer');
const start = element<HTMLButtonElement>('start');
const stop = element<HTMLButtonElement>('stop');
const download = element<HTMLButtonElement>('download');
const format = element<HTMLSelectElement>('format');
const status = element('status');
const eventCount = element('event-count');
let recorder: Recorder | null = null;
let completed: Trace | null = null;
let outsideScope = false;

start.addEventListener('click', () => {
  completed = null;
  outsideScope = false;
  writer.value = '';
  writer.readOnly = false;
  status.textContent = 'Recording';
  recorder = createTrace({
    target: writer,
    metadata: { application: 'AwenTrace demo' },
    onEvent(event) {
      eventCount.textContent = String(event.sequence);
      if (event.kind === 'input' && !event.payload.supported) {
        outsideScope = true;
        status.textContent = 'Recording · unsupported input flagged';
      }
    },
  });
  start.disabled = true;
  stop.disabled = false;
  download.disabled = false;
  writer.focus();
});

stop.addEventListener('click', () => {
  if (!recorder) return;
  completed = recorder.stop();
  writer.readOnly = true;
  start.disabled = false;
  start.textContent = 'New session';
  stop.disabled = true;
  status.textContent = outsideScope ? 'Finished · unsupported input flagged' : 'Finished';
});

download.addEventListener('click', () => {
  if (!recorder) return;
  const trace = completed ?? recorder.getTrace();
  const selected = format.value;
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
