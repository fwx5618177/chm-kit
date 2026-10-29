import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './test/browser/global-setup.ts',
  outputDir: 'test-results/browser/artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/browser/html', open: 'never' }],
    ['json', { outputFile: 'test-results/browser/results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 980 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort',
    cwd: __dirname,
    url: 'http://127.0.0.1:4173/examples/browser/index.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
