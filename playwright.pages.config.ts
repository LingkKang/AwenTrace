import { defineConfig } from '@playwright/test';
import browserConfig from './playwright.config.js';

export default defineConfig({
  ...browserConfig,
  projects: [
    {
      name: 'pages-project',
      testMatch: 'demo.spec.ts',
      use: { baseURL: 'http://127.0.0.1:4174/AwenTrace/' },
    },
    {
      name: 'pages-domain',
      testMatch: 'demo.spec.ts',
      use: { baseURL: 'http://127.0.0.1:4175/' },
    },
  ],
  webServer: [
    {
      command: 'npm run preview:demo -- --host 127.0.0.1 --port 4174 --strictPort --base /AwenTrace/',
      url: 'http://127.0.0.1:4174/AwenTrace/',
      reuseExistingServer: false,
    },
    {
      command: 'npm run preview:demo -- --host 127.0.0.1 --port 4175 --strictPort --base /',
      url: 'http://127.0.0.1:4175/',
      reuseExistingServer: false,
    },
  ],
});
