import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { toJSONL, toJSONLBlob, toJSONLStream } from '../dist/index.js';
import { createJSONLStream } from '../dist/compression.js';

const fixture = () => ({ header: { schema: 'awentrace/0.1', sessionId: 's', metadata: { text: '中文😀\n"' } },
  events: Array.from({ length: 20 }, (_, i) => ({ id: `s:${i + 1}`, sessionId: 's', sequence: i + 1,
    kind: 'marker', elapsedMs: 0.8999999910593033, payload: { name: 'sample', data: '\ud800' } })),
  finalText: 'text\n', stopped: false });

test('native gzip Blob and snapshot stream reproduce canonical JSONL exactly', async () => {
  const trace = fixture();
  const blob = await toJSONLBlob(trace);
  assert.equal(blob.type, 'application/gzip');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 2)], [31, 139]);
  assert.equal(gunzipSync(bytes).toString(), toJSONL(trace));
  const streamed = await new Response(toJSONLStream(trace).pipeThrough(new DecompressionStream('gzip'))).text();
  assert.equal(streamed, toJSONL(trace));
  assert.ok(bytes.length < new TextEncoder().encode(toJSONL(trace)).length);
});

test('gzip false produces UTF-8 JSONL and preserves empty stopped snapshots', async () => {
  const trace = fixture(); trace.events = []; trace.stopped = true;
  const blob = await toJSONLBlob(trace, { gzip: false });
  assert.equal(blob.type, 'application/x-ndjson;charset=utf-8');
  assert.equal(await blob.text(), toJSONL(trace));
});

function journal() {
  const trace = fixture(); trace.events = [];
  const listeners = new Set(); let accesses = 0;
  const queried = Promise.withResolvers(), released = Promise.withResolvers();
  return { trace, listeners, get accesses() { return accesses; },
    queried: queried.promise, released: released.promise,
    source: { header: trace.header, eventAt: i => { accesses++; queried.resolve(); return trace.events[i]; },
      complete: () => trace.stopped, footer: () => ({ finalText: trace.finalText, stopped: trace.stopped }),
      subscribe: wake => { listeners.add(wake); return () => { listeners.delete(wake); released.resolve(); }; } },
    notify() { for (const wake of listeners) wake(); },
  };
}

test('live stream is pull-based, follows new events and closes with exactly one footer', async () => {
  const j = journal(), reader = createJSONLStream(j.source, false).getReader();
  assert.equal(j.accesses, 0);
  const decode = value => JSON.parse(new TextDecoder().decode(value));
  assert.equal(decode((await reader.read()).value).record, 'header');
  const pending = reader.read();
  await j.queried; // Ensure the pull is actually waiting for a future event.
  j.trace.events.push(fixture().events[0]); j.notify();
  assert.deepEqual(decode((await pending).value), { record: 'event', ...j.trace.events[0] });
  j.trace.stopped = true; j.notify();
  assert.deepEqual(decode((await reader.read()).value), { record: 'footer', finalText: j.trace.finalText, stopped: true });
  assert.equal((await reader.read()).done, true);
  assert.equal(j.listeners.size, 0);
});

for (const gzip of [false, true]) test(`cancel cleans up a waiting live stream (gzip=${gzip})`, async () => {
  const j = journal(), reader = createJSONLStream(j.source, gzip).getReader();
  if (!gzip) await reader.read(); // Consume the header before waiting for an event.
  const pending = reader.read();
  await j.queried;
  await reader.cancel(); await pending;
  // pipeThrough propagates cancellation to its source asynchronously.
  await j.released;
  assert.equal(j.listeners.size, 0);
  assert.equal(j.trace.stopped, false);
});

test('serialization errors reject output and release subscriptions', async () => {
  const j = journal(); j.trace.header.metadata = 1n;
  await assert.rejects(new Response(createJSONLStream(j.source, true)).arrayBuffer(), /BigInt/);
  assert.equal(j.listeners.size, 0);
});

test('missing native compression fails explicitly, while gzip false still works', async () => {
  const native = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    const j = journal();
    assert.throws(() => createJSONLStream(j.source, true), /gzip: false/);
    assert.equal(j.listeners.size, 0);
    await assert.rejects(toJSONLBlob(fixture()), /CompressionStream/);
    assert.equal(await (await toJSONLBlob(fixture(), { gzip: false })).text(), toJSONL(fixture()));
  } finally { globalThis.CompressionStream = native; }
});
