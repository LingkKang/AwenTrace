import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePauses } from '../dist/analysis/index.js';
import * as capture from '../dist/index.js';

const selection = (start, end = start) => ({ start, end, direction: 'none' });

// Reconstructable traces, including explicit recorder boundaries and revisions.
function recording({ initialText = '', visibility = 'visible' } = {}) {
  let text = initialText, revision = 0, focused = true;
  const trace = { header: { schema: 'awentrace/0.1', recorderVersion: '0.1.0',
    sessionId: 's', initialText, environment: { visibility } }, events: [], finalText: text, stopped: false };
  const emit = (kind, elapsedMs, payload = {}, focus = focused) => {
    focused = focus;
    const sequence = trace.events.length + 1;
    const event = { id: `s:${sequence}`, sessionId: 's', sequence, kind, elapsedMs,
      wallTime: '2026-10-11T00:00:00Z', domTimeStamp: null, trusted: null, defaultPrevented: null,
      payload, state: { selection: selection(text.length), textLength: text.length, revision,
        focused, ascii: true, scroll: { left: 0, top: 0 } } };
    trace.events.push(event);
    return event;
  };
  const edit = (ms, inserted = 'x', options = {}) => {
    const before = selection(text.length);
    const delta = inserted ? { start: text.length, removed: '', inserted, locationBasis: 'selection' } : null;
    const fromRevision = revision;
    if (delta) { text += inserted; revision++; }
    trace.finalText = text;
    return emit(options.checkpoint ? 'checkpoint' : 'input', ms, {
      inputType: options.inputType ?? 'insertText', data: inserted, composing: false,
      beforeInputSequence: null, selectionBefore: options.noSelection ? null : before,
      selectionAfter: selection(text.length), fromRevision, toRevision: revision,
      delta, supported: options.supported ?? true, issues: [],
      ...(options.checkpoint ? { reason: 'host-request', text } : {}),
    });
  };
  const stop = ms => { emit('stop', ms, { text, interruptedKeys: [] }); trace.stopped = true; return trace; };
  emit('start', 0, { text, selection: selection(text.length) });
  return { trace, emit, edit, stop };
}

test('analysis has its own entry; capture does not re-export analysis', () => {
  assert.equal('analyzePauses' in capture, false);
  assert.equal(typeof analyzePauses, 'function');
});

test('inclusive threshold, exact durations, evidence references and descriptive statistics', () => {
  const r = recording();
  const first = r.edit(100), second = r.edit(2100);
  r.edit(2600); r.edit(6100, 'z', { noSelection: true });
  const result = analyzePauses(r.stop(20000));
  assert.equal(result.algorithmVersion, '1');
  assert.equal(result.basis, 'text-change');
  assert.equal(result.sourceStopped, true);
  assert.equal(result.sourceEventCount, 6);
  assert.equal(result.options.thresholdMs, 2000);
  assert.deepEqual(result.pauses.map(p => p.durationMs), [2000, 3500]);
  assert.equal(result.pauses[0].startEventId, first.id);
  assert.equal(result.pauses[0].endEventId, second.id);
  assert.equal(result.pauses[0].startRevision, 1);
  assert.equal(result.pauses[0].endRevision, 1);
  assert.deepEqual(result.pauses[0].selectionAfterPrevious, selection(1));
  assert.equal(result.pauses[1].selectionBeforeNext, null);
  assert.deepEqual(result.summary, { count: 2, totalDurationMs: 5500, meanDurationMs: 2750,
    medianDurationMs: 2750, minDurationMs: 2000, maxDurationMs: 3500,
    eligibleIntervalCount: 3, eligibleDurationMs: 6000, pauseRatio: 5500 / 6000,
    excludedIntervalCount: 0, excludedDurationMs: 0 });
  assert.equal(analyzePauses(r.trace, { thresholdMs: 500 }).summary.medianDurationMs, 2000);
  assert.equal(analyzePauses(r.trace, { thresholdMs: 6000 }).summary.meanDurationMs, null);
});

test('no invented initial or trailing pauses, including live and empty snapshots', () => {
  for (const changes of [0, 1]) {
    const r = recording({ initialText: 'existing draft' });
    if (changes) r.edit(50000);
    r.emit('marker', 100000, { name: 'feedback', data: null });
    for (const trace of [r.trace, structuredClone(r.trace)]) {
      const result = analyzePauses(trace);
      assert.equal(result.summary.count, 0);
      assert.equal(result.summary.pauseRatio, null);
      assert.equal(result.summary.minDurationMs, null);
      assert.equal(result.summary.eligibleIntervalCount, 0);
    }
  }
  const empty = recording().trace; empty.events = [];
  assert.equal(analyzePauses(empty).summary.count, 0);
});

