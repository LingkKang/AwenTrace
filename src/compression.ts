import type { JSONLExportOptions, Trace, TraceEvent, TraceHeader } from './types.js';

/** Internal pull-based view over a snapshot or the recorder's immutable journal. */
export interface JSONLSource {
  header: TraceHeader;
  eventAt(index: number): TraceEvent | undefined;
  complete(): boolean;
  footer(): { finalText: string; stopped: boolean };
  subscribe(wake: () => void): () => void;
}

/** Internal shared implementation; no compression work runs in capture callbacks. */
export function createJSONLStream(source: JSONLSource, gzip: boolean): ReadableStream<Uint8Array<ArrayBuffer>> {
  // Construct first: unsupported gzip must fail before a subscription is installed.
  let compressor: CompressionStream | undefined;
  if (gzip) {
    if (typeof CompressionStream === 'undefined') {
      throw new Error('Native gzip requires CompressionStream; use gzip: false for plain JSONL');
    }
    compressor = new CompressionStream('gzip');
  }
  const encoder = new TextEncoder();
  let index = 0, headerSent = false, cancelled = false;
  let wake: (() => void) | undefined;
  let unsubscribe = () => {};
  const notify = () => { const resolve = wake; wake = undefined; resolve?.(); };
  const cleanup = () => { unsubscribe(); notify(); };
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start() { unsubscribe = source.subscribe(notify); },
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(encoder.encode(JSON.stringify({ record: 'header', ...source.header }) + '\n'));
          return;
        }
        while (!cancelled) {
          const event = source.eventAt(index);
          if (event) {
            index++;
            controller.enqueue(encoder.encode(JSON.stringify({ record: 'event', ...event }) + '\n'));
            return;
          }
          if (source.complete()) {
            controller.enqueue(encoder.encode(JSON.stringify({ record: 'footer', ...source.footer() }) + '\n'));
            controller.close(); cleanup(); return;
          }
          await new Promise<void>(resolve => { wake = resolve; });
        }
      } catch (error) { controller.error(error); cleanup(); }
    },
    cancel() { cancelled = true; cleanup(); },
  }, { highWaterMark: 0 });
  return compressor ? stream.pipeThrough(compressor) : stream;
}

/** Finite snapshot stream; do not mutate trace while it is being consumed. */
export function toJSONLStream(trace: Trace, options: JSONLExportOptions = {}): ReadableStream<Uint8Array<ArrayBuffer>> {
  return createJSONLStream({
    header: trace.header, eventAt: index => trace.events[index], complete: () => true,
    footer: () => ({ finalText: trace.finalText, stopped: trace.stopped }), subscribe: () => () => {},
  }, options.gzip ?? true);
}

/** Browser-native gzip by default; only this convenience method buffers a Blob. */
export async function toJSONLBlob(trace: Trace, options: JSONLExportOptions = {}): Promise<Blob> {
  const gzip = options.gzip ?? true;
  return new Response(toJSONLStream(trace, { gzip }), {
    headers: { 'Content-Type': gzip ? 'application/gzip' : 'application/x-ndjson;charset=utf-8' },
  }).blob();
}
