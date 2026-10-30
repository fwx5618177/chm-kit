/** Bounded, opt-in real Chromium check: pnpm exec tsx test/worker/module-worker.integration.ts */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { packFiles } from '../../src/encoder/archive-builder';

function sampleBytes(): Uint8Array {
  return Uint8Array.from(
    packFiles(
      new Map([
        ['index.html', Buffer.from('<title>Manual</title>Hello worker manual')],
      ]),
      { title: 'Manual', defaultTopic: 'index.html' },
    ),
  );
}

async function bundle(entry: string, browserReader = false): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'es2020',
    ...(browserReader ? { inject: ['src/browser-buffer.ts'] } : {}),
  });
  return result.outputFiles[0].text;
}

async function main(): Promise<void> {
  const assets = new Map<string, { type: string; body: string }>();
  for (const [url, file, type] of [
    ['/examples/worker/', 'examples/worker/index.html', 'text/html'],
    ['/examples/worker/main.js', 'examples/worker/main.js', 'text/javascript'],
    [
      '/examples/worker/reader.worker.js',
      'examples/worker/reader.worker.js',
      'text/javascript',
    ],
  ])
    assets.set(url, { type, body: await readFile(file, 'utf8') });
  assets.set('/dist/browser/worker.mjs', {
    type: 'text/javascript',
    body: await bundle('src/worker/index.ts'),
  });
  assets.set('/dist/browser/index.mjs', {
    type: 'text/javascript',
    body: await bundle('src/browser.ts', true),
  });
  assets.set('/broken.worker.js', {
    type: 'text/javascript',
    body: 'throw new Error("Deliberately broken Worker");',
  });
  const server = createServer((request, response) => {
    const asset = assets.get(request.url ?? '');
    if (!asset) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': asset.type });
    response.end(asset.body);
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${base}/examples/worker/`);
    const input = page.locator('#archive');
    await input.setInputFiles({
      name: 'manual.chm',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(sampleBytes()),
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('#output')
          ?.textContent?.includes('firstFileBytes'),
      undefined,
      { timeout: 20000 },
    );
    const output = JSON.parse((await page.locator('#output').textContent())!);
    assert(output.files.includes('/index.html'));
    assert(output.toc.length > 0);
    assert(output.firstFileBytes > 0);
    await input.setInputFiles({
      name: 'broken.chm',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([1, 2, 3]),
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('#output')
          ?.textContent?.startsWith('ARCHIVE_ERROR:'),
      undefined,
      { timeout: 20000 },
    );
    await page.locator('#dispose').click();
    await page.waitForFunction(() =>
      document
        .querySelector('#output')
        ?.textContent?.includes('Worker terminated.'),
    );
    const failure = await page.evaluate(async () => {
      // The runtime URL intentionally targets the in-memory compiled asset.
      const moduleUrl = '/dist/browser/worker.mjs';
      const { WorkerArchiveClient } = await import(moduleUrl);
      const client = new WorkerArchiveClient(
        new Worker('/broken.worker.js', { type: 'module' }),
        { terminateOnDispose: true },
      );
      try {
        await client.open(new Uint8Array([1]));
        return 'unexpected success';
      } catch (error) {
        return (error as { code: string }).code;
      } finally {
        await client.dispose();
      }
    });
    assert.equal(failure, 'TRANSPORT_ERROR');
    process.stdout.write(
      'PASS: real Chromium module Worker example, CHM roundtrip, malformed archive, dispose, native Worker error.\n',
    );
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
}

void main().catch(error => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
