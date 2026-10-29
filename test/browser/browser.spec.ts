import type * as BrowserAPI from '../../src/browser';
import { browserModulePath, expect, packArchive, test } from './support';

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

test('native module Worker parses transferred CHM bytes', async ({
  page,
  expectedFiles,
}) => {
  const result = await page.evaluate(async () => {
    const worker = new Worker('/examples/browser/reader.worker.js', {
      type: 'module',
    });
    try {
      const response = await fetch('/test/fixtures/pychm-example/example.chm');
      if (!response.ok)
        throw new Error(`Fixture fetch failed: ${response.status}`);
      const source = await response.arrayBuffer();
      return await new Promise<{
        id: number;
        error?: string;
        files: string[];
        text: string;
      }>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Worker timed out')),
          10_000,
        );
        worker.onmessage = event => {
          clearTimeout(timeout);
          resolve(event.data);
        };
        worker.onerror = event => {
          clearTimeout(timeout);
          reject(new Error(event.message));
        };
        worker.postMessage({ id: 1, bytes: source, path: '/page 1.html' }, [
          source,
        ]);
      });
    } finally {
      worker.terminate();
    }
  });
  expect(result.error).toBeUndefined();
  expect(result.id).toBe(1);
  expect(result.files).toHaveLength(3);
  const expected = expectedFiles.find(([name]) => name === '/page 1.html');
  if (!expected) throw new Error('Oracle is missing /page 1.html');
  expect(result.text).toBe(
    new TextDecoder().decode(Uint8Array.from(expected[1])),
  );
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
