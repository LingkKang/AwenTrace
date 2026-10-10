import { defineConfig } from '@playwright/test';
import browserConfig from './playwright.config.js';

export default defineConfig({
  ...browserConfig,
  projects: [{ name: 'pages', testMatch: 'demo.spec.ts' }],
  use: { ...browserConfig.use, baseURL: 'http://127.0.0.1:4174/AwenTrace/' },
  webServer: {
    command: 'npm run preview:demo -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/AwenTrace/',
    reuseExistingServer: false,
  },
});
