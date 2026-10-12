import { test, expect } from '@playwright/test';
import { reconstructText } from '../../src/index.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/fixtures/editor.html');
  await page.waitForFunction(() => window.awenTest);
  await page.locator('#writer').focus();
});

for (const gzip of [false, true]) test(`Unicode initial text, native paste and subsequent English survive exports (gzip=${gzip})`, async ({ page, context }) => {
  const initial = 'It’s “English”—café e\u0301 😀 👩🏽‍💻 中文 日本語 한글 العربية हिन्दी';
  const pasted = '\n“quoted”, emoji 👨‍👩‍👧‍👦 🇭🇰\u00a0';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(({ initial, gzip }) => {
    const { createTrace, recorder } = window.awenTest;
    recorder.stop();
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    target.value = initial;
    target.setSelectionRange(initial.length, initial.length);
    window.awenTest.recorder = createTrace({ target, gzip });
  }, { initial, gzip });
  await page.evaluate(text => navigator.clipboard.writeText(text), pasted);
  await page.keyboard.press('Control+v');
  await page.keyboard.type('English');
  const result = await page.evaluate(async () => {
    const { recorder, toJSON, toJSONL, toCSV, reconstructText } = window.awenTest;
    const trace = recorder.stop();
    const decode = (stream: ReadableStream<Uint8Array<ArrayBuffer>>) => new Response(
      recorder.gzip ? stream.pipeThrough(new DecompressionStream('gzip')) : stream).text();
    const blob = await recorder.exportJSONL();
    return { trace, reconstructed: reconstructText(JSON.parse(toJSON(trace))), jsonl: toJSONL(trace),
      blob: await decode(blob.stream()), stream: await decode(recorder.streamJSONL()),
      csv: await new Blob([toCSV(trace)], { type: 'text/csv;charset=utf-8' }).text() };
  });
  expect(result.trace.header.supportedInput).toBe('unicode');
  expect(result.trace.header.positionUnit).toBe('utf16-code-unit');
  expect(result.trace.header.initialText).toBe(initial);
  expect(result.reconstructed).toBe(initial + pasted + 'English');
  expect(result.blob).toBe(result.jsonl);
  expect(result.stream).toBe(result.jsonl);
  const records = result.jsonl.trim().split('\n').map(line => JSON.parse(line));
  expect(records[0].initialText).toBe(initial);
  expect(records.at(-1).finalText).toBe(result.reconstructed);
  const edits = result.trace.events.filter(event => event.kind === 'input');
  expect(edits.some(event => event.payload.inputType === 'insertFromPaste')).toBe(true);
  expect(edits.every(event => event.payload.supported)).toBe(true);
  expect(edits.at(-1)?.state.ascii).toBe(false);
  for (const edit of edits) expect(result.csv).toContain(JSON.stringify(edit.payload).replaceAll('"', '""'));
});

test('native selection replacement, deletion and Unicode checkpoints preserve exact UTF-16 text', async ({ page }) => {
  await page.keyboard.insertText('A😀B');
  await page.locator('#writer').evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(1, 3));
  await page.keyboard.insertText('👩🏽‍💻');
  let trace = await page.evaluate(() => window.awenTest.recorder.getTrace());
  expect(reconstructText(trace)).toBe('A👩🏽‍💻B');
  const replacement = trace.events.filter(event => event.kind === 'input').at(-1)!;
  expect(replacement.payload.delta).toMatchObject({ start: 1, removed: '😀', inserted: '👩🏽‍💻', locationBasis: 'selection' });
  await page.locator('#writer').evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(1, 8));
  await page.keyboard.press('Backspace');
  trace = await page.evaluate(() => window.awenTest.recorder.getTrace());
  expect(reconstructText(trace)).toBe('AB');
  const value = 'cafe\u0301\u00a0“中文”—\ud800';
  const result = await page.evaluate(value => {
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    target.value = value;
    window.awenTest.recorder.sync();
    return JSON.parse(window.awenTest.toJSON(window.awenTest.recorder.stop()));
  }, value);
  expect(reconstructText(result)).toBe(value);
  expect(result.events.find((event: { kind: string }) => event.kind === 'checkpoint').payload.supported).toBe(false);
});

