import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  outputDir: 'test-results/playwright/artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/playwright/html', open: 'never' }],
    ['json', { outputFile: 'test-results/playwright/results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 980 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testDir: './test/browser',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      testDir: './test/browser',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      testDir: './test/browser',
      use: { browserName: 'webkit' },
    },
    {
      name: 'electron',
      testDir: './test/electron',
      testMatch: '**/native.spec.ts',
      fullyParallel: false,
      retries: 0,
    },
  ],
  webServer: {
    // Playwright starts webServer before globalSetup, so build in this command.
    command:
      'node scripts/build.mjs && node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort',
    cwd: __dirname,
    url: 'http://127.0.0.1:4173/dist/viewer/index.html',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
