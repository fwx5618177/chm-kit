import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as BrowserAPI from '../../src/browser';
import type * as WorkerAPI from '../../src/worker';
import type * as ResourcesAPI from '../../src/browser-resources';
import {
  browserModulePath,
  workerModulePath,
  resourcesModulePath,
  expect,
  packArchive,
  test,
} from './support';

test('built browser, Worker and resources artifacts expose the required public entries', async ({
  page,
}) => {
  await page.evaluate(
    async entries => {
      for (const [modulePath, names] of entries) {
        const module = await import(modulePath);
        for (const name of names) {
          if (typeof module[name] !== 'function')
            throw new Error(
              `Built browser artifact ${modulePath} must export ${name}`,
            );
        }
      }
    },
    [
      [browserModulePath, ['CHMReader', 'packFiles', 'updateArchive']],
      [workerModulePath, ['createWorkerClient', 'serveWorker']],
      [resourcesModulePath, ['ArchivePathResolver', 'createArchivePreview']],
    ] as [string, string[]][],
  );
});

test('prebuilt standalone viewer opens directly from disk without npm, a build or HTTP hosting', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(pathToFileURL(resolve('dist/viewer/index.html')).href);
  await page.locator('#sample').click();
  await expect(page.locator('#files button').first()).toBeVisible();
  await expect(page.locator('#preview')).toBeVisible();
  await expect(page.frameLocator('#preview').locator('body')).toContainText(
    'CHMKit',
  );
  expect(requests.filter(url => /^https?:/.test(url))).toEqual([]);
  await testInfo.attach('standalone-local-file-viewer', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('native ESM without Node globals; byte/text/range/stream/cache/pack boundaries', async ({
  page,
}) => {
  const result = await page.evaluate(async modulePath => {
    const { CHMReader, packFiles } = (await import(
      modulePath
    )) as typeof BrowserAPI;
    const assert = (condition: boolean, message: string): void => {
      if (!condition) throw new Error(message);
    };
    assert(
      typeof globalThis.Buffer === 'undefined' &&
        typeof globalThis.process === 'undefined' &&
        typeof globalThis.require === 'undefined',
      'Node globals leaked',
    );
    const text = '<title>中文测试</title>边界条件：你好🌍。'.repeat(8000);
    const bytes = Uint8Array.from(
      { length: 131075 },
      (_, index) => index % 256,
    );
    let tested = 0;
    for (const compression of [false, true]) {
      const archive = packFiles(
        new Map([
          ['index.html', new TextEncoder().encode(text)],
          ['data/bytes.bin', bytes],
          ['empty.txt', new Uint8Array()],
          ['gbk.txt', new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])],
        ]),
        { compression, title: '浏览器测试' },
      );
      const reader = await CHMReader.open(
        new Blob([Uint8Array.from(archive).buffer]),
      );
      try {
        assert(reader.readText('/index.html') === text, 'UTF8 roundtrip');
        assert(reader.readText('/gbk.txt', 'gbk') === '中文', 'GBK decoder');
        assert(reader.readFile('/empty.txt').length === 0, 'empty file');
        assert(reader.getMetadata().title === '浏览器测试', 'metadata');
        const actual = reader.readFile('/data/bytes.bin');
        assert(
          actual.constructor === Uint8Array &&
            actual.every((value, index) => value === bytes[index]),
          'all byte values and cross-reset reconstruction',
        );
        const range = reader.readRange('/data/bytes.bin', 32767, 65537);
        assert(
          range.every((value, index) => value === bytes[index + 32767]),
          'cross-frame range',
        );
        assert(
          reader.readRange('/data/bytes.bin', bytes.length, bytes.length)
            .length === 0,
          'EOF empty range',
        );
        for (const [start, end] of [
          [-1, 0],
          [1, 0],
          [0, bytes.length + 1],
          [NaN, 1],
          [0.5, 1],
        ]) {
          let rejected = false;
          try {
            reader.readRange('/data/bytes.bin', start, end);
          } catch {
            rejected = true;
          }
          assert(rejected, 'invalid range accepted');
        }
        const stream = reader.createReadStream('/data/bytes.bin').getReader();
        let offset = 0;
        for (;;) {
          const { done, value } = await stream.read();
          if (done) break;
          assert(
            value.constructor === Uint8Array &&
              value.length <= 65536 &&
              value.every((byte, index) => byte === bytes[offset + index]),
            'stream content/backpressure',
          );
          offset += value.length;
        }
        assert(offset === bytes.length, 'stream length');
        const ranged = reader.createReadStream('/data/bytes.bin', 32767, 65537);
        const rangedBytes = new Uint8Array(
          await new Response(ranged).arrayBuffer(),
        );
        assert(
          rangedBytes.length === 32770 &&
            rangedBytes.every((value, index) => value === bytes[index + 32767]),
          'range stream boundaries',
        );
        const eof = reader
          .createReadStream('/data/bytes.bin', bytes.length, bytes.length)
          .getReader();
        assert((await eof.read()).done === true, 'empty EOF stream');
        reader.readFile('/index.html');
        assert(reader.getCacheStats().hits > 0, 'cache hit');
        reader.setCacheStrategy('none');
        assert(reader.getCacheStats().bytes === 0, 'cache disable');
        assert(
          reader.search('边界条件', { maxResults: 1 }).length === 1,
          'full text search',
        );
      } finally {
        reader.close();
      }
      let closed = false;
      try {
        reader.listFiles();
      } catch {
        closed = true;
      }
      assert(closed, 'closed reader');
      tested++;
    }
    let rejected = false;
    try {
      new CHMReader(new Uint8Array(96));
    } catch {
      rejected = true;
    }
    assert(rejected, 'corrupt header');
    return { tested };
  }, browserModulePath);
  expect(result.tested).toBe(2);
});