for (const finalAfterEnd of [false, true]) test(`composition records provisional replacements and commit boundaries (final input after end=${finalAfterEnd})`, async ({ page }) => {
  await page.evaluate(finalAfterEnd => {
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    const composition = (kind: string, data: string) => target.dispatchEvent(new CompositionEvent(kind, { data, bubbles: true }));
    const edit = (value: string, inputType: string, isComposing: boolean) => {
      target.dispatchEvent(new InputEvent('beforeinput', { data: value, inputType, isComposing, bubbles: true }));
      target.value = value; target.setSelectionRange(value.length, value.length);
      target.dispatchEvent(new InputEvent('input', { data: value, inputType, isComposing, bubbles: true }));
    };
    composition('compositionstart', '');
    composition('compositionupdate', 'ni'); edit('ni', 'insertCompositionText', true);
    composition('compositionupdate', '你'); edit('你', 'insertCompositionText', true);
    if (finalAfterEnd) composition('compositionend', '你好');
    edit('你好', 'insertText', false);
    if (!finalAfterEnd) composition('compositionend', '你好');
  }, finalAfterEnd);
  // A separate ordinary key action must not inherit the completed composition.
  await page.keyboard.type(' English');
  const trace = await page.evaluate(() => window.awenTest.recorder.stop());
  expect(reconstructText(trace)).toBe('你好 English');
  const start = trace.events.find(event => event.kind === 'compositionstart')!;
  const boundary = trace.events.filter(event => event.kind === 'compositionupdate' || event.kind === 'compositionend');
  expect(boundary.map(event => event.payload.data)).toEqual(['ni', '你', '你好']);
  expect(boundary.every(event => event.payload.startSequence === start.sequence)).toBe(true);
  const edits = trace.events.filter(event => event.kind === 'input');
  expect(edits.slice(0, 3).every(event => !event.payload.supported)).toBe(true);
  expect(edits.slice(0, 3).every(event => event.payload.compositionStartSequence === start.sequence)).toBe(true);
  expect(edits[2]!.payload.nativeComposing).toBe(false);
  expect(edits[2]!.payload.issues).toContain(finalAfterEnd ? 'composition-boundary' : 'composition-out-of-scope');
  expect(edits.slice(3).every(event => event.payload.supported)).toBe(true);
});

test('composition cancellation without edits remains visible and does not poison later input', async ({ page }) => {
  await page.keyboard.type('before');
  await page.evaluate(() => {
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    target.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    target.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'shi' }));
    target.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
  });
  await page.keyboard.type(' after');
  const trace = await page.evaluate(() => window.awenTest.recorder.stop());
  expect(reconstructText(trace)).toBe('before after');
  expect(trace.events.filter(event => event.kind.startsWith('composition')).map(event => event.kind))
    .toEqual(['compositionstart', 'compositionupdate', 'compositionend']);
  expect(trace.events.filter(event => event.kind === 'input').every(event => event.payload.supported)).toBe(true);
});

test('compositionend without a final input reconciles text without inventing a commit event', async ({ page }) => {
  await page.evaluate(() => {
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    target.dispatchEvent(new CompositionEvent('compositionstart'));
    target.value = '日本語';
    target.dispatchEvent(new CompositionEvent('compositionend', { data: '日本語' }));
  });
  await expect.poll(async () => page.evaluate(() => window.awenTest.recorder.getTrace().events
    .some(event => event.kind === 'checkpoint'))).toBe(true);
  const trace = await page.evaluate(() => window.awenTest.recorder.stop());
  expect(reconstructText(trace)).toBe('日本語');
  expect(trace.events.filter(event => event.kind === 'input')).toHaveLength(0);
  const checkpoint = trace.events.find(event => event.kind === 'checkpoint')!;
  expect(checkpoint.payload.supported).toBe(false);
  expect(checkpoint.payload.nativeComposing).toBeNull();
  expect(checkpoint.payload.issues).toContain('composition-boundary');
});

