import { test, describe } from 'vitest';
import { strict as assert } from 'node:assert';
import { CHMArchive, CacheStrategy } from '../../src/reader/chm-archive';
import { FileReconstructor } from '../../src/core/files/file-reconstructor';
import { CHMHeaderBuilder } from '../../src/encoder/builders/header-builder';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { packFiles } from '../../src/encoder/archive-builder';
import {
  allBytes,
  inspectDirectory,
  storedEntry,
  reencodeArchive,
} from '../encoder/archive-fixtures';

const binary = allBytes(131075);
const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
const html =
  '<title>中文档案</title>\nHello 中文 a+b .* [x]\n<a href="nested/topic.htm?x=1&amp;y=2#部分"><b>下页</b> &amp; more</a><a href="javascript:alert(1)">unsafe</a><link rel="next" href="nested/topic.htm">';
const contents = `<!doctype html><meta charset="utf-8"><UL>
<LI><OBJECT type="text/sitemap"><PARAM NAME="Name" VALUE="Chapter &amp; 中文"><PARAM NAME="Local" VALUE="../index.html"></OBJECT>
<UL><LI><OBJECT type='text/sitemap'><param name='Name' value='Child &#x4E2D;&#25991; &quot;quoted&quot; &copy;'><param name='Local' value='../NESTED/topic.htm?x=1&amp;y=&#50;#部分'></OBJECT>
<UL><LI><OBJECT type="text/sitemap"><param name="Name" value="Grandchild"><param name="Local" value="../nested/deeper/other.txt"></OBJECT></UL>
<LI><OBJECT type="text/sitemap"><param name="Name" value="Sibling"><param name="Local" value="../Index.HTML"></OBJECT></UL>
<LI><OBJECT type="text/sitemap"><param name="Name" value="Second root"></OBJECT></UL>`;
const index =
  '<ul><li><object type="text/sitemap"><param name="Name" value="关键词 &amp; index"><param name="Local" value="../Index.HTML"></object><ul><li><object type="text/sitemap"><param name="Name" value="Nested keyword"><param name="Local" value="../nested/topic.htm"></object></ul></ul>';
const utf16be = Buffer.from('大端中文', 'utf16le').swap16();
const files = new Map<string, Buffer>([
  [
    'Index.HTML',
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(html)]),
  ],
  [
    'nested/topic.htm',
    Buffer.from(
      '<meta charset="utf-8"><title>下一页</title>中文 hello\na+b a+b',
    ),
  ],
  ['nested/deeper/other.txt', Buffer.from('中文 HELLO\nline two a+b')],
  ['toc/Contents.HHC', Buffer.from(contents)],
  ['toc/Keywords.HHK', Buffer.from(index)],
  ['binary.bin', binary],
  ['empty.bin', Buffer.alloc(0)],
  ['空目录/更深/', Buffer.alloc(0)],
  ['gbk.txt', gbk],
  [
    'gbk.html',
    Buffer.concat([
      Buffer.from(
        '<meta http-equiv="Content-Type" content="text/html; charset=gbk"><p>',
      ),
      gbk,
      Buffer.from('</p>'),
    ]),
  ],
  [
    'utf16.txt',
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('中文🌍', 'utf16le'),
    ]),
  ],
  ['utf16be.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be])],
  ['data.json', Buffer.from('{"中文":true,"__proto__":{"polluted":true}}')],
  ['broken.json', Buffer.from('{ not JSON')],
  ['style.css', Buffer.from('body { color: red; }')],
  ['app.js', Buffer.from('const 中文 = "hello";')],
  ['pixel.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255])],
]);

