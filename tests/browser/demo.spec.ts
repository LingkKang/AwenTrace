import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { reconstructText } from '../../src/index.js';
import type { Trace } from '../../src/index.js';

async function downloadText(page: Page, format: string) {
  await page.getByLabel('Export', { exact: true }).selectOption(format);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(new RegExp(`^awentrace-.+\\.${format}$`));
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Download stream unavailable');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(await download.failure()).toBeNull();
  return Buffer.concat(chunks).toString('utf8');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('start, finish and restart a session through the demo UI', async ({ page }, testInfo) => {
  const writer = page.getByRole('textbox', { name: 'Your writing' });
  const download = page.getByRole('button', { name: 'Download', exact: true });
  await expect(writer).toHaveJSProperty('readOnly', true);
  await expect(download).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(writer).toBeEditable();
  await writer.pressSequentially('A writing process.');
  await expect(page.getByRole('status')).toHaveText('Recording');
  const active: Trace = JSON.parse(await downloadText(page, 'json'));
  expect(active.stopped).toBe(false);
  expect(reconstructText(active)).toBe('A writing process.');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Finished');
  await expect(writer).toHaveJSProperty('readOnly', true);
  await expect(writer).toHaveValue('A writing process.');
  await page.screenshot({ path: testInfo.outputPath('demo-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('demo-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(writer).toHaveValue('');
  await writer.pressSequentially('Fresh start.');
  const next: Trace = JSON.parse(await downloadText(page, 'json'));
  expect(next.header.sessionId).not.toBe(active.header.sessionId);
  expect(next.header.initialText).toBe('');
  expect(next.stopped).toBe(false);
  expect(reconstructText(next)).toBe('Fresh start.');
  expect(JSON.stringify(next)).not.toContain('A writing process.');
});

test('download a finished session as JSON, JSONL and CSV', async ({ page }) => {
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your writing' }).pressSequentially('Export this session.');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  const trace: Trace = JSON.parse(await downloadText(page, 'json'));
  expect(trace.stopped).toBe(true);
  expect(reconstructText(trace)).toBe('Export this session.');
  expect(trace.events.at(-1)?.kind).toBe('stop');
  await expect(page.locator('#event-count')).toHaveText(String(trace.events.length));
  const lines = (await downloadText(page, 'jsonl')).trim().split('\n').map(line => JSON.parse(line));
  expect(lines[0]).toEqual({ record: 'header', ...trace.header });
  expect(lines.slice(1, -1)).toEqual(trace.events.map(event => ({ record: 'event', ...event })));
  expect(lines.at(-1)).toEqual({ record: 'footer', finalText: trace.finalText, stopped: true });
  const csv = (await downloadText(page, 'csv')).trim().split('\r\n');
  expect(csv[0]).toContain('sequence,kind,elapsed_ms');
  expect(csv).toHaveLength(trace.events.length + 1);
  expect(csv.at(-1)).toContain('"stop"');
});