test('selection, markers, keys and nonchanging inputs do not reset inter-edit gaps', () => {
  const r = recording();
  r.edit(100);
  r.emit('keydown', 1500, { key: 'ArrowLeft' });
  r.emit('selection', 2000, { previous: selection(1), current: selection(0), trigger: 'select' });
  r.emit('marker', 2500, { name: 'feedback_presented', data: { feedbackId: 'f1' } });
  r.edit(3000, '');
  r.edit(4100, 'pasted text', { inputType: 'insertFromPaste' });
  const result = analyzePauses(r.trace);
  assert.deepEqual(result.pauses.map(p => p.durationMs), [4000]);
});

test('actual deletion and replacement are input anchors, not just inserted characters', () => {
  const r = recording();
  r.edit(100, 'abc');
  const deletion = r.edit(2100, 'd');
  deletion.payload.inputType = 'deleteContentBackward';
  deletion.payload.delta = { start: 2, removed: 'c', inserted: '', locationBasis: 'selection' };
  deletion.payload.selectionBefore = selection(3);
  deletion.payload.selectionAfter = selection(2);
  deletion.state.textLength = 2;
  const replacement = r.edit(4100, 'e');
  replacement.payload.delta = { start: 0, removed: 'ab', inserted: 'Z', locationBasis: 'selection' };
  replacement.payload.selectionBefore = selection(0, 2);
  replacement.payload.selectionAfter = selection(1);
  replacement.state.textLength = 1;
  r.trace.finalText = 'Z';
  assert.deepEqual(analyzePauses(r.trace).pauses.map(p => p.durationMs), [2000, 2000]);
});

test('recording suspension excludes the entire interrupted gap without stitching fragments', () => {
  const r = recording();
  r.edit(100); r.emit('pause', 200, { interruptedKeys: [] });
  r.emit('marker', 9000, { name: 'during_pause', data: null });
  r.emit('resume', 10000, { pausedMs: 9800 }); r.edit(11000); r.edit(13000);
  const result = analyzePauses(r.trace, { excludeHidden: false, excludeWindowBlur: false });
  assert.equal(result.summary.count, 1);
  assert.equal(result.summary.eligibleDurationMs, 2000);
  assert.equal(result.summary.excludedDurationMs, 10900);
  assert.deepEqual(result.excludedIntervals[0].reasons, ['recording-paused']);
});

test('visibility and window blur exclusions are independent and configurable', () => {
  const r = recording();
  r.edit(100); r.emit('blur', 200, { scope: 'window' });
  r.emit('visibility', 300, { state: 'hidden' }); r.emit('visibility', 5000, { state: 'visible' });
  r.emit('focus', 5100, { scope: 'window' }); r.edit(6100); r.edit(8100);
  const result = analyzePauses(r.trace);
  assert.deepEqual(result.excludedIntervals[0].reasons, ['page-hidden', 'window-blurred']);
  assert.equal(result.summary.count, 1);
  assert.deepEqual(analyzePauses(r.trace, { excludeHidden: false }).excludedIntervals[0].reasons, ['window-blurred']);
  assert.equal(analyzePauses(r.trace, { excludeHidden: false, excludeWindowBlur: false }).summary.count, 2);
});

test('initial hidden state and page lifecycle gaps are retained until explicit recovery', () => {
  const r = recording({ visibility: 'hidden' });
  r.edit(100); r.edit(2100); r.emit('visibility', 2200, { state: 'visible' }); r.edit(4100);
  r.emit('pagehide', 4500, { persisted: true });
  r.emit('visibility', 5000, { state: 'visible' }); // Does not close a pagehide interval.
  r.edit(6100); r.emit('pageshow', 6500, { persisted: true }); r.edit(8100); r.edit(10100);
  const result = analyzePauses(r.trace);
  assert.equal(result.excludedIntervals.length, 4);
  assert.ok(result.excludedIntervals.every(p => p.reasons.includes('page-hidden')));
  assert.equal(result.summary.count, 1);
});

test('editor blur is distinct from leaving the window and is optional', () => {
  const r = recording(); r.edit(100);
  r.emit('blur', 200, { scope: 'editor' }, false);
  r.emit('focus', 4000, { scope: 'editor' }, true); r.edit(4100);
  assert.equal(analyzePauses(r.trace).summary.count, 1);
  assert.deepEqual(analyzePauses(r.trace, { excludeEditorBlur: true }).excludedIntervals[0].reasons, ['editor-blurred']);
});

