import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const read = (page: Page) => page.evaluate(() => window.awenTest.recorder.getTrace());

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/fixtures/editor.html');
  await page.locator('#writer').focus();
});

test('real ASCII typing, deletion and newline reconstruct exactly with linked beforeinput', async ({ page }) => {
  await page.locator('#writer').pressSequentially('Hello world!');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Enter');
  await page.keyboard.type('Next line.');
  const trace = await read(page);
  expect(trace.finalText).toBe('Hello world\nNext line.');
  const edits = trace.events.filter(e => e.kind === 'input');
  expect(edits.length).toBeGreaterThan(15);
  expect(edits.every(e => e.payload.supported && e.payload.beforeInputSequence !== null)).toBe(true);
  expect(edits.every(e => e.trusted)).toBe(true);
  expect(trace.events.some(e => e.kind === 'keyup' && e.payload.downSequence !== null)).toBe(true);
  expect(await page.evaluate(() => window.awenTest.reconstructText(window.awenTest.recorder.stop()))).toBe(trace.finalText);
  expect(trace.events.every((e, i) => e.sequence === i + 1 && e.elapsedMs >= 0)).toBe(true);
  expect(trace.events.every((e, i) => !i || e.elapsedMs >= trace.events[i - 1]!.elapsedMs)).toBe(true);
});

test('repeated letters retain the actual insertion position and selected replacement', async ({ page }) => {
  await page.keyboard.type('aaa');
  await page.locator('#writer').evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(1, 1));
  await page.keyboard.type('a');
  let trace = await read(page);
  const edit = trace.events.filter(e => e.kind === 'input').at(-1)!;
  expect(edit.payload.delta?.start).toBe(1);
  expect(edit.payload.delta?.locationBasis).toBe('selection');
  await page.locator('#writer').evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(1, 3));
  await page.keyboard.type('B');
  trace = await read(page);
  expect(trace.finalText).toBe('aBa');
  expect(trace.events.filter(e => e.kind === 'input').at(-1)!.payload.delta?.removed).toBe('aa');
});

test('copy, cut and real system clipboard paste preserve evidence and text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.type('Hello world');
  await page.locator('#writer').evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+x');
  expect(await page.locator('#writer').inputValue()).toBe(' world');
  await page.evaluate(() => navigator.clipboard.writeText('Fresh\nASCII'));
  await page.keyboard.press('Control+v');
  const trace = await read(page);
  expect(trace.finalText).toBe('Fresh\nASCII world');
  const copied = trace.events.find(e => e.kind === 'copy');
  expect(copied?.payload.text).toBe('Hello');
  expect(copied?.payload.textSource).toBe('selection');
  expect(trace.events.some(e => e.kind === 'cut' && e.trusted)).toBe(true);
  expect(trace.events.some(e => e.kind === 'paste' && e.payload.text === 'Fresh\nASCII' && e.trusted)).toBe(true);
  expect(trace.events.some(e => e.kind === 'input' && e.payload.inputType === 'insertFromPaste')).toBe(true);
});

test('paste without preceding keydown is captured through clipboard and input events', async ({ page }) => {
  // Synthetic event sequence represents a menu paste. Native keyboard paste is tested separately.
  await page.evaluate(() => {
    const el = document.querySelector<HTMLTextAreaElement>('#writer')!;
    const data = new DataTransfer(); data.setData('text/plain', 'menu paste');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: 'menu paste', bubbles: true }));
    el.value = 'menu paste'; el.setSelectionRange(10, 10);
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: 'menu paste', bubbles: true }));
  });
  const trace = await read(page);
  expect(trace.finalText).toBe('menu paste');
  expect(trace.events.filter(e => e.kind === 'keydown')).toHaveLength(0);
  expect(trace.events.find(e => e.kind === 'paste')?.trusted).toBe(false);
});

test('non-text keys, modifiers, repeats and selection-only changes are retained', async ({ page }) => {
  await page.keyboard.type('text');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.down('a'); await page.keyboard.down('a'); await page.keyboard.up('a');
  const trace = await read(page);
  expect(trace.events.some(e => e.kind === 'keydown' && e.payload.key === 'ArrowLeft')).toBe(true);
  expect(trace.events.some(e => e.kind === 'keydown' && e.payload.modifiers.shift)).toBe(true);
  expect(trace.events.some(e => e.kind === 'keydown' && e.payload.repeat)).toBe(true);
  expect(trace.events.some(e => e.kind === 'selection' && e.payload.current.start !== e.payload.current.end)).toBe(true);
});

