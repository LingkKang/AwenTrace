import test from 'node:test';
import assert from 'node:assert/strict';
import { isAscii, applyDelta, reconstructText, toJSON, toJSONL, toCSV } from '../dist/index.js';
import { textDelta } from '../dist/text.js';

const selection = (start, end = start) => ({ start, end, direction: 'none' });
test('ASCII includes newlines and tabs, rejects non-ASCII', () => {
  assert.equal(isAscii('Hello\n\tASCII!'), true); assert.equal(isAscii('café'), false);
});
test('observed caret disambiguates insertion in repeated text', () => {
  const d = textDelta('aaa', 'aaaa', selection(1), selection(2), 'insertText');
  assert.deepEqual(d, { start: 1, removed: '', inserted: 'a', locationBasis: 'selection' });
});
test('selection replacement, backward and forward deletion', () => {
  for (const [before, after, sel, next, type] of [
    ['hello world', 'hello earth', selection(6, 11), selection(11), 'insertText'],
    ['aaa', 'aa', selection(1), selection(0), 'deleteContentBackward'],
    ['aaa', 'aa', selection(1), selection(1), 'deleteContentForward'],
    ['hello world', 'hello ', selection(11), selection(6), 'deleteWordBackward'],
  ]) assert.equal(applyDelta(before, textDelta(before, after, sel, next, type)), after);
});
test('fallback patches reconstruct randomized ASCII edits', () => {
  let seed = 23;
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  let text = '';
  for (let i = 0; i < 1500; i++) {
    const start = random(text.length + 1), end = start + random(text.length - start + 1);
    const after = text.slice(0, start) + String.fromCharCode(32 + random(95)).repeat(random(8)) + text.slice(end);
    const delta = textDelta(text, after, null, selection(start), 'unknown');
    assert.equal(delta ? applyDelta(text, delta) : text, after); text = after;
  }
});
test('invalid patches fail instead of silently corrupting text', () => {
  assert.throws(() => applyDelta('abc', { start: -1, removed: '', inserted: '' }));
  assert.throws(() => applyDelta('abc', { start: 1, removed: 'x', inserted: '' }));
});

test('Unicode deltas keep code point boundaries without normalizing text', () => {
  for (const [before, after] of [
    ['😀', '😁'], ['\u{10000}', '\u{10400}'], ['A😀B', 'A😁B'],
    ['👩🏽‍💻', '👩🏻‍💻'], ['🇭🇰', '🇯🇵'], ['café', 'cafe\u0301'],
    ['It’s “English”—中文', 'It’s “English”—日本語'], ['e\u0301', 'e'],
  ]) {
    const delta = textDelta(before, after, null, selection(after.length), 'unknown');
    assert.equal(applyDelta(before, delta), after);
    assert.equal(delta.removed.isWellFormed(), true);
    assert.equal(delta.inserted.isWellFormed(), true);
  }
  const fallback = textDelta('😀', '😁', selection(1, 2), selection(2), 'insertText');
  assert.deepEqual(fallback, { start: 0, removed: '😀', inserted: '😁', locationBasis: 'text-difference' });
  const observed = textDelta('A😀B', 'A👩🏽‍💻B', selection(1, 3), selection(8), 'insertText');
  assert.equal(observed.locationBasis, 'selection');
  assert.equal(applyDelta('A😀B', observed), 'A👩🏽‍💻B');
});

test('random Unicode and arbitrary UTF-16 edits reconstruct through JSON serialization', () => {
  let seed = 73;
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const alphabet = ['a', '’', '—', 'é', 'e\u0301', '中', '日', '한', 'ع', 'क', '😀', '😁', '👩🏽‍💻', '🇭🇰', '\n', '\u00a0'];
  for (const arbitraryUTF16 of [false, true]) {
    let text = 'English 😀 中文';
    for (let i = 0; i < 1200; i++) {
      const units = arbitraryUTF16 ? text.split('') : [...text];
      const start = random(units.length + 1), end = start + random(units.length - start + 1);
      const after = units.slice(0, start).join('') + alphabet[random(alphabet.length)].repeat(random(3)) + units.slice(end).join('');
      const delta = textDelta(text, after, null, selection(0), 'unknown');
      assert.equal(delta ? applyDelta(text, JSON.parse(JSON.stringify(delta))) : text, after);
      if (delta && !arbitraryUTF16) {
        assert.equal(delta.removed.isWellFormed(), true);
        assert.equal(delta.inserted.isWellFormed(), true);
      }
      text = after;
    }
  }
});
const trace = () => ({ header: { schema: 'awentrace/0.1', sessionId: 's', initialText: '' },
  finalText: 'hello', stopped: false, events: [{ sessionId: 's', sequence: 1, kind: 'input',
    elapsedMs: 12, wallTime: '2026-10-10T00:00:00Z', domTimeStamp: 20, trusted: true,
    state: { revision: 1, textLength: 5, selection: selection(5) },
    payload: { fromRevision: 0, toRevision: 1, delta: { start: 0, removed: '', inserted: 'hello' } } }] });
test('reconstruction verifies versions, sequence and final product', () => {
  assert.equal(reconstructText(trace()), 'hello');
  const gap = trace(); gap.events[0].sequence = 2; assert.throws(() => reconstructText(gap));
  const revision = trace(); revision.events[0].payload.toRevision = 9; assert.throws(() => reconstructText(revision));
  const bad = trace(); bad.finalText = 'other'; assert.throws(() => reconstructText(bad));
});
test('exports preserve JSON data, JSONL framing and CSV escaping', () => {
  const t = trace(); assert.deepEqual(JSON.parse(toJSON(t)), t);
  assert.deepEqual(toJSONL(t).trim().split('\n').map(line => JSON.parse(line).record), ['header', 'event', 'footer']);
  assert.match(toCSV(t), /payload_json\r\n/); assert.match(toCSV(t), /""inserted"":/);
});