for (const reason of ['pause', 'blur', 'hidden', 'pagehide', 'stop'] as const) test(`unfinished composition is marked on ${reason}`, async ({ page }) => {
  const snapshot = await page.evaluate(reason => {
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    const { recorder } = window.awenTest;
    target.dispatchEvent(new CompositionEvent('compositionstart'));
    target.dispatchEvent(new CompositionEvent('compositionupdate', { data: '한' }));
    target.value = '한';
    target.dispatchEvent(new InputEvent('input', { data: '한', inputType: 'insertCompositionText', isComposing: true }));
    if (reason === 'pause') {
      recorder.pause();
      target.dispatchEvent(new CompositionEvent('compositionend', { data: '한' }));
      recorder.resume();
    } else if (reason === 'blur') target.dispatchEvent(new FocusEvent('blur'));
    else if (reason === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    else if (reason === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide'));
    else recorder.stop();
    return recorder.getTrace();
  }, reason);
  expect(reconstructText(snapshot)).toBe('한');
  expect(snapshot.events.filter(event => event.kind === 'compositionend')).toHaveLength(0);
  const interrupted = snapshot.events.find(event => event.kind === 'compositioninterrupted')!;
  expect(interrupted.payload.reason).toBe(reason);
  expect(interrupted.payload.startSequence).toBe(snapshot.events.find(event => event.kind === 'compositionstart')!.sequence);
  if (reason !== 'stop') {
    await page.locator('#writer').press('End');
    await page.keyboard.type(' English');
    const trace = await page.evaluate(() => window.awenTest.recorder.stop());
    expect(reconstructText(trace)).toBe('한 English');
    expect(trace.events.filter(event => event.kind === 'input').at(-1)?.payload.supported).toBe(true);
  }
});

test('restarted composition preserves the interrupted start and reentrant stop closes live exports', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    const { recorder, toJSONL } = window.awenTest;
    const streaming = new Response(recorder.streamJSONL().pipeThrough(new DecompressionStream('gzip'))).text();
    target.dispatchEvent(new CompositionEvent('compositionstart'));
    target.dispatchEvent(new CompositionEvent('compositionupdate', { data: '仮' }));
    target.dispatchEvent(new CompositionEvent('compositionstart'));
    recorder.subscribe(event => { if (event.kind === 'compositionend') recorder.stop(); });
    target.value = '😀';
    target.dispatchEvent(new CompositionEvent('compositionend', { data: '😀' }));
    const trace = recorder.getTrace();
    const output = await streaming;
    // Any pending reconciliation timer must have been removed on stop.
    await new Promise(resolve => setTimeout(resolve, 0));
    return { trace, afterTimer: recorder.getTrace(), matches: output === toJSONL(trace) };
  });
  expect(reconstructText(result.trace)).toBe('😀');
  expect(result.trace.stopped).toBe(true);
  expect(result.matches).toBe(true);
  expect(result.afterTimer).toEqual(result.trace);
  const starts = result.trace.events.filter(event => event.kind === 'compositionstart');
  expect(starts).toHaveLength(2);
  const interrupted = result.trace.events.find(event => event.kind === 'compositioninterrupted')!;
  expect(interrupted.payload).toEqual({ startSequence: starts[0]!.sequence, reason: 'restart' });
  const checkpoint = result.trace.events.find(event => event.kind === 'checkpoint')!;
  expect(checkpoint.payload.compositionStartSequence).toBe(starts[1]!.sequence);
  expect(checkpoint.payload.issues).toContain('composition-boundary');
});

test('resume from a composition interruption callback follows the recorded pause', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { recorder } = window.awenTest;
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    target.dispatchEvent(new CompositionEvent('compositionstart'));
    const delivered: string[] = [];
    recorder.subscribe(event => {
      delivered.push(event.kind);
      if (event.kind === 'compositioninterrupted') recorder.resume();
    });
    recorder.pause();
    return { trace: recorder.getTrace(), paused: recorder.paused, delivered };
  });
  expect(result.paused).toBe(false);
  expect(result.delivered).toEqual(['compositioninterrupted', 'pause', 'resume']);
  expect(result.trace.events.slice(-3).map(event => event.kind)).toEqual(result.delivered);
  await page.keyboard.type('English');
  const trace = await page.evaluate(() => window.awenTest.recorder.stop());
  expect(reconstructText(trace)).toBe('English');
  expect(trace.events.filter(event => event.kind === 'input').every(event => event.payload.supported)).toBe(true);
});

test('missing compositionstart and replacement text retain evidence without character-based rejection', async ({ page }) => {
  const result = await page.evaluate(() => {
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    target.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'é' }));
    target.value = 'é';
    target.dispatchEvent(new InputEvent('input', { data: 'é', inputType: 'insertText', isComposing: false }));
    target.dispatchEvent(new CompositionEvent('compositionend', { data: 'é' }));
    return window.awenTest.recorder.getTrace();
  });
  const composed = result.events.find(event => event.kind === 'input')!;
  expect(composed.payload.compositionStartSequence).toBeNull();
  expect(composed.payload.composing).toBe(true);
  expect(composed.payload.nativeComposing).toBe(false);
  expect(composed.payload.supported).toBe(false);
  await page.keyboard.type(' ');
  await page.evaluate(() => {
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    target.dispatchEvent(new InputEvent('beforeinput', { data: '“English”', inputType: 'insertReplacementText' }));
    target.value = '“English”';
    target.dispatchEvent(new InputEvent('input', { data: '“English”', inputType: 'insertReplacementText' }));
  });
  const trace = await page.evaluate(() => window.awenTest.recorder.stop());
  expect(reconstructText(trace)).toBe('“English”');
  expect(trace.events.filter(event => event.kind === 'input').at(-1)?.payload.supported).toBe(true);
});
