import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: true, forbidOnly: !!process.env.CI,
  retries: 0, workers: 2, reporter: 'list',
  projects: [
    { name: 'library', testMatch: ['recorder.spec.ts', 'unicode.spec.ts'] },
    { name: 'demo', testMatch: 'demo.spec.ts' },
  ],
  use: { baseURL: 'http://127.0.0.1:5174', browserName: 'chromium',
    headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
});
