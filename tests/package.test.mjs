import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

test('the npm tarball works in an independent consumer', async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'awentrace-package-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const consumer = path.join(temporary, 'consumer');
  await mkdir(consumer);
  const run = (entry, args, cwd) => execFileSync(process.execPath, [entry, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, npm_config_loglevel: 'silent' },
  });
  assert.ok(process.env.npm_execpath, 'Run this test with npm run test:package');
  const npm = (args, cwd) => run(process.env.npm_execpath, args, cwd);
  // Run the real prepack build; install the tarball rather than linking the repository.
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', temporary], repository));
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'awentrace-package-consumer', private: true, type: 'module',
  }));
  npm(['install', path.join(temporary, packed.filename), '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], consumer);
  const installed = path.join(consumer, 'node_modules', 'awentrace');

  await t.test('includes linked documents and map sources without development artifacts', async () => {
    const files = packed.files.map(file => file.path);
    for (const required of ['LICENSE', 'README.md', 'dist/index.js', 'dist/index.d.ts', 'src/index.ts', 'docs/architecture.md']) {
      assert.ok(files.includes(required), required);
    }
    for (const file of files) {
      assert.ok(['LICENSE', 'README.md', 'package.json', 'docs/architecture.md'].includes(file) ||
        /^dist\/.+\.(js|js\.map|d\.ts|d\.ts\.map)$/.test(file) || /^src\/.+\.ts$/.test(file),
      'Unexpected published file: ' + file);
      if (!file.endsWith('.map')) continue;
      const map = JSON.parse(await readFile(path.join(installed, file), 'utf8'));
      for (const source of map.sources) {
        await access(path.resolve(installed, path.dirname(file), map.sourceRoot ?? '', source));
      }
    }
    for (const document of ['README.md', 'docs/architecture.md']) {
      const markdown = await readFile(path.join(installed, document), 'utf8');
      for (const [, link] of markdown.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^(https?:|#)/.test(link)) continue;
        await access(path.resolve(installed, path.dirname(document), link.split('#')[0]));
      }
    }
  });

  await t.test('imports the public ESM entry point without a DOM', async () => {
    await writeFile(path.join(consumer, 'smoke.mjs'), `
      import assert from 'node:assert/strict';
      import { createTrace, isAscii, applyDelta, reconstructText, toJSON, toJSONL, toCSV } from 'awentrace';
      for (const fn of [createTrace, reconstructText, toJSON, toJSONL, toCSV]) assert.equal(typeof fn, 'function');
      assert.equal(isAscii('hello'), true);
      assert.equal(applyDelta('hello', { start: 5, removed: '', inserted: '!', locationBasis: 'selection' }), 'hello!');
    `);
    run(path.join(consumer, 'smoke.mjs'), [], consumer);
  });

  const consumerSource = `
    import { createTrace, reconstructText, toJSONL, type Recorder, type Trace } from 'awentrace';
    declare global {
      interface Window {
        awenPackage: { recorder: Recorder; reconstructText: typeof reconstructText; toJSONL: typeof toJSONL };
      }
    }
    const recorder = createTrace({
      target: document.querySelector<HTMLTextAreaElement>('#writing')!,
      onEvent(event) { if (event.kind === 'input') console.assert(typeof event.payload.inputType === 'string'); },
    });
    const snapshot: Trace = recorder.getTrace();
    reconstructText(snapshot);
    window.awenPackage = { recorder, reconstructText, toJSONL };
  `;
  await writeFile(path.join(consumer, 'consumer.ts'), consumerSource);

  await t.test('resolves public TypeScript declarations with strict checking', () => {
    run(path.resolve(path.dirname(require.resolve('typescript/package.json')), require('typescript/package.json').bin.tsc), [
      '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts',
    ], consumer);
  });

  await t.test('bundles and records browser input through the installed package', async () => {
    await writeFile(path.join(consumer, 'index.html'),
      '<textarea id="writing"></textarea><script type="module" src="./consumer.ts"></script>');
    run(path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), ['build'], consumer);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const build = path.join(consumer, 'dist');
      await page.route('http://localhost/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        const file = path.join(build, pathname === '/' ? 'index.html' : pathname);
        if (!file.startsWith(build + path.sep)) return route.abort();
        await route.fulfill({
          contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html',
          body: await readFile(file),
        });
      });
      await page.goto('http://localhost/');
      await page.waitForFunction(() => window.awenPackage);
      await page.locator('#writing').pressSequentially('Hello from npm');
      const result = await page.evaluate(() => {
        const { recorder, reconstructText, toJSONL } = window.awenPackage;
        const trace = recorder.stop();
        return { text: reconstructText(trace), stopped: trace.stopped, moves: trace.header.capturePointerMoves,
          inputCount: trace.events.filter(event => event.kind === 'input').length,
          footer: JSON.parse(toJSONL(trace).trim().split('\n').at(-1)) };
      });
      assert.equal(result.text, 'Hello from npm');
      assert.equal(result.stopped, true);
      assert.equal(result.moves, false);
      assert.ok(result.inputCount > 0);
      assert.deepEqual(result.footer, { record: 'footer', finalText: 'Hello from npm', stopped: true });
    } finally { await browser.close(); }
  });
});
