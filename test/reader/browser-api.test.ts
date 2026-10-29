import { test, describe } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import DefaultReader, {
  CHMReader,
  CHMKit,
  packFiles,
  CacheStrategy,
  type FileWithMetadata,
  type CHMSource,
} from '../../src/browser';
import { CHMArchive } from '../../src/reader/chm-archive';
import BrowserRoot, { CHMKit as BrowserRootKit } from '../../src/browser-root';
import { allBytes } from '../encoder/archive-fixtures';

describe('browser API facade (Node runtime)', () => {
  const root = 'test/fixtures/pychm-example';
  const fixture = Uint8Array.from(readFileSync(`${root}/example.chm`));
  const page = 'page 1.html';
  const expectedPage = Uint8Array.from(
    readFileSync(`${root}/expected/${page}`),
  );
  const visibleFiles = [
    '/Documents/Table of Contents.hhc',
    '/page 1.html',
    '/page 2.html',
  ];
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  function assertPlainBytes(data: Uint8Array, expected: Uint8Array): void {
    assert.equal(data.constructor, Uint8Array);
    assert.equal(Buffer.isBuffer(data), false);
    assert.deepEqual(data, Uint8Array.from(expected));
  }

  async function collect(
    stream: ReadableStream<Uint8Array>,
  ): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        assert.equal(next.value.constructor, Uint8Array);
        assert.equal(Buffer.isBuffer(next.value), false);
        const originalByte = next.value[0];
        const sliced = next.value.slice(0, 1);
        sliced[0] = originalByte ^ 0xff;
        assert.equal(
          next.value[0],
          originalByte,
          'slice must copy plain Uint8Array bytes',
        );
        assert.equal('type' in JSON.parse(JSON.stringify(next.value)), false);
        assert.ok(next.value.length <= 65536);
        chunks.push(next.value);
        length += next.value.length;
      }
    } finally {
      reader.releaseLock();
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  test('default export uses composition and opens byte, ArrayBuffer and Blob sources', async () => {
    assert.equal(DefaultReader, CHMReader);
    assert.equal(BrowserRoot, BrowserRootKit);
    assert.equal(BrowserRoot, CHMKit);
    const direct = new CHMReader(fixture);
    try {
      assert.equal(direct instanceof CHMArchive, false);
      assertPlainBytes(direct.readFile(page), expectedPage);
    } finally {
      direct.close();
    }
    const sources: CHMSource[] = [
      fixture,
      Uint8Array.from(fixture).buffer,
      new Blob([fixture]),
    ];
    for (const source of sources) {
      const opening = CHMReader.open(source, { maxCacheBytes: 1024 });
      assert.ok(opening instanceof Promise);
      const reader = await opening;
      try {
        assert.equal(reader.getCacheStats().maxBytes, 1024);
        assertPlainBytes(reader.readFile(page), expectedPage);
      } finally {
        reader.close();
      }
    }
    assert.throws(
      () => new CHMReader('archive.chm' as unknown as Uint8Array),
      /Uint8Array or ArrayBuffer/,
    );
    await assert.rejects(
      CHMReader.open('https://example.com/archive.chm' as unknown as CHMSource),
      /not a filesystem path or URL/,
    );
    await assert.rejects(CHMReader.open(new Blob(['invalid archive'])));
  });

  test('real aligned-LZX fixture: all binary outputs have browser-valued types', async () => {
    const reader = new CHMReader(fixture);
    try {
      assertPlainBytes(reader.readFile(page), expectedPage);
      assertPlainBytes(
        reader.readRange(page, 1, 21),
        expectedPage.subarray(1, 21),
      );
      assertPlainBytes(reader.readImage(page), expectedPage);
      const multiple: Map<string, Uint8Array> = reader.readMultiple([
        page,
        '/#SYSTEM',
      ]);
      assertPlainBytes(multiple.get(page)!, expectedPage);
      assert.equal(multiple.get('/#SYSTEM')!.constructor, Uint8Array);
      const withMetadata: FileWithMetadata = reader.readWithMetadata(page);
      assertPlainBytes(withMetadata.data, expectedPage);
      assert.equal(withMetadata.metadata.size, expectedPage.length);
      assert.equal(withMetadata.size, expectedPage.length);
      assertPlainBytes(
        await collect(reader.createReadStream(page)),
        expectedPage,
      );
      const changed = reader.readFile(page);
      changed.fill(0);
      assertPlainBytes(reader.readFile(page), expectedPage);
    } finally {
      reader.close();
    }
  });

  test('real fixture: visible navigation excludes all internal streams, explicit reads remain available', () => {
    const reader = new CHMReader(fixture);
    const archive = new CHMArchive(fixture);
    try {
      assert.deepEqual(reader.listFiles(), visibleFiles);
      assert.deepEqual(reader.listDirectories(), ['/Documents/']);
      assert.deepEqual(reader.glob('**/*.hhc'), [
        '/Documents/Table of Contents.hhc',
      ]);
      assert.deepEqual(reader.findFiles('page'), [
        '/page 1.html',
        '/page 2.html',
      ]);
      const tree = reader.getFileTree();
      assert.deepEqual(tree.children!.map(node => node.path).sort(), [
        '/Documents/',
        '/page 1.html',
        '/page 2.html',
      ]);
      assert.equal(reader.exists('/#SYSTEM'), true);
      assert.ok(reader.readFile('/#SYSTEM').length > 0);
      assert.equal(reader.exists('::DataSpace/Storage'), true);
      assert.ok(reader.readFile('::DataSpace/NameList').length > 0);
      assert.deepEqual(reader.getMetadata(), archive.getMetadata());
      assert.deepEqual(reader.getTOC(), archive.getTOC());
      assert.equal(reader.getTOC()[0].local, '/page 1.html');
      assert.deepEqual(reader.getIndex(), archive.getIndex());
      assert.equal(reader.getDefaultPage(), archive.getDefaultPage());
      assert.equal(reader.getHomePage(), reader.getDefaultPage());
      assert.deepEqual(
        reader.getNavigationLinks(page),
        archive.getNavigationLinks(page),
      );
      assert.deepEqual(reader.getFileInfo(page), archive.getFileInfo(page));
      assert.equal(reader.getFileSize(page), expectedPage.length);
      assert.equal(reader.getCompressedSize(page), null);
      assert.equal(reader.getCompressionRatio(page), null);
      assert.equal(reader.getMimeType(page), 'text/html');
      assert.equal(reader.readText(page), decoder.decode(expectedPage));
      assert.equal(reader.readHTML(page), archive.readHTML(page));
      assert.deepEqual(
        reader.search('page', { maxResults: 1 }),
        archive.search('page', { maxResults: 1 }),
      );
      assert.deepEqual(
        reader.searchInFile(page, 'page'),
        archive.searchInFile(page, 'page'),
      );
      assert.deepEqual(reader.fuzzySearch('pg1'), archive.fuzzySearch('pg1'));
    } finally {
      reader.close();
      archive.close();
    }
  });

  test('source-based CHMKit conveniences work on the independent fixture', async () => {
    const direct = CHMKit.from(fixture, { cacheStrategy: 'none' });
    try {
      assert.ok(direct instanceof CHMReader);
      assert.equal(direct.getCacheStats().strategy, 'none');
    } finally {
      direct.close();
    }
    const opened = await CHMKit.open(new Blob([fixture]));
    try {
      assertPlainBytes(opened.readFile(page), expectedPage);
    } finally {
      opened.close();
    }
    assertPlainBytes(await CHMKit.readFile(fixture, page), expectedPage);
    assert.equal(
      await CHMKit.readText(fixture, page),
      decoder.decode(expectedPage),
    );
    assert.equal(
      await CHMKit.readHTML(new Blob([fixture]), page),
      decoder.decode(expectedPage),
    );
    assert.deepEqual(await CHMKit.listFiles(fixture), visibleFiles);
    assert.deepEqual(await CHMKit.listFiles(fixture, '*.html'), [
      '/page 1.html',
      '/page 2.html',
    ]);
    assert.equal(await CHMKit.exists(fixture, page), true);
    assert.equal(await CHMKit.exists(fixture, 'missing'), false);
    assert.equal((await CHMKit.getTOC(fixture))[0].local, '/page 1.html');
    const search = await CHMKit.searchContent(fixture, 'page', {
      pattern: '*.html',
      maxResults: 1,
    });
    assert.equal(search.length, 1);
    assert.ok(search[0].matches.length > 0);
  });

  test('one-shot helpers close on success and failures, forwarding reader options', async () => {
    const close = CHMReader.prototype.close;
    let closed = 0;
    CHMReader.prototype.close = function () {
      close.call(this);
      assert.equal(this.isOpen(), false);
      assert.equal(this.getCacheStats().bytes, 0);
      closed++;
    };
    try {
      await CHMKit.listFiles(fixture);
      assert.equal(closed, 1);
      await assert.rejects(CHMKit.readFile(fixture, 'missing'), /not found/);
      await assert.rejects(
        CHMKit.readFile(fixture, page, { maxFileSize: 1 }),
        /maxFileSize/,
      );
      await assert.rejects(
        CHMKit.readText(fixture, page, 'not-an-encoding'),
        /Cannot decode/,
      );
      await assert.rejects(
        CHMKit.searchContent(fixture, 'page', { maxResults: -1 }),
        /maxResults/,
      );
      assert.equal(closed, 5);
      await assert.rejects(CHMKit.open(new Uint8Array([0, 1, 2])));
      assert.equal(
        closed,
        5,
        'failed construction did not leave an open reader',
      );
    } finally {
      CHMReader.prototype.close = close;
    }
  });

  for (const compression of [false, true]) {
    const binary = Uint8Array.from(allBytes(131075));
    const html =
      '<meta charset="utf-8"><title>中文首页</title><p>你好🌍 a+b</p><a href="nested/下一页.html">下页</a>';
    const files = new Map<string, Uint8Array>([
      ['index.html', encoder.encode(html)],
      ['nested/下一页.html', encoder.encode('下一页 中文 a+b')],
      ['binary.bin', binary],
      ['empty.bin', new Uint8Array()],
      ['空目录/更深/', new Uint8Array()],
      ['data.json', encoder.encode('{"中文":true}')],
      ['style.css', encoder.encode('body { color: red }')],
      ['app.js', encoder.encode('const 中文 = true;')],
      ['image.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47])],
      ['gbk.txt', Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4])],
    ]);
    const packed = packFiles(files, {
      compression,
      title: '浏览器中文📘',
      defaultTopic: 'index.html',
    });

    test(`in-memory packing, UTF-8 metadata and complete delegated reads (compression=${compression})`, () => {
      assert.equal(packed.constructor, Uint8Array);
      assert.equal(Buffer.isBuffer(packed), false);
      const reader = new CHMReader(packed);
      try {
        assert.equal(reader.readHTML('index.html'), html);
        assert.equal(
          reader.readJSON<{ 中文: boolean }>('data.json')['中文'],
          true,
        );
        assert.equal(reader.readCSS('style.css'), 'body { color: red }');
        assert.equal(reader.readJS('app.js'), 'const 中文 = true;');
        assert.equal(reader.readText('gbk.txt', 'gbk'), '中文');
        assertPlainBytes(
          reader.readImage('image.png'),
          files.get('image.png')!,
        );
        assertPlainBytes(reader.readFile('empty.bin'), new Uint8Array());
        assertPlainBytes(
          reader.readRange('binary.bin', 32760, 32780),
          binary.subarray(32760, 32780),
        );
        assert.equal(reader.getMetadata().title, '浏览器中文📘');
        assert.equal(reader.getDefaultPage(), '/index.html');
        assert.equal(reader.getTOC().length, 2);
        assert.ok(reader.listFiles().some(path => /\.hhc$/i.test(path)));
        assert.ok(reader.listFiles().some(path => /\.hhk$/i.test(path)));
        assert.ok(reader.listDirectories().includes('/空目录/更深/'));
        assert.equal(
          reader.listFiles().some(path => /^\/(?:#|\$)|^::/i.test(path)),
          false,
        );
        assert.equal(
          reader.getNavigationLinks('index.html')[0].local,
          '/nested/下一页.html',
        );
        assert.equal(reader.searchInFile('index.html', 'a+b').length, 1);
        assert.equal(reader.search('中文', { maxResults: 1 }).length, 1);
        assert.equal(
          reader.getCompressedSize('binary.bin'),
          compression ? null : binary.length,
        );
      } finally {
        reader.close();
      }
      const repacked = CHMKit.packFiles(files, { compression });
      assert.equal(repacked.constructor, Uint8Array);
      const reopened = CHMKit.from(repacked);
      try {
        assertPlainBytes(reopened.readFile('binary.bin'), binary);
      } finally {
        reopened.close();
      }
    });

    test(`range streams remain bounded for large files and respect closed state (compression=${compression})`, async () => {
      const reader = new CHMReader(packed, {
        maxFileSize: 65536,
        maxCacheBytes: 0,
      });
      assert.throws(() => reader.readFile('binary.bin'), /maxFileSize/);
      assertPlainBytes(
        await collect(reader.createReadStream('binary.bin')),
        binary,
      );
      assertPlainBytes(
        await collect(reader.createReadStream('empty.bin')),
        new Uint8Array(),
      );
      const stream = reader.createReadStream('binary.bin').getReader();
      await stream.read();
      reader.close();
      await assert.rejects(stream.read(), /closed/);
      assert.equal(reader.isOpen(), false);
      assert.throws(() => reader.listFiles(), /closed/);
      assert.throws(() => reader.readWithMetadata('image.png'), /closed/);
      assert.throws(() => reader.getMetadata(), /closed/);
      assert.equal(reader.getCacheStats().bytes, 0);
      reader.close();
    });

    test(`explicit preload and cache strategy delegation (compression=${compression})`, () => {
      const reader = new CHMReader(packed, {
        maxCacheBytes: 131072,
        cacheStrategy: CacheStrategy.None,
      });
      try {
        reader.readFile('image.png');
        assert.equal(reader.getCacheStats().entries, 0);
        reader.setCacheStrategy(CacheStrategy.LRU);
        reader.preload(['image.png']);
        assert.equal(reader.getCacheStats().files.entries, 1);
        reader.readImage('image.png');
        assert.equal(reader.getCacheStats().files.hits, 1);
        reader.clearCache();
        assert.equal(reader.getCacheStats().entries, 0);
      } finally {
        reader.close();
      }
    });
  }
});
