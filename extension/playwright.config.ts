import { defineConfig } from '@playwright/test';

// Extensions need a persistent context; the fixture in tests/e2e/fixtures.ts launches it.
// Headless works with the bundled Chromium via `channel: 'chromium'` (playwright.dev/docs/chrome-extensions).
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
});