test('unmodified real aligned-Huffman CHM matches independent oracle', async ({
  page,
  expectedFiles,
}) => {
  const result = await page.evaluate(
    async ({ modulePath, expected }) => {
      const { CHMReader } = (await import(modulePath)) as typeof BrowserAPI;
      const response = await fetch('/test/fixtures/pychm-example/example.chm');
      if (!response.ok)
        throw new Error(`Fixture fetch failed: ${response.status}`);
      const reader = new CHMReader(await response.arrayBuffer());
      try {
        for (const [name, bytes] of expected) {
          const actual = reader.readFile(name);
          if (
            actual.length !== bytes.length ||
            !actual.every((value, index) => value === bytes[index])
          )
            throw new Error(`Oracle mismatch: ${name}`);
        }
        return {
          files: reader.listFiles().length,
          toc: reader.getTOC().length,
        };
      } finally {
        reader.close();
      }
    },
    { modulePath: browserModulePath, expected: expectedFiles },
  );
  expect(result.files).toBe(3);
  expect(result.toc).toBeGreaterThan(0);
});

test('native module Worker library client/host correlates concurrent calls and preserves oracle bytes', async ({
  page,
  expectedFiles,
}) => {
  const result = await page.evaluate(async modulePath => {
    const { createWorkerClient } = (await import(
      modulePath
    )) as typeof WorkerAPI;
    const worker = new Worker('/dist/viewer/reader.worker.js', {
      type: 'module',
    });
    const client = createWorkerClient(worker, { terminateOnDispose: true });
    const response = await fetch('/test/fixtures/pychm-example/example.chm');
    if (!response.ok)
      throw new Error(`Fixture fetch failed: ${response.status}`);
    const source = await response.arrayBuffer();
    try {
      const archive = await client.open(source, { transferInput: true });
      const [bytes, files, toc, results, range] = await Promise.all([
        archive.read('/page 1.html', { transferResult: true }),
        archive.list(),
        archive.toc(),
        archive.search('page', { maxResults: 2 }),
        archive.readRange('/page 1.html', 0, 8),
      ]);
      let code = '';
      try {
        await archive.read('/missing');
      } catch (error) {
        code = (error as { code: string }).code;
      }
      await archive.close();
      let closed = '';
      try {
        await archive.list();
      } catch (error) {
        closed = (error as { code: string }).code;
      }
      return {
        detached: source.byteLength === 0,
        plain: bytes.constructor === Uint8Array,
        text: new TextDecoder().decode(bytes),
        files,
        toc: toc.length,
        results: results.length,
        range: [...range],
        code,
        closed,
      };
    } finally {
      await client.dispose();
    }
  }, workerModulePath);
  expect(result.detached).toBe(true);
  expect(result.plain).toBe(true);
  expect(result.files).toHaveLength(3);
  expect(result.toc).toBeGreaterThan(0);
  expect(result.code).toBe('ARCHIVE_ERROR');
  expect(result.closed).toBe('CLOSED');
  const expected = expectedFiles.find(([name]) => name === '/page 1.html');
  if (!expected) throw new Error('Oracle is missing /page 1.html');
  expect(result.text).toBe(
    new TextDecoder().decode(Uint8Array.from(expected[1])),
  );
  expect(result.range).toEqual(expected[1].slice(0, 8));
});