test('programmatic checkpoints and unsupported edits cannot masquerade as writing pauses', () => {
  const r = recording(); r.edit(100);
  r.edit(2000, 'external', { checkpoint: true }); r.edit(4100);
  r.edit(6100, 'unsupported', { supported: false }); r.edit(8100); r.edit(10100);
  const result = analyzePauses(r.trace);
  assert.deepEqual(result.excludedIntervals.map(p => p.reasons), [
    ['unobserved-change'], ['unsupported-input'], ['unsupported-input'],
  ]);
  assert.deepEqual(result.pauses.map(p => p.durationMs), [2000]);
});

test('an unchanged checkpoint is harmless but an unsupported nonchanging input flags the gap', () => {
  const r = recording(); r.edit(100); r.edit(2000, '', { checkpoint: true }); r.edit(4100);
  assert.equal(analyzePauses(r.trace).summary.count, 1);
  r.edit(5000, '', { supported: false }); r.edit(8100);
  assert.deepEqual(analyzePauses(r.trace).excludedIntervals[0].reasons, ['unsupported-input']);
});

test('ranges include complete intervals only and retain exclusions starting before the range', () => {
  const r = recording(); r.edit(100); r.edit(2100);
  r.emit('blur', 2500, { scope: 'window' }); r.edit(4100); r.edit(6100);
  const partial = analyzePauses(r.trace, { range: { startMs: 1000, endMs: 3000 } });
  assert.equal(partial.summary.eligibleIntervalCount, 0);
  const exact = analyzePauses(r.trace, { range: { startMs: 100, endMs: 2100 } });
  assert.equal(exact.summary.count, 1);
  const excluded = analyzePauses(r.trace, { range: { startMs: 4100, endMs: 6100 } });
  assert.deepEqual(excluded.excludedIntervals[0].reasons, ['window-blurred']);
});

test('wall-clock changes do not affect results, and equal elapsed timestamps are legal', () => {
  const r = recording(); r.edit(100); r.edit(100); r.edit(2100);
  r.trace.events[1].wallTime = '2030-01-01T00:00:00Z';
  r.trace.events[2].wallTime = '2020-01-01T00:00:00Z';
  const result = analyzePauses(r.trace);
  assert.equal(result.summary.count, 1);
  assert.equal(result.summary.eligibleIntervalCount, 2);
  assert.equal(result.summary.pauseRatio, 1);
  const zero = recording(); zero.edit(0); zero.edit(0);
  assert.equal(analyzePauses(zero.trace).summary.pauseRatio, null);
});

test('invalid options, timelines and broken text evidence fail explicitly', () => {
  const r = recording(); r.edit(100); r.edit(2100);
  for (const thresholdMs of [0, -1, NaN, Infinity, '2000']) {
    assert.throws(() => analyzePauses(r.trace, { thresholdMs }), /thresholdMs/);
  }
  for (const range of [{ startMs: -1, endMs: 10 }, { startMs: 10, endMs: 9 },
    { startMs: 0, endMs: Infinity }, { startMs: NaN, endMs: 10 }]) {
    assert.throws(() => analyzePauses(r.trace, { range }), /range/);
  }
  assert.throws(() => analyzePauses(r.trace, { excludeHidden: 1 }), /boolean/);
  for (const ms of [-1, 99, Infinity, NaN]) {
    const bad = structuredClone(r.trace); bad.events[2].elapsedMs = ms;
    assert.throws(() => analyzePauses(bad), /elapsedMs/);
  }
  const duplicate = structuredClone(r.trace); duplicate.events[2].id = duplicate.events[1].id;
  assert.throws(() => analyzePauses(duplicate), /event IDs/);
  const gap = structuredClone(r.trace); gap.events[2].sequence = 4;
  assert.throws(() => analyzePauses(gap), /sequence/);
  const broken = structuredClone(r.trace); broken.finalText = 'wrong';
  assert.throws(() => analyzePauses(broken), /Final text/);
});

test('results are deterministic and detached from deeply frozen source records and options', () => {
  const r = recording(); r.edit(100); r.edit(2100);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const trace = freeze(r.trace), options = freeze({ range: { startMs: 100, endMs: 2100 } });
  const before = JSON.stringify(trace), first = analyzePauses(trace, options);
  assert.deepEqual(first, analyzePauses(trace, options));
  first.pauses[0].selectionAfterPrevious.start = 100;
  first.options.range.startMs = 500;
  assert.equal(JSON.stringify(trace), before);
  assert.equal(options.range.startMs, 100);
});