for (const compression of [false, true]) {
  describe(`CHMArchive (compression=${compression})`, () => {
    const packed = packFiles(files, {
      compression,
      title: '中文 & title',
      defaultTopic: 'index.html',
    });
    // #SYSTEM intentionally spells the HHC path differently from the directory.
    const systemEntry = inspectDirectory(packed).entries.get('/#SYSTEM')!;
    const system = storedEntry(packed, systemEntry);
    const tocPosition = system.indexOf(Buffer.from('toc/Contents.HHC'));
    assert.ok(tocPosition > 0);
    system.write('TOC/CONTENTS.hhc', tocPosition, 'ascii');

    test('owns Uint8Array/ArrayBuffer input; reads Chinese, binary and empty files byte-for-byte', async () => {
      const source = new Uint8Array(packed);
      const archive = new CHMArchive(source);
      source.fill(0);
      assert.equal(archive.isOpen(), true);
      for (const [path, expected] of files) {
        if (!path.endsWith('/'))
          assert.deepEqual(await archive.readFile(path), expected, path);
      }
      assert.deepEqual(archive.readFile('BINARY.BIN'), binary);
      const changed = archive.readFile('binary.bin');
      changed.fill(0);
      assert.deepEqual(
        archive.readFile('binary.bin'),
        binary,
        'caller cannot mutate cached data',
      );
      const arrayBuffer = Uint8Array.from(packed).buffer;
      const fromArrayBuffer = new CHMArchive(arrayBuffer);
      assert.equal(
        fromArrayBuffer.readText('nested/deeper/other.txt'),
        files.get('nested/deeper/other.txt')!.toString(),
      );
      archive.close();
      fromArrayBuffer.close();
    });

    test('strict half-open ranges, including empty/end boundaries and reset-frame crossings', () => {
      const archive = new CHMArchive(packed);
      for (const [start, end] of [
        [0, 0],
        [0, 1],
        [32760, 32780],
        [65530, 65550],
        [binary.length, binary.length],
        [0, binary.length],
      ]) {
        assert.deepEqual(
          archive.readRange('binary.bin', start, end),
          binary.subarray(start, end),
        );
      }
      assert.deepEqual(
        archive.readRange('binary.bin', 131070),
        binary.subarray(131070),
      );
      assert.deepEqual(archive.readRange('empty.bin', 0, 0), Buffer.alloc(0));
      for (const [start, end] of [
        [-1, 0],
        [1, 0],
        [0, binary.length + 1],
        [0.5, 1],
        [0, NaN],
        [Infinity, Infinity],
      ]) {
        assert.throws(
          () => archive.readRange('binary.bin', start, end),
          RangeError,
        );
      }
      archive.close();
    });

    test('WHATWG streams pull <=64KiB chunks lazily, never eager files or repeated ranges', async () => {
      const archive = new CHMArchive(packed);
      const calls: number[] = [];
      const originalChunks = FileReconstructor.prototype.iterateFileChunks;
      const originalRange = FileReconstructor.prototype.reconstructRange;
      const originalFile = FileReconstructor.prototype.reconstructFile;
      let released = 0;
      FileReconstructor.prototype.iterateFileChunks = function* (...args) {
        try {
          for (const chunk of originalChunks.apply(this, args)) {
            calls.push(chunk.length);
            yield chunk;
          }
        } finally {
          released++;
        }
      };
      FileReconstructor.prototype.reconstructRange = function () {
        throw new Error('Unexpected repeated range decoding');
      };
      FileReconstructor.prototype.reconstructFile = function () {
        throw new Error('Unexpected full-file decoding');
      };
      try {
        const stream = archive.createReadStream('binary.bin');
        assert.equal(calls.length, 0, 'stream must remain lazy until demand');
        const reader = stream.getReader();
        const chunks: Buffer[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          assert.ok(value.length <= 65536);
          chunks.push(Buffer.from(value));
        }
        assert.deepEqual(Buffer.concat(chunks), binary);
        assert.deepEqual(calls, [65536, 65536, 3]);
        assert.equal(
          released,
          1,
          'completion closes the generator immediately',
        );
        const empty = archive.createReadStream('empty.bin').getReader();
        assert.equal((await empty.read()).done, true);
        const cancel = archive.createReadStream('binary.bin').getReader();
        await cancel.cancel();
        assert.equal(
          calls.length,
          3,
          'cancellation before pull must not decode',
        );
        const active = archive.createReadStream('binary.bin').getReader();
        await active.read();
        await active.cancel();
        assert.equal(released, 2, 'active cancellation closes the generator');
        assert.equal(calls.length, 4);
      } finally {
        FileReconstructor.prototype.iterateFileChunks = originalChunks;
        FileReconstructor.prototype.reconstructRange = originalRange;
        FileReconstructor.prototype.reconstructFile = originalFile;
        archive.close();
      }
    });

    test('range streams use strict half-open bounds and preserve empty/EOF/reset boundaries', async () => {
      const archive = new CHMArchive(packed, {
        maxCacheBytes: 0,
        maxFileSize: 1024,
      });
      try {
        for (const [start, end] of [
          [0, 0],
          [0, 1],
          [32767, 65537],
          [65536, 65536],
          [binary.length, binary.length],
          [binary.length - 1, binary.length],
        ]) {
          const stream = archive
            .createReadStream('binary.bin', start, end)
            .getReader();
          const chunks: Buffer[] = [];
          for (;;) {
            const { done, value } = await stream.read();
            if (done) break;
            assert.ok(value.length > 0 && value.length <= 1024);
            chunks.push(Buffer.from(value));
          }
          assert.deepEqual(Buffer.concat(chunks), binary.subarray(start, end));
        }
        for (const [start, end] of [
          [-1, 0],
          [1, 0],
          [0, binary.length + 1],
          [0.5, 1],
          [NaN, 1],
          [0, Infinity],
        ])
          assert.throws(
            () => archive.createReadStream('binary.bin', start, end),
            RangeError,
          );
      } finally {
        archive.close();
      }
      const zero = new CHMArchive(packed, { maxFileSize: 0 });
      assert.equal(
        (
          await zero
            .createReadStream('binary.bin', binary.length)
            .getReader()
            .read()
        ).done,
        true,
      );
      assert.throws(() => zero.createReadStream('binary.bin'), /maxFileSize/);
      zero.close();
    });

    test('maxFileSize limits materialization, not addressable file/range/stream length', async () => {
      const archive = new CHMArchive(packed, {
        maxFileSize: 1024,
        maxCacheBytes: 0,
      });
      assert.throws(() => archive.readFile('binary.bin'), /maxFileSize/);
      assert.throws(
        () => archive.readRange('binary.bin', 0, 1025),
        /maxFileSize/,
      );
      assert.deepEqual(
        archive.readRange('binary.bin', 65530, 65540),
        binary.subarray(65530, 65540),
      );
      const stream = archive.createReadStream('binary.bin').getReader();
      const parts: Buffer[] = [];
      for (;;) {
        const next = await stream.read();
        if (next.done) break;
        assert.ok(next.value.length <= 1024);
        parts.push(Buffer.from(next.value));
      }
      assert.deepEqual(Buffer.concat(parts), binary);
      archive.close();
    });

    test('text BOMs, GBK TextDecoder, HTML charset and safe JSON errors', () => {
      const archive = new CHMArchive(packed);
      assert.equal(archive.readText('Index.HTML'), html);
      assert.equal(archive.readText('utf16.txt'), '中文🌍');
      assert.equal(archive.readText('utf16be.txt'), '大端中文');
      assert.equal(archive.readText('gbk.txt', 'gbk'), '中文');
      assert.ok(archive.readHTML('gbk.html').includes('<p>中文</p>'));
      assert.throws(
        () => archive.readText('gbk.txt', 'not-an-encoding'),
        /Cannot decode CHM file.*gbk.txt/,
      );
      const json = archive.readJSON<Record<string, unknown>>('data.json');
      assert.equal(json['中文'], true);
      assert.equal(
        Object.prototype.hasOwnProperty.call(json, '__proto__'),
        true,
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'),
        false,
      );
      assert.throws(
        () => archive.readJSON('broken.json'),
        /Invalid JSON.*broken.json/,
      );
      assert.equal(archive.readCSS('style.css'), 'body { color: red; }');
      assert.equal(archive.readJS('app.js'), 'const 中文 = "hello";');
      assert.deepEqual(archive.readImage('pixel.png'), files.get('pixel.png'));
      archive.close();
      const configured = new CHMArchive(packed, { defaultEncoding: 'gbk' });
      assert.equal(configured.readText('gbk.txt'), '中文');
      assert.equal(
        configured.readText('Index.HTML'),
        html,
        'BOM overrides configured encoding',
      );
      configured.close();
    });

    test('listing, inferred/empty directories, tree, case-insensitive existence and globs', () => {
      const archive = new CHMArchive(packed);
      assert.ok(archive.listFiles().includes('/Index.HTML'));
      assert.equal(archive.listFiles().includes('/#SYSTEM'), false);
      assert.equal(
        archive.listFiles().some(path => /^::DataSpace/i.test(path)),
        false,
      );
      assert.equal(
        archive.listDirectories().some(path => /^::DataSpace/i.test(path)),
        false,
      );
      assert.deepEqual(archive.glob('::DataSpace/**'), []);
      assert.equal(archive.exists('/#SYSTEM'), true);
      assert.ok(archive.readFile('/#SYSTEM').length > 0);
      assert.equal(archive.listFiles().includes('/空目录/更深/'), false);
      assert.ok(archive.listDirectories().includes('/nested/deeper/'));
      assert.ok(archive.listDirectories().includes('/空目录/更深/'));
      for (const path of [
        '/',
        '/index.html',
        'NESTED',
        '/空目录/更深/',
        '/nested/./topic.htm',
      ])
        assert.equal(archive.exists(path), true, path);
      assert.equal(archive.exists('missing.txt'), false);
      assert.throws(() => archive.readFile('/nested/'), /directory/);
      assert.throws(() => archive.readFile('missing.txt'), /not found/);
      assert.throws(
        () => archive.readFile('../outside'),
        /escapes archive root/,
      );
      assert.deepEqual(archive.glob('**/*.htm'), ['/nested/topic.htm']);
      assert.deepEqual(archive.glob('/**/*.{html,htm}'), [
        '/Index.HTML',
        '/gbk.html',
        '/nested/topic.htm',
      ]);
      assert.deepEqual(archive.listFiles('*.HTML'), [
        '/Index.HTML',
        '/gbk.html',
      ]);
      assert.deepEqual(archive.glob('nested/topi?.htm'), ['/nested/topic.htm']);
      assert.deepEqual(archive.glob('nested/[t]opic.htm'), [
        '/nested/topic.htm',
      ]);
      assert.deepEqual(archive.findFiles('topic'), ['/nested/topic.htm']);
      assert.deepEqual(archive.findFiles('**/*.bin'), [
        '/binary.bin',
        '/empty.bin',
      ]);
      const tree = archive.getFileTree();
      assert.equal(tree.type, 'directory');
      assert.equal(
        tree.children!.some(node => /^(?:\/[#$]|::DataSpace)/i.test(node.path)),
        false,
      );
      assert.equal(
        tree.children!.find(node => node.path === '/空目录/')!.children![0]
          .path,
        '/空目录/更深/',
      );
      assert.equal(
        tree.children!.find(node => node.path === '/binary.bin')!.size,
        binary.length,
      );
      archive.close();
    });

    test('/#SYSTEM metadata, mixed-case TOC paths, nested HHC/HHK and entities', () => {
      const archive = new CHMArchive(packed);
      assert.deepEqual(archive.getMetadata(), {
        title: '中文 & title',
        defaultTopic: 'index.html',
        toc: 'TOC/CONTENTS.hhc',
        index: 'toc/Keywords.HHK',
      });
      assert.equal(archive.getDefaultPage(), '/Index.HTML');
      assert.equal(archive.getHomePage(), '/Index.HTML');
      const toc = archive.getTOC();
      assert.equal(toc.length, 2);
      assert.equal(toc[0].name, 'Chapter & 中文');
      assert.equal(toc[0].local, '/Index.HTML');
      assert.equal(toc[0].children![0].name, 'Child 中文 "quoted" ©');
      assert.equal(toc[0].children![0].local, '/nested/topic.htm?x=1&y=2#部分');
      assert.equal(toc[0].children![0].children![0].level, 2);
      assert.equal(toc[0].children![1].name, 'Sibling');
      const keywords = archive.getIndex();
      assert.equal(keywords[0].name, '关键词 & index');
      assert.equal(keywords[0].children![0].local, '/nested/topic.htm');
      const links = archive.getNavigationLinks('Index.HTML');
      assert.equal(links.length, 2);
      assert.equal(links[0].name, '下页 & more');
      assert.equal(links[0].local, '/nested/topic.htm?x=1&y=2#部分');
      assert.equal(links[1].rel, 'next');
      archive.close();
    });

    test('UTF-8 #SYSTEM and LCID-selected ANSI metadata decode independently of header language', () => {
      const cases: {
        title: string | Buffer;
        systemLanguage?: number;
        headerLanguage: number;
      }[] = [
        { title: '中文元数据🌍', systemLanguage: 0x804, headerLanguage: 0x409 },
        { title: gbk, systemLanguage: 0x804, headerLanguage: 0x409 },
        {
          title: Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]),
          systemLanguage: 0x404,
          headerLanguage: 0x804,
        },
        {
          title: Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]),
          systemLanguage: 0x1404,
          headerLanguage: 0x409,
        },
        { title: gbk, headerLanguage: 0x804 },
      ];
      for (const { title, systemLanguage, headerLanguage } of cases) {
        const data = packFiles(
          new Map([['中文.html', Buffer.from('<title>中文页面</title>')]]),
          {
            compression,
            title: typeof title === 'string' ? title : 'XXXX',
            defaultTopic: '中文.html',
          },
        );
        data.writeUInt32LE(headerLanguage, 20);
        const system = storedEntry(
          data,
          inspectDirectory(data).entries.get('/#SYSTEM')!,
        );
        for (let offset = 4; offset < system.length; ) {
          const code = system.readUInt16LE(offset);
          const length = system.readUInt16LE(offset + 2);
          if (code === 3 && typeof title !== 'string') {
            assert.equal(length, title.length + 1);
            title.copy(system, offset + 4);
          }
          if (code === 4) {
            if (systemLanguage === undefined)
              system.writeUInt16LE(0xffff, offset);
            else system.writeUInt32LE(systemLanguage, offset + 4);
          }
          offset += 4 + length;
        }
        const archive = new CHMArchive(data);
        try {
          assert.equal(
            archive.getMetadata().title,
            typeof title === 'string' ? title : '中文',
          );
          assert.equal(archive.getMetadata().defaultTopic, '中文.html');
          assert.equal(archive.getDefaultPage(), '/中文.html');
          assert.equal(archive.getTOC()[0].name, '中文页面');
        } finally {
          archive.close();
        }
      }
    });

    test('metadata sizes/MIME, shared-stream uncertainty and batch reads', () => {
      const archive = new CHMArchive(packed);
      const info = archive.getFileInfo('binary.bin');
      assert.equal(info.size, binary.length);
      assert.equal(info.isCompressed, compression);
      assert.equal(info.compressedSizeExact, !compression);
      assert.equal(archive.getFileSize('empty.bin'), 0);
      assert.equal(
        archive.getCompressedSize('binary.bin'),
        compression ? null : binary.length,
      );
      assert.equal(
        archive.getCompressionRatio('binary.bin'),
        compression ? null : 1,
      );
      if (compression) assert.match(info.compressionNote!, /shared LZX stream/);
      assert.equal(archive.getMimeType('Index.HTML'), 'text/html');
      assert.equal(archive.getMimeType('pixel.png'), 'image/png');
      const withMetadata = archive.readWithMetadata('pixel.png');
      assert.equal(withMetadata.metadata.mimeType, 'image/png');
      assert.deepEqual(withMetadata.data, files.get('pixel.png'));
      const multiple = archive.readMultiple(['empty.bin', 'pixel.png']);
      assert.equal(multiple.size, 2);
      assert.deepEqual(multiple.get('empty.bin'), Buffer.alloc(0));
      assert.throws(() => archive.readMultiple(['missing']), /not found/);
      archive.close();
    });

    test('bounded literal search, regex metacharacters, context, case and filename fuzzy search', () => {
      const archive = new CHMArchive(packed);
      const results = archive.search('hello', {
        pattern: '**/*.{html,htm,txt}',
        maxResults: 2,
        maxMatchesPerFile: 1,
      });
      assert.equal(results.length, 2);
      assert.equal(
        results.every(result => result.matches.length === 1),
        true,
      );
      assert.equal(archive.search('中文', { maxResults: 1 }).length, 1);
      const literal = archive.searchInFile('Index.HTML', '.*');
      assert.equal(literal.length, 1);
      assert.equal(literal[0].match, '.*');
      assert.equal(archive.searchInFile('Index.HTML', '[x]').length, 1);
      const matches = archive.searchInFile('nested/topic.htm', 'a+b', {
        maxResults: 1,
        contextLength: 3,
      });
      assert.equal(matches.length, 1);
      assert.equal(matches[0].line, 2);
      assert.equal(matches[0].column, 1);
      assert.equal(
        archive.searchInFile('Index.HTML', 'HELLO', { caseSensitive: true })
          .length,
        0,
      );
      assert.equal(
        archive.searchInFile('Index.HTML', 'Hell', { wholeWord: true }).length,
        0,
      );
      assert.deepEqual(archive.search('', {}), []);
      assert.deepEqual(archive.search('hello', { maxResults: 0 }), []);
      assert.throws(
        () => archive.search('hello', { maxResults: -1 }),
        /maxResults/,
      );
      const fuzzy = archive.fuzzySearch('ntpc', { maxResults: 1 });
      assert.equal(fuzzy.length, 1);
      assert.equal(fuzzy[0].path, '/nested/topic.htm');
      assert.ok(fuzzy[0].score! > 0 && fuzzy[0].score! <= 1);
      archive.close();
    });

    test('close releases both caches and makes all data operations fail, including active streams', async () => {
      const archive = new CHMArchive(packed);
      archive.preload(['Index.HTML', 'pixel.png']);
      assert.ok(archive.getCacheStats().entries > 0);
      const stream = archive.createReadStream('binary.bin').getReader();
      await stream.read();
      archive.close();
      archive.close();
      assert.equal(archive.isOpen(), false);
      assert.equal(archive.getCacheStats().bytes, 0);
      assert.equal(archive.getCacheStats().entries, 0);
      for (const action of [
        () => archive.listFiles(),
        () => archive.listDirectories(),
        () => archive.exists('a'),
        () => archive.readFile('Index.HTML'),
        () => archive.readRange('empty.bin'),
        () => archive.getFileInfo('empty.bin'),
        () => archive.getMetadata(),
        () => archive.getTOC(),
        () => archive.search('hello'),
        () => archive.preload([]),
        () => archive.createReadStream('empty.bin'),
      ]) {
        assert.throws(action, /closed/);
      }
      await assert.rejects(stream.read(), /closed/);
    });

    test('cache none/LRU, shared memory budget, explicit preload and clearCache', () => {
      const archive = new CHMArchive(packed, {
        maxCacheBytes: 131072,
        cacheStrategy: CacheStrategy.None,
      });
      archive.readFile('pixel.png');
      archive.readFile('pixel.png');
      assert.equal(archive.getCacheStats().entries, 0);
      assert.equal(archive.getCacheStats().bytes, 0);
      archive.setCacheStrategy('lru');
      archive.preload(['pixel.png']);
      assert.equal(
        archive.getCacheStats().files.entries,
        1,
        'preload only specified files',
      );
      archive.readFile('pixel.png');
      assert.equal(archive.getCacheStats().files.hits, 1);
      archive.readRange('binary.bin', 0, 65536);
      assert.ok(archive.getCacheStats().bytes <= 131072);
      archive.clearCache();
      assert.equal(archive.getCacheStats().entries, 0);
      assert.equal(archive.getCacheStats().bytes, 0);
      archive.setCacheStrategy('none');
      archive.readFile('pixel.png');
      assert.equal(archive.getCacheStats().entries, 0);
      assert.throws(
        () => archive.setCacheStrategy('unsupported' as 'none'),
        /Unsupported cache strategy/,
      );
      archive.close();
    });
  });
}

