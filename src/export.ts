import type { Trace } from './types.js';

export function toJSON(trace: Trace, pretty = false): string {
  return JSON.stringify(trace, null, pretty ? 2 : undefined);
}

/** Header and footer make JSONL self-contained, including an unfinished session. */
export function toJSONL(trace: Trace): string {
  return [JSON.stringify({ record: 'header', ...trace.header }),
    ...trace.events.map(event => JSON.stringify({ record: 'event', ...event })),
    JSON.stringify({ record: 'footer', finalText: trace.finalText, stopped: trace.stopped })].join('\n') + '\n';
}

/** Raw event table. JSON/JSONL are the canonical, reconstructable exports. */
export function toCSV(trace: Trace): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const columns = ['sequence', 'kind', 'elapsed_ms', 'wall_time', 'dom_timestamp', 'trusted',
    'revision', 'selection_start', 'selection_end', 'text_length', 'payload_json'];
  const rows = trace.events.map(event => [String(event.sequence), event.kind, String(event.elapsedMs),
    event.wallTime, event.domTimeStamp === null ? '' : String(event.domTimeStamp),
    event.trusted === null ? '' : String(event.trusted), String(event.state.revision),
    String(event.state.selection.start), String(event.state.selection.end),
    String(event.state.textLength), JSON.stringify(event.payload)].map(quote).join(','));
  return [columns.join(','), ...rows].join('\r\n') + '\r\n';
}