test('live UI previews archive HTML, CSS and embedded SVG', async ({
  page,
}, testInfo) => {
  await page.locator('#sample').click();
  const preview = page.frameLocator('#preview');
  await expect(
    preview.getByRole('heading', { name: '你好，CHMKit。' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      preview
        .locator('img')
        .evaluate(image => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      preview
        .locator('body')
        .evaluate(body => getComputedStyle(body).backgroundColor),
    )
    .toBe('rgb(245, 249, 248)');
  await expect(page.locator('#preview')).toHaveAttribute('sandbox', '');
  const screenshot = testInfo.outputPath('browser-demo.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('browser-demo', {
    path: screenshot,
    contentType: 'image/png',
  });
});

test('UI search, navigation, empty file, cache and CHM download', async ({
  page,
}) => {
  // Each test owns a fresh page; explicitly load the sample rather than relying
  // on the preview test having run first.
  await page.locator('#sample').click();
  await expect(
    page
      .frameLocator('#preview')
      .getByRole('heading', { name: '你好，CHMKit。' }),
  ).toBeVisible();
  await page.locator('#search').fill('边界条件');
  await page.locator('#search-button').click();
  await expect(page.locator('#results button')).toHaveCount(2);
  await page
    .locator('#results button')
    .filter({ hasText: '/docs/boundaries.html' })
    .click();
  await expect(
    page
      .frameLocator('#preview')
      .getByRole('heading', { name: '边界条件检查' }),
  ).toBeVisible();
  await page
    .locator('#files button')
    .filter({ hasText: 'data/empty.txt' })
    .click();
  await expect(page.locator('#binary')).toBeVisible();
  await expect(page.locator('#binary')).toHaveText('');
  await page.locator('#toc-button').click();
  await expect
    .poll(() => page.locator('#results button').count())
    .toBeGreaterThanOrEqual(2);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  expect((await downloadPromise).suggestedFilename()).toBe('chmkit-demo.chm');
  await page.locator('#clear-cache').click();
  await expect(page.locator('#cache-size')).toHaveText('0 B');
});

test('default page and TOC resolve query/fragment URLs and literal #/% filenames', async ({
  page,
}) => {
  const archive = await packArchive(
    new Map([
      [
        'index.html',
        Buffer.from('<h1 id="section">Anchored default topic</h1>'),
      ],
      [
        'hash#name%.html',
        Buffer.from('<h1 id="section">Literal filename topic</h1>'),
      ],
      [
        'space here.html',
        Buffer.from('<h1 id="section">Encoded space topic</h1>'),
      ],
      [
        'toc/contents.hhc',
        Buffer.from(
          '<ul><li><object type="text/sitemap"><param name="Name" value="Default query anchor"><param name="Local" value="../index.html?topic=1#section"></object><li><object type="text/sitemap"><param name="Name" value="Literal filename anchor"><param name="Local" value="../hash%23name%25.html?topic=2#section"></object><li><object type="text/sitemap"><param name="Name" value="Encoded space anchor"><param name="Local" value="../space%20here.html#section"></object></ul>',
        ),
      ],
    ]),
    { defaultTopic: 'index.html?lang=zh#section' },
  );
  await page.locator('#file-input').setInputFiles({
    name: 'anchors.chm',
    mimeType: 'application/octet-stream',
    buffer: archive,
  });
  await expect(
    page
      .frameLocator('#preview')
      .getByRole('heading', { name: 'Anchored default topic' }),
  ).toBeVisible();
  await expect(page.locator('#preview')).toHaveAttribute('src', /#section$/);
  await page.locator('#toc-button').click();
  await expect(page.locator('#results button')).toHaveCount(3);
  for (const [label, heading] of [
    ['Literal filename anchor', 'Literal filename topic'],
    ['Encoded space anchor', 'Encoded space topic'],
    ['Default query anchor', 'Anchored default topic'],
  ]) {
    await page
      .locator('#results')
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(
      page.frameLocator('#preview').getByRole('heading', { name: heading }),
    ).toBeVisible();
    await expect(page.locator('#preview')).toHaveAttribute('src', /#section$/);
  }
  await page
    .locator('#files button')
    .filter({ hasText: 'hash#name%.html' })
    .click();
  await expect(
    page
      .frameLocator('#preview')
      .getByRole('heading', { name: 'Literal filename topic' }),
  ).toBeVisible();
});

test('untrusted CHM preview cannot execute scripts or request remote resources', async ({
  page,
  browserActivity,
}) => {
  const malicious = await packArchive(
    new Map([
      [
        'index.html',
        Buffer.from(
          '<title>Unsafe</title><script>parent.__chmInjected=true</script><img src="https://attacker.invalid/leak" onerror="parent.__chmInjected=true"><img src="/preview-probe?secret=chm-content" onerror="parent.__chmInjected=true"><meta http-equiv="refresh" content="0;url=/preview-probe?refresh"><iframe srcdoc="<script>parent.__chmInjected=true</script>"></iframe><h1>Sandbox checked</h1>',
        ),
      ],
    ]),
  );
  await page.locator('#file-input').setInputFiles({
    name: 'unsafe.chm',
    mimeType: 'application/octet-stream',
    buffer: malicious,
  });
  const preview = page.frameLocator('#preview');
  await expect(
    preview.getByRole('heading', { name: 'Sandbox checked' }),
  ).toBeVisible();
  await expect(preview.locator('script,iframe,[onerror]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { __chmInjected?: boolean })
          .__chmInjected,
    ),
  ).toBeUndefined();
  expect(browserActivity.external, 'no remote resource requests').toEqual([]);
  expect(
    browserActivity.probes,
    'inert parsing must not even request same-origin untrusted resources',
  ).toEqual([]);
});

test('native Worker client cancellation, timeout, malformed archive, pending dispose and native error', async ({
  page,
}) => {
  const context = page.context();
  await context.route('**/examples/browser/failing.worker.js', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'throw new Error("Deliberately broken Worker");',
    }),
  );
  const result = await page.evaluate(
    async ({ browserPath, workerPath }) => {
      const { packFiles } = (await import(browserPath)) as typeof BrowserAPI;
      const { createWorkerClient } = (await import(
        workerPath
      )) as typeof WorkerAPI;
      const input = packFiles(
        new Map([
          ['index.html', new TextEncoder().encode('<h1>Worker lifecycle</h1>')],
        ]),
      );
      const worker = new Worker('/examples/browser/delayed.worker.js', {
        type: 'module',
      });
      const client = createWorkerClient(worker, {
        terminateOnDispose: true,
        timeoutMs: 10000,
      });
      const codes: string[] = [];
      const rejects = async (promise: Promise<unknown>): Promise<void> => {
        try {
          await promise;
          codes.push('unexpected-success');
        } catch (error) {
          codes.push((error as { code: string }).code);
        }
      };
      const available = async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            return await client.open(input);
          } catch (error) {
            if ((error as { code: string }).code !== 'LIMIT_EXCEEDED')
              throw error;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        throw new Error('Cancelled Worker archive was not released');
      };
      try {
        // Establish that the real Worker has finished startup before using short timeouts.
        await (await client.open(input)).close();
        const pre = new AbortController();
        pre.abort();
        await rejects(client.open(input, { signal: pre.signal }));
        const controller = new AbortController();
        const cancelled = rejects(
          client.open(input, { signal: controller.signal }),
        );
        controller.abort();
        await cancelled;
        await (await available()).close();
        await rejects(client.open(input, { timeoutMs: 5 }));
        await (await available()).close();
        await rejects(client.open(new Uint8Array([1, 2, 3])));
        // The one-archive host budget proves cancelled/timed-out opens were released.
        const archive = await client.open(input);
        const pending = rejects(archive.read('/index.html'));
        await client.dispose();
        await pending;
        await rejects(archive.list());
        await client.dispose();
      } finally {
        await client.dispose();
      }
      const failedWorker = new Worker('/examples/browser/failing.worker.js', {
        type: 'module',
      });
      failedWorker.addEventListener('error', event => event.preventDefault());
      const failed = createWorkerClient(failedWorker, {
        terminateOnDispose: true,
      });
      await rejects(failed.open(input));
      await failed.dispose();
      return codes;
    },
    { browserPath: browserModulePath, workerPath: workerModulePath },
  );
  expect(result).toEqual([
    'ABORTED',
    'ABORTED',
    'TIMEOUT',
    'ARCHIVE_ERROR',
    'DISPOSED',
    'DISPOSED',
    'TRANSPORT_ERROR',
  ]);
});

test('incremental updateArchive returns plain Uint8Array and preserves original archive/metadata', async ({
  page,
}) => {
  const result = await page.evaluate(async modulePath => {
    const api = (await import(modulePath)) as typeof BrowserAPI & {
      updateArchive(
        source: Uint8Array,
        changes: ReadonlyMap<string, Uint8Array | null>,
        options?: { compression?: boolean },
      ): Uint8Array;
    };
    if (typeof api.updateArchive !== 'function')
      throw new Error(
        `Built browser artifact ${modulePath} must export updateArchive`,
      );
    const encode = (value: string): Uint8Array =>
      new TextEncoder().encode(value);
    const input = api.packFiles(
      new Map([
        ['index.html', encode('<title>Original</title>old')],
        ['old.txt', encode('remove me')],
      ]),
      { title: 'Update metadata', defaultTopic: 'index.html' },
    );
    const before = input.slice();
    const unchanged = api.updateArchive(input, new Map());
    const checks: boolean[] = [unchanged.constructor === Uint8Array];
    for (const compression of [false, true]) {
      const updated = api.updateArchive(
        input,
        new Map([
          ['index.html', encode('<title>Updated</title>new')],
          ['old.txt', null],
          ['new.txt', encode('added')],
        ]),
        { compression },
      );
      const archive = new api.CHMReader(updated);
      try {
        checks.push(
          updated.constructor === Uint8Array,
          archive.readText('/index.html').includes('Updated'),
          !archive.exists('/old.txt'),
          archive.readText('/new.txt') === 'added',
          archive.getMetadata().title === 'Update metadata',
        );
      } finally {
        archive.close();
      }
    }
    const original = new api.CHMReader(input);
    try {
      checks.push(
        original.readText('/index.html').includes('Original'),
        input.every((value, i) => value === before[i]),
        typeof globalThis.Buffer === 'undefined',
      );
    } finally {
      original.close();
    }
    return checks;
  }, browserModulePath);
  expect(result.every(Boolean)).toBe(true);
});

test('recursive CSS imports, srcset, escaped paths, sanitized SVG and safe host navigation stay offline', async ({
  page,
  browserActivity,
}) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const archive = await packArchive(
    new Map([
      [
        'docs/start.html',
        Buffer.from(
          '<link rel="stylesheet" href="../assets/main.css?version=1"><style>@import "https://attacker.invalid/remote.css"; .trap{background-image:image-set("/preview-probe?css-string" 1x)}</style><h1 id="section">Offline resources</h1><p class="nested">Nested stylesheet</p><p class="trap">Blocked CSS string URL</p><div class="background">Background</div><picture><source srcset="../assets/image%23%25.png?cache=1 1x, https://attacker.invalid/picture.png 2x"><img id="responsive" srcset="../assets/image%23%25.png 1x, /preview-probe?srcset 2x" alt="responsive"></picture><img id="safe-svg" src="../assets/unsafe.svg"><a href="../hash%23name%25.html?topic=2#section" ping="/preview-probe?ping" target="_top">Safe chapter</a><a href="#section">Same page</a><a href="https://attacker.invalid/navigation">External blocked</a><svg><image href="/preview-probe?inline-svg"></image></svg><form><img src="/preview-probe?form"></form>',
        ),
      ],
      [
        'assets/main.css',
        Buffer.from(
          '@import "nested/second.css" screen; body{background:rgb(231, 242, 253)} .background{background-image:url("image%23%25.png?cache=2#icon");width:20px;height:20px}',
        ),
      ],
      [
        'assets/nested/second.css',
        Buffer.from(
          '@import "../main.css"; .nested{color:rgb(17, 34, 51);border-top:7px solid rgb(1, 2, 3)}',
        ),
      ],
      ['assets/image#%.png', png],
      [
        'assets/unsafe.svg',
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" onload="parent.__chmInjected=true"><script>parent.__chmInjected=true</script><foreignObject><iframe src="/preview-probe?foreign"/></foreignObject><image href="https://attacker.invalid/svg"/><use href="/preview-probe?use"/><rect width="8" height="8" fill="red"/></svg>',
        ),
      ],
      [
        'hash#name%.html',
        Buffer.from('<h1 id="section">Safe linked chapter</h1>'),
      ],
    ]),
    { defaultTopic: 'docs/start.html' },
  );
  const input = page.locator('#file-input');
  await input.setInputFiles({
    name: 'resources.chm',
    mimeType: 'application/octet-stream',
    buffer: archive,
  });
  const frame = page.frameLocator('#preview');
  await expect(
    frame.getByRole('heading', { name: 'Offline resources' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      frame
        .locator('.nested')
        .evaluate(node => getComputedStyle(node).borderTopWidth),
    )
    .toBe('7px');
  await expect
    .poll(() =>
      frame
        .locator('body')
        .evaluate(node => getComputedStyle(node).backgroundColor),
    )
    .toBe('rgb(231, 242, 253)');
  await expect
    .poll(() =>
      frame
        .locator('#responsive')
        .evaluate(node => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await expect
    .poll(() =>
      frame
        .locator('#safe-svg')
        .evaluate(node => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(8);
  expect(
    await frame
      .locator('#responsive')
      .evaluate(node => (node as HTMLImageElement).currentSrc),
  ).toMatch(/^data:image\/png/);
  const svg = await frame
    .locator('#safe-svg')
    .evaluate(node => atob((node as HTMLImageElement).src.split(',')[1]));
  expect(svg).toContain('<rect');
  expect(svg).not.toMatch(/script|foreignObject|https:|onload|preview-probe/);
  expect(
    await frame
      .locator('.background')
      .evaluate(node => getComputedStyle(node).backgroundImage),
  ).toContain('data:image/png');
  await expect(
    frame.locator('script,iframe,form,svg,[onload],[ping],[target]'),
  ).toHaveCount(0);
  await expect(
    frame.locator('a').filter({ hasText: 'Safe chapter' }),
  ).not.toHaveAttribute('href');
  await expect(
    frame.locator('a').filter({ hasText: 'Same page' }),
  ).toHaveAttribute('href', '#section');
  await expect(page.locator('#document-links button')).toHaveCount(2);
  await page
    .locator('#document-links')
    .getByRole('button', { name: 'Safe chapter', exact: true })
    .click();
  await expect(
    frame.getByRole('heading', { name: 'Safe linked chapter' }),
  ).toBeVisible();
  await expect(page.locator('#selected')).toHaveText(
    '/hash#name%.html?topic=2#section',
  );
  await expect(page.locator('#preview')).toHaveAttribute('sandbox', '');
  await expect(page.locator('#preview')).toHaveAttribute('src', /#section$/);
  expect(browserActivity.external).toEqual([]);
  expect(browserActivity.probes).toEqual([]);
});

test('preview helper budgets and owned object URLs cleanly fail closed without host DOM insertion', async ({
  page,
  browserActivity,
}) => {
  const result = await page.evaluate(
    async ({ browserPath, resourcesPath }) => {
      const { CHMReader, packFiles } = (await import(
        browserPath
      )) as typeof BrowserAPI;
      const { createArchivePreview, ARCHIVE_PREVIEW_CSP } = (await import(
        resourcesPath
      )) as typeof ResourcesAPI;
      const source = packFiles(
        new Map([
          [
            'index.html',
            new TextEncoder().encode(
              '<base href="https://attacker.invalid/"><h1>Lifecycle</h1><img src="/preview-probe?inert"><style>body{background:url(https://attacker.invalid/css)}</style><script>parent.__chmInjected=true</script>',
            ),
          ],
        ]),
      );
      const archive = new CHMReader(source);
      const created: string[] = [],
        revoked: string[] = [];
      const objectURLs = {
        createObjectURL(blob: Blob) {
          const url = URL.createObjectURL(blob);
          created.push(url);
          return url;
        },
        revokeObjectURL(url: string) {
          revoked.push(url);
          URL.revokeObjectURL(url);
        },
      };
      try {
        const preview = createArchivePreview(archive, '/index.html', {
          objectURLs,
        });
        const first = preview.createObjectURL();
        const same = preview.createObjectURL() === first;
        preview.dispose();
        preview.dispose();
        let disposed = false;
        try {
          preview.createObjectURL();
        } catch {
          disposed = true;
        }
        const failures: string[] = [];
        for (const limits of [
          { maxBytes: 1 },
          { maxNodes: 1 },
          { maxOutputBytes: 1 },
        ]) {
          try {
            createArchivePreview(archive, '/index.html', {
              limits,
              objectURLs,
            });
            failures.push('unexpected-success');
          } catch (error) {
            failures.push((error as Error).name);
          }
        }
        return {
          same,
          disposed,
          created: created.length,
          revoked,
          first,
          failures,
          blocked: preview.stats.blocked,
          csp: ARCHIVE_PREVIEW_CSP,
          html: preview.html,
          inserted: document.body.textContent?.includes('Lifecycle'),
        };
      } finally {
        archive.close();
      }
    },
    { browserPath: browserModulePath, resourcesPath: resourcesModulePath },
  );
  expect(result.same).toBe(true);
  expect(result.disposed).toBe(true);
  expect(result.created).toBe(1);
  expect(result.revoked).toEqual([result.first]);
  expect(result.failures).toEqual([
    'PreviewLimitError',
    'PreviewLimitError',
    'PreviewLimitError',
  ]);
  expect(result.blocked).toBeGreaterThan(0);
  expect(result.inserted).toBe(false);
  expect(result.html).not.toContain('<script');
  expect(result.html).not.toContain('<base');
  expect(result.csp).toContain("script-src 'none'");
  expect(result.csp).toContain("connect-src 'none'");
  expect(browserActivity.external).toEqual([]);
  expect(browserActivity.probes).toEqual([]);
});
