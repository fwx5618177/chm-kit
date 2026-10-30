import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test as base, expect } from '@playwright/test';

import type { PackFilesOptions } from '../../src/encoder/archive-builder';
import manifest from '../fixtures/pychm-example/manifest.json';

const root = resolve(__dirname, '../..');
export const browserModulePath = '/dist/browser/index.mjs';
export const workerModulePath = '/dist/browser/worker.mjs';
export const resourcesModulePath = '/dist/browser/resources.mjs';

async function requireBrowserArtifacts(): Promise<void> {
  for (const modulePath of [
    browserModulePath,
    workerModulePath,
    resourcesModulePath,
  ]) {
    try {
      await access(resolve(root, modulePath.slice(1)));
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
      throw new Error(
        `Missing browser build artifact: ${modulePath}. Run pnpm build with all browser entries configured; source fallbacks are not permitted.`,
        { cause: error },
      );
    }
  }
}
export type OracleFile = [name: string, bytes: number[]];

interface BrowserActivity {
  errors: string[];
  external: string[];
  probes: string[];
}

interface BrowserFixtures {
  browserActivity: BrowserActivity;
  expectedFiles: OracleFile[];
}

export const test = base.extend<BrowserFixtures>({
  browserActivity: [
    async ({ page, baseURL, browser }, use, testInfo) => {
      const activity: BrowserActivity = {
        errors: [],
        external: [],
        probes: [],
      };
      if (!baseURL) throw new Error('Browser tests require a baseURL');
      const origin = new URL(baseURL).origin;
      const consoleErrors: string[] = [];
      await requireBrowserArtifacts();
      testInfo.annotations.push({
        type: 'browser-version',
        description: browser.version(),
      });
      page.on('request', request => {
        if (request.url().includes('/preview-probe'))
          activity.probes.push(request.url());
      });
      page.on('pageerror', error => activity.errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      await page.route('**/*', route => {
        const url = route.request().url();
        if (/^https?:/.test(url) && new URL(url).origin !== origin) {
          activity.external.push(url);
          return route.abort();
        }
        return route.fallback();
      });
      await page.goto('/examples/browser/index.html', {
        waitUntil: 'networkidle',
      });
      await use(activity);
      if (consoleErrors.length)
        await testInfo.attach('browser-console-errors', {
          body: consoleErrors.join('\n'),
          contentType: 'text/plain',
        });
      expect(activity.errors, 'uncaught browser errors').toEqual([]);
    },
    { auto: true },
  ],
  // Playwright requires a destructured first argument, even without dependencies.
  // eslint-disable-next-line no-empty-pattern
  expectedFiles: async ({}, use) => {
    const files = await Promise.all(
      manifest.files.map(async (entry): Promise<OracleFile> => [
        entry.name,
        [
          ...(await readFile(
            resolve(root, 'test/fixtures/pychm-example', entry.expectedFile),
          )),
        ],
      ]),
    );
    await use(files);
  },
});

// Defer importing build output until a test runs: --list needs no existing dist.
export async function packArchive(
  files: ReadonlyMap<string, Uint8Array>,
  options?: PackFilesOptions,
): Promise<Buffer> {
  const moduleURL = pathToFileURL(resolve(root, 'dist/esm/index.mjs')).href;
  const { packFiles } = (await import(
    moduleURL
  )) as typeof import('../../src/index');
  return packFiles(files, options);
}

export { expect };