test('mouse and pointer coordinates, clicks, context menu, movement and wheel are captured', async ({ page }) => {
  const editor = page.locator('#writer');
  await editor.click(); await editor.dblclick(); await editor.click({ button: 'right' });
  await page.keyboard.press('Escape');
  const bounds = (await editor.boundingBox())!;
  await page.mouse.move(bounds.x + 40, bounds.y + 50, { steps: 4 });
  await page.mouse.wheel(0, 70);
  await expect.poll(async () => (await read(page)).events.some(e => e.kind === 'wheel')).toBe(true);
  const trace = await read(page);
  for (const kind of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'mousemove', 'pointermove']) {
    expect(trace.events.some(e => e.kind === kind), kind).toBe(true);
  }
  const click = trace.events.find(e => e.kind === 'click')!;
  expect(click.payload.client.x).toBeGreaterThan(0);
  expect(click.payload.withinEditor).toBe(true);
});

test('pointer release outside the editor is retained without collecting unrelated clicks', async ({ page }) => {
  const box = (await page.locator('#writer').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 30); await page.mouse.down();
  await page.mouse.move(10, 10); await page.mouse.up();
  const trace = await read(page);
  expect(trace.events.some(e => e.kind === 'mouseup' && !e.payload.withinEditor)).toBe(true);
  expect(trace.events.some(e => e.kind === 'pointerup' && !e.payload.withinEditor)).toBe(true);
  const count = trace.events.filter(e => e.kind === 'click').length;
  await page.mouse.click(10, 10);
  expect((await read(page)).events.filter(e => e.kind === 'click')).toHaveLength(count);
});

test('another textarea is outside capture scope', async ({ page }) => {
  await page.evaluate(() => {
    const other = document.createElement('textarea'); other.id = 'other'; document.body.append(other);
  });
  await page.locator('#other').fill('PRIVATE');
  await page.locator('#other').pressSequentially('SECRET');
  const trace = await read(page);
  expect(JSON.stringify(trace)).not.toContain('PRIVATE');
  expect(JSON.stringify(trace)).not.toContain('SECRET');
  expect(trace.events.filter(e => e.kind === 'keydown')).toHaveLength(0);
});

test('unsupported undo and non-ASCII changes are flagged without losing reconstruction', async ({ page }) => {
  await page.keyboard.type('ASCII'); await page.keyboard.press('Control+z');
  await page.keyboard.insertText('中文');
  const trace = await read(page);
  expect(trace.events.some(e => e.kind === 'input' && e.payload.inputType === 'historyUndo' && !e.payload.supported)).toBe(true);
  expect(trace.events.some(e => e.kind === 'input' && e.payload.issues.includes('non-ascii-out-of-scope'))).toBe(true);
  expect(await page.evaluate(() => window.awenTest.reconstructText(window.awenTest.recorder.getTrace()))).toBe(trace.finalText);
});

test('programmatic value change produces an explicit checkpoint', async ({ page }) => {
  await page.keyboard.type('before');
  await page.locator('#writer').evaluate((el: HTMLTextAreaElement) => { el.value = 'external update'; });
  const trace = await read(page);
  const checkpoint = trace.events.find(e => e.kind === 'checkpoint');
  expect(checkpoint?.payload.text).toBe('external update');
  expect(checkpoint?.payload.supported).toBe(false);
  expect(await page.evaluate(() => window.awenTest.reconstructText(window.awenTest.recorder.getTrace()))).toBe('external update');
});

test('cancelled beforeinput does not lend its selection to a later input', async ({ page }) => {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLTextAreaElement>('#writer')!;
    el.addEventListener('beforeinput', e => e.preventDefault(), { once: true });
    el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'X', cancelable: true }));
  });
  await page.evaluate(() => {
    const el = document.querySelector<HTMLTextAreaElement>('#writer')!;
    el.value = 'Y'; el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'Y' }));
  });
  const input = (await read(page)).events.find(e => e.kind === 'input')!;
  expect(input.payload.beforeInputSequence).toBeNull();
});

test('stop is idempotent, detaches listeners, permits a new recorder', async ({ page }) => {
  await page.keyboard.type('done');
  const result = await page.evaluate(() => {
    const recorder = window.awenTest.recorder;
    const first = recorder.stop(), second = recorder.stop();
    const el = document.querySelector<HTMLTextAreaElement>('#writer')!;
    const next = window.awenTest.createTrace({ target: el });
    next.mark('new-session'); next.stop();
    return { first, second, count: recorder.eventCount };
  });
  expect(result.first).toEqual(result.second);
  await page.keyboard.type('ignored');
  expect((await read(page)).events).toHaveLength(result.count);
});