describe('CHMArchive limits and LRU', () => {
  for (const compression of [false, true]) {
    test(`real byte-budget LRU eviction (compression=${compression})`, () => {
      const data = packFiles(
        new Map([
          ['a.txt', Buffer.from('aaaa')],
          ['b.txt', Buffer.from('bbbb')],
          ['c.txt', Buffer.from('cccc')],
        ]),
        { compression },
      );
      const archive = new CHMArchive(data, { maxCacheBytes: 16 });
      archive.readFile('a.txt');
      archive.readFile('b.txt');
      archive.readFile('a.txt');
      archive.readFile('c.txt');
      let stats = archive.getCacheStats();
      assert.equal(stats.files.entries, 2);
      assert.equal(stats.files.bytes, 8);
      assert.equal(stats.files.hits, 1);
      assert.equal(stats.files.misses, 3);
      archive.readFile('b.txt');
      stats = archive.getCacheStats();
      assert.equal(
        stats.files.misses,
        4,
        'b was evicted, despite being newer than a before the cache hit',
      );
      assert.ok(stats.bytes <= stats.maxBytes);
      archive.close();
    });
  }
  test('defaults, invalid options and corrupt archives fail clearly', () => {
    const packed = packFiles(new Map(), { compression: false });
    const archive = new CHMArchive(packed);
    assert.equal(archive.getCacheStats().maxBytes, 8 * 1024 * 1024);
    assert.equal(archive.getDefaultPage(), undefined);
    archive.close();
    for (const options of [
      { maxCacheBytes: -1 },
      { maxFileSize: NaN },
      { maxFileSize: 0.1 },
    ])
      assert.throws(() => new CHMArchive(packed, options), RangeError);
    assert.throws(() => new CHMArchive(Buffer.from('bad archive')));
  });
  test('generated navigation preserves literal URL-special filename characters', () => {
    const path = '/docs/hash#file%.html';
    const archive = new CHMArchive(
      packFiles(new Map([[path, Buffer.from('<h1>Literal filename</h1>')]])),
    );
    assert.equal(archive.getDefaultPage(), path);
    assert.equal(archive.getTOC()[0].local, path);
    assert.equal(archive.readHTML(path), '<h1>Literal filename</h1>');
    archive.close();
  });

  test('large reset streams decode each frame once without any retained cache', async () => {
    const source = Buffer.alloc(1024 * 1024, 97);
    const packed = reencodeArchive(
      packFiles(new Map([['large.bin', source]])),
      { resetInterval: source.length },
    );
    const archive = new CHMArchive(packed, { maxCacheBytes: 0 });
    const original = LZXDecoder.prototype.iterateFrames;
    let frames = 0;
    LZXDecoder.prototype.iterateFrames = function* (...args) {
      for (const frame of original.apply(this, args)) {
        frames++;
        yield frame;
      }
    };
    try {
      const chunks: Buffer[] = [];
      const stream = archive.createReadStream('large.bin').getReader();
      for (;;) {
        const { done, value } = await stream.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      assert.deepEqual(Buffer.concat(chunks), source);
      assert.equal(frames, source.length / LZXDecoder.FRAME_SIZE);
      assert.equal(chunks.length, source.length / 65536);
      assert.equal(archive.getCacheStats().bytes, 0);
    } finally {
      LZXDecoder.prototype.iterateFrames = original;
      archive.close();
    }
  });

  // Deliberately omit inferred parents to model tiny hostile third-party archives.
  function directoryOnlyArchive(names: string[]): Buffer {
    const chunkSize = 65536;
    const leaves = CHMHeaderBuilder.serializeDirectory(
      names.map(name => ({
        name,
        section: 0,
        offset: 0,
        length: 0,
        isCompressed: false,
      })),
      chunkSize,
    );
    const itsp = CHMHeaderBuilder.serializeITSPHeader(
      CHMHeaderBuilder.createITSPHeader({
        chunkSize,
        numChunks: leaves.length / chunkSize,
      }),
    );
    const directoryLength = itsp.length + leaves.length;
    const itsf = CHMHeaderBuilder.serializeITSFHeader(
      CHMHeaderBuilder.createITSFHeader({
        directoryOffset: 120,
        directoryLength,
      }),
    );
    const auxiliary = Buffer.alloc(24);
    auxiliary.writeUInt32LE(0x01fe);
    auxiliary.writeBigUInt64LE(BigInt(120 + directoryLength), 8);
    return Buffer.concat([itsf, auxiliary, itsp, leaves]);
  }

  test('directory expansion rejects pathological depth before allocating parent paths', () => {
    for (const depth of [1025, 8192]) {
      const archive = new CHMArchive(
        directoryOnlyArchive([`/${'A/'.repeat(depth)}f`]),
      );
      assert.equal(
        archive.listFiles().length,
        1,
        'raw listing remains available',
      );
      assert.throws(() => archive.listDirectories(), /directory depth exceeds/);
      assert.throws(() => archive.getFileTree(), /directory depth exceeds/);
      archive.close();
    }
    const archive = new CHMArchive(
      directoryOnlyArchive([`/${'A/'.repeat(1024)}f`, '/İ/child/f']),
    );
    assert.equal(archive.listDirectories().length, 1026);
    assert.ok(archive.listDirectories().includes('/İ/child/'));
    archive.close();
  });

  test('directory expansion has an aggregate path-character budget across shallow inputs', () => {
    const names = [0, 1, 2].map(
      index => `/branch${index}/${`${'a'.repeat(128)}/`.repeat(256)}f`,
    );
    const archive = new CHMArchive(directoryOnlyArchive(names));
    assert.throws(
      () => archive.listDirectories(),
      /directory expansion exceeds/,
    );
    archive.close();
  });
});