test('snapshots are detached and subscriber errors cannot interrupt capture', async ({ page }) => {
  await page.evaluate(() => {
    window.awenTest.recorder.subscribe(() => { throw new Error('sink failed'); });
    const exported = window.awenTest.recorder.getTrace(); exported.events.length = 0; exported.header.initialText = 'corruption';
  });
  await page.keyboard.type('safe');
  const trace = await read(page);
  expect(trace.header.initialText).toBe(''); expect(trace.events[0]!.kind).toBe('start');
  expect(trace.finalText).toBe('safe');
});

test('duplicate attachment and non-ASCII initial text are rejected', async ({ page }) => {
  const result = await page.evaluate(() => {
    const el = document.querySelector<HTMLTextAreaElement>('#writer')!;
    let duplicate = false, unicode = false;
    try { window.awenTest.createTrace({ target: el }); } catch { duplicate = true; }
    const other = document.createElement('textarea'); other.value = 'é';
    try { window.awenTest.createTrace({ target: other }); } catch { unicode = true; }
    return { duplicate, unicode };
  });
  expect(result).toEqual({ duplicate: true, unicode: true });
});

test('movement can be disabled without losing clicks', async ({ page }) => {
  await page.evaluate(() => {
    window.awenTest.recorder.stop();
    const target = document.querySelector<HTMLTextAreaElement>('#writer')!;
    const recorder = window.awenTest.createTrace({ target, capturePointerMoves: false });
    window.awenTest.recorder = recorder;
  });
  await page.locator('#writer').click();
  const trace = await read(page);
  expect(trace.events.some(e => e.kind === 'click')).toBe(true);
  expect(trace.events.some(e => e.kind === 'pointermove' || e.kind === 'mousemove')).toBe(false);
});

test('blur reports interrupted keys and never fabricates their release', async ({ page }) => {
  await page.keyboard.down('Shift');
  await page.evaluate(() => document.querySelector<HTMLTextAreaElement>('#writer')!.blur());
  await page.keyboard.up('Shift');
  const trace = await read(page);
  expect(trace.events.some(e => e.kind === 'blur' && e.payload.interruptedKeys.includes('ShiftLeft:1'))).toBe(true);
  expect(trace.events.some(e => e.kind === 'keyup' && e.payload.key === 'Shift')).toBe(false);
});

test('reentrant stop from a subscriber cannot duplicate stop or leak listeners', async ({ page }) => {
  const trace = await page.evaluate(() => {
    const recorder = window.awenTest.recorder;
    recorder.subscribe(event => { if (event.kind === 'stop') recorder.stop(); });
    return recorder.stop();
  });
  expect(trace.events.filter(e => e.kind === 'stop')).toHaveLength(1);
  expect(trace.stopped).toBe(true);
});

test('subscribers receive sequence order even when another subscriber adds a marker', async ({ page }) => {
  const sequences = await page.evaluate(() => {
    const recorder = window.awenTest.recorder;
    const seen: number[] = [];
    recorder.subscribe(event => { if (event.kind === 'marker' && event.payload.name === 'outer') recorder.mark('inner'); });
    recorder.subscribe(event => seen.push(event.sequence));
    recorder.mark('outer');
    return seen;
  });
  expect(sequences).toHaveLength(2);
  expect(sequences[1]).toBe(sequences[0]! + 1);
});

test('stop from an event subscriber still delivers the stop event to the remaining sinks', async ({ page }) => {
  const kinds = await page.evaluate(() => {
    const recorder = window.awenTest.recorder;
    const seen: string[] = [];
    recorder.subscribe(event => { if (event.kind === 'marker') recorder.stop(); });
    recorder.subscribe(event => seen.push(event.kind));
    recorder.mark('finish');
    return seen;
  });
  expect(kinds).toEqual(['marker', 'stop']);
});

test('lifecycle, offline/online, resize and research markers share one sequence', async ({ page, context }) => {
  await page.setViewportSize({ width: 1100, height: 750 });
  await context.setOffline(true);
  await expect.poll(async () => (await read(page)).events.some(e => e.kind === 'online' && !e.payload.online)).toBe(true);
  await context.setOffline(false);
  await page.evaluate(() => window.awenTest.recorder.mark('feedback-shown', { feedbackId: 'f1' }));
  await page.locator('#writer').evaluate((el: HTMLTextAreaElement) => el.blur());
  await page.evaluate(() => window.awenTest.recorder.stop());
  const trace = await read(page);
  expect(trace.events.some(e => e.kind === 'resize')).toBe(true);
  expect(trace.events.some(e => e.kind === 'blur' && e.payload.scope === 'editor')).toBe(true);
  expect(trace.events.some(e => e.kind === 'marker' && e.payload.name === 'feedback-shown')).toBe(true);
  expect(trace.stopped).toBe(true);
});
