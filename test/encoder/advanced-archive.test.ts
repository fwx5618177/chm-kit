import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { packFiles } from '../../src/encoder/archive-builder';
import type { PackFilesOptions, PackTOCEntry } from '../../src/encoder/types';
import { CHMArchive } from '../../src/reader/chm-archive';
import { readArchiveForVerification } from '../../src/encoder/archive-validation';
import { sevenZip } from '../support/sevenzip';
import {
  deterministicRandom,
  inspectDirectory,
  storedEntry,
} from './archive-fixtures';

const STORAGE = '::DataSpace/Storage/MSCompressed/';

function systemRecords(archive: Buffer): Map<number, Buffer> {
  const { entries } = inspectDirectory(archive);
  const system = storedEntry(archive, entries.get('/#SYSTEM')!);
  const records = new Map<number, Buffer>();
  for (let offset = 4; offset < system.length;) {
    const code = system.readUInt16LE(offset);
    const size = system.readUInt16LE(offset + 2);
    records.set(code, system.subarray(offset + 4, offset + 4 + size));
    offset += size + 4;
  }
  return records;
}

test('packFiles connects window, reset, block size and level to actual bytes and ControlData', () => {
  const files = new Map([
    ['data.bin', Buffer.from('help text 0123456789 '.repeat(8000))],
  ]);
  const low = packFiles(files, { compressionLevel: 0 });
  const high = packFiles(files, {
    compressionLevel: 9,
    windowBits: 21,
    resetInterval: 4 * 32768,
    blockSize: 1024,
  });
  assert.ok(high.length < low.length / 5);
  const { entries } = inspectDirectory(high);
  const control = storedEntry(high, entries.get(`${STORAGE}ControlData`)!);
  assert.equal(control.readUInt32LE(12), 4);
  assert.equal(control.readUInt32LE(16), 64);
  assert.deepEqual(
    readArchiveForVerification(high).get('/data.bin'),
    files.get('data.bin'),
  );
  for (const options of [
    { windowBits: null as never },
    { resetInterval: null as never },
    { blockSize: '512' as never },
    { compressionLevel: null as never },
    { windowBits: 14 },
    { windowBits: 22 },
    { windowBits: 15.5 },
    { resetInterval: 0 },
    { resetInterval: 3 * 32768 },
    { resetInterval: 0x20000000 },
    { resetInterval: Infinity },
    { blockSize: 32769 },
    { blockSize: 1023 },
    { compressionLevel: -1 },
    { compressionLevel: 10 },
  ]) {
    for (const compression of [false, true])
      assert.throws(() => packFiles(files, { ...options, compression }));
  }
  assert.throws(
    () => packFiles(files, { compression: 'false' as never }),
    /compression/,
  );
});

test('URL references validate the decoded target and exact Unicode spelling, not a percent/NFC alias', () => {
  const files = new Map([['a%20b.html', Buffer.from('literal percent name')]]);
  assert.throws(
    () => packFiles(files, { defaultTopic: 'a%20b.html' }),
    /does not name a file/,
  );
  assert.throws(
    () =>
      packFiles(files, {
        tocEntries: [{ name: 'Bad encoded target', local: 'a%20b.html' }],
      }),
    /does not name a file/,
  );
  const valid = new CHMArchive(
    packFiles(files, { defaultTopic: 'a%2520b.html' }),
  );
  assert.equal(valid.getDefaultPage(), '/a%20b.html');
  valid.close();
  assert.throws(
    () =>
      packFiles(new Map([['café.html', Buffer.alloc(0)]]), {
        defaultTopic: 'cafe\u0301.html',
      }),
    /does not name a file/,
  );
  const nfd = new CHMArchive(
    packFiles(
      new Map([['cafe\u0301.html', Buffer.from('<title>NFD</title>')]]),
    ),
  );
  assert.equal(nfd.getDefaultPage(), '/cafe\u0301.html');
  assert.equal(nfd.getTOC()[0]!.local, '/cafe\u0301.html');
  nfd.close();
});

test('selected authored navigation with hash and percent names cannot silently fall back to another file', () => {
  const hhc = (name: string): Buffer =>
    Buffer.from(
      `<ul><li><object type="text/sitemap"><param name="Name" value="${name}"><param name="Local" value="index.html"></object></ul>`,
    );
  const archive = packFiles(
    new Map([
      ['index.html', Buffer.alloc(0)],
      ['first.hhc', hhc('Wrong')],
      ['first.hhk', hhc('Wrong index')],
      ['nav#v%20.hhc', hhc('Selected')],
      ['index#v%20.hhk', hhc('Selected index')],
    ]),
    { contentsFile: 'nav#v%20.hhc', indexFile: 'index#v%20.hhk' },
  );
  const reader = new CHMArchive(archive);
  assert.equal(reader.getTOC()[0]!.name, 'Selected');
  assert.equal(reader.getIndex()[0]!.name, 'Selected index');
  assert.equal(systemRecords(archive).get(0)!.toString(), 'nav%23v%2520.hhc\0');
  reader.close();
});

test('generated contents have complete folder hierarchy; custom hierarchy/template and local URLs survive the reader', () => {
  const files = new Map([
    ['index.html', Buffer.from('<title>Home</title>')],
    ['chapter/deep/topic #%.htm', Buffer.from('<title>Deep & topic</title>')],
    ['other/topic.html', Buffer.from('<title>Other</title>')],
  ]);
  const inferred = new CHMArchive(
    packFiles(files, { tocHierarchy: 'folders' }),
  );
  assert.equal(inferred.getTOC()[1]!.name, 'chapter');
  assert.equal(inferred.getTOC()[1]!.children![0]!.name, 'deep');
  assert.equal(
    inferred.getTOC()[1]!.children![0]!.children![0]!.local,
    '/chapter/deep/topic #%.htm',
  );
  inferred.close();
  const archive = packFiles(files, {
    tocEntries: [
      {
        name: 'Book <&>',
        children: [
          { name: 'Start', local: 'index.html' },
          { name: 'Details', local: 'chapter/deep/topic%20%23%25.htm#anchor' },
        ],
      },
    ],
    tocTemplate:
      '<html><head><meta charset="utf-8"></head><body data-custom="yes"><ul>{{entries}}</ul></body></html>',
  });
  const reader = new CHMArchive(archive);
  assert.equal(reader.getTOC()[0]!.name, 'Book <&>');
  assert.equal(reader.getTOC()[0]!.children!.length, 2);
  assert.equal(
    reader.getTOC()[0]!.children![1]!.local,
    '/chapter/deep/topic #%.htm#anchor',
  );
  assert.match(reader.readText('/Table of Contents.hhc'), /data-custom="yes"/);
  reader.close();
  for (const options of [
    { tocEntries: [{ name: 'Bad', local: 'missing.html' }] },
    { tocEntries: [{ name: 'Bad', local: 'https://example.com' }] },
    { tocEntries: [{ name: 'Bad', local: '../index.html' }] },
    { tocTemplate: '<ul>no insertion</ul>' },
    { tocTemplate: '{{entries}}{{entries}}' },
  ])
    assert.throws(() => packFiles(files, options));
  const cycle: PackTOCEntry = { name: 'Cycle' };
  cycle.children = [cycle];
  assert.throws(() => packFiles(files, { tocEntries: [cycle] }), /Cyclic/);
});

test('explicit authored navigation is selected, never overwritten; real HTML Help records and LCIDs are serialized', () => {
  const files = new Map([
    ['index.html', Buffer.from('<title>首页</title>')],
    ['a.hhc', Buffer.from('first authored TOC')],
    ['b.hhc', Buffer.from('second authored TOC')],
    ['custom.hhk', Buffer.from('authored index')],
  ]);
  const archive = packFiles(files, {
    title: '中文帮助',
    languageId: 0x804,
    contentsFile: 'b.hhc',
    indexFile: 'custom.hhk',
    htmlHelp: {
      compiler: 'Test compiler',
      compiledFile: 'manual',
      defaultWindow: 'Main',
      defaultFont: 'Arial,10,0',
      extraRecords: new Map([[0x1234, Uint8Array.of(0, 255, 17)]]),
    },
  });
  const records = systemRecords(archive);
  assert.equal(records.get(0)!.toString(), 'b.hhc\0');
  assert.equal(records.get(5)!.toString(), 'Main\0');
  assert.equal(records.get(6)!.toString(), 'manual\0');
  assert.equal(records.get(9)!.toString(), 'Test compiler\0');
  assert.equal(records.get(16)!.toString(), 'Arial,10,0\0');
  assert.deepEqual(records.get(0x1234), Buffer.from([0, 255, 17]));
  assert.equal(records.get(4)!.readUInt32LE(0), 0x804);
  assert.equal(archive.readUInt32LE(20), 0x804);
  assert.equal(
    archive.readUInt32LE(Number(archive.readBigUInt64LE(72)) + 48),
    0x804,
  );
  const reader = new CHMArchive(archive);
  assert.equal(reader.getMetadata().title, '中文帮助');
  assert.equal(reader.readText('b.hhc'), 'second authored TOC');
  reader.close();
  assert.throws(() => packFiles(files, { tocEntries: [] }), /cannot replace/);
  assert.throws(
    () => packFiles(files, { contentsFile: 'missing.hhc' }),
    /not found/,
  );
  assert.throws(
    () => packFiles(files, { htmlHelp: { compiler: 'bad\0value' } }),
    /NUL/,
  );
  assert.throws(
    () =>
      packFiles(files, {
        htmlHelp: { extraRecords: new Map([[3, new Uint8Array()]]) },
      }),
    /Reserved/,
  );
  assert.throws(() => packFiles(files, { languageId: -1 }), /languageId/);
});

(sevenZip ? test : test.skip)(
  '7-Zip verifies the exact stored/VERBATIM/ALIGNED level matrix on rotated noise across frames and resets',
  () => {
    mkdirSync('dist/test-tmp', { recursive: true });
    const directory = mkdtempSync('dist/test-tmp/level-matrix-');
    try {
      const noise = deterministicRandom(32768);
      const source = Buffer.concat([
        noise,
        noise.subarray(4),
        noise.subarray(0, 4),
        Buffer.from(
          'real matches, literal E8 and reset boundaries '.repeat(1000),
        ).subarray(0, 32768 + 239),
      ]);
      for (const windowBits of [15, 21])
        for (const compressionLevel of [0, 1, 2, 3, 4, 6, 9]) {
          const archive = packFiles(
            new Map([
              ['data.bin', source],
              ['toc.hhc', Buffer.alloc(0)],
              ['index.hhk', Buffer.alloc(0)],
            ]),
            { windowBits, compressionLevel, resetInterval: 65536 },
          );
          const { entries } = inspectDirectory(archive);
          const content = storedEntry(
            archive,
            entries.get(`${STORAGE}Content`)!,
          );
          const reset = storedEntry(
            archive,
            entries.get(
              `${STORAGE}Transform/{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}/InstanceData/ResetTable`,
            )!,
          );
          const second = Number(reset.readBigUInt64LE(48));
          assert.equal((content.readUInt16LE(0) >>> 12) & 7, 3);
          assert.equal(
            (content.readUInt16LE(second) >>> 13) & 7,
            compressionLevel === 0 ? 3 : compressionLevel < 4 ? 1 : 2,
          );
          const input = join(
            directory,
            `${windowBits}-${compressionLevel}.chm`,
          );
          const output = join(
            directory,
            `out-${windowBits}-${compressionLevel}`,
          );
          writeFileSync(input, archive);
          execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
            timeout: 20000,
          });
          assert.deepEqual(readFileSync(join(output, 'data.bin')), source);
          assert.deepEqual(
            readFileSync(join(output, '#SYSTEM')),
            storedEntry(archive, entries.get('/#SYSTEM')!),
          );
        }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

(sevenZip ? test : test.skip)(
  '7-Zip accepts empty, odd and exact sub-block/frame boundaries',
  () => {
    mkdirSync('dist/test-tmp', { recursive: true });
    const directory = mkdtempSync('dist/test-tmp/sub-block-boundaries-');
    try {
      for (const length of [0, 1, 255, 256, 257, 32767, 32768, 32769]) {
        for (const compressionLevel of [0, 9]) {
          const bytes = deterministicRandom(length);
          const files = new Map([
            ['data.bin', bytes],
            ['toc.hhc', Buffer.alloc(0)],
            ['index.hhk', Buffer.alloc(0)],
          ]);
          const archive = packFiles(files, {
            compressionLevel,
            blockSize: 256,
            resetInterval: 65536,
          });
          const input = join(directory, `${length}-${compressionLevel}.chm`);
          const output = join(directory, `out-${length}-${compressionLevel}`);
          writeFileSync(input, archive);
          execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
            timeout: 20000,
          });
          assert.deepEqual(readFileSync(join(output, 'data.bin')), bytes);
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

(sevenZip ? test : test.skip)(
  '7-Zip independently extracts actual ALIGNED/adaptive/sub-frame blocks at every public window',
  () => {
    mkdirSync('dist/test-tmp', { recursive: true });
    const directory = mkdtempSync('dist/test-tmp/advanced-lzx-');
    try {
      const pattern = deterministicRandom(64, 0x98765432);
      const files = new Map([
        [
          'aligned.bin',
          Buffer.concat(Array.from({ length: 2048 }, () => pattern)),
        ],
        ['random.bin', deterministicRandom(32767)],
        [
          'index.html',
          Buffer.from('<title>中文</title>help text '.repeat(5000)),
        ],
        ['tail.bin', deterministicRandom(511)],
        ['empty.bin', Buffer.alloc(0)],
      ]);
      const configurations: PackFilesOptions[] = Array.from(
        { length: 7 },
        (_, index) => ({
          windowBits: 15 + index,
          resetInterval: 32768 * 2 ** (index % 3),
          blockSize: [256, 512, 1024, 4096, 32768][index % 5],
          compressionLevel: 9,
        }),
      );
      configurations.push(
        { compressionLevel: 0, blockSize: 512 },
        { compressionLevel: 2, blockSize: 1024 },
        { compressionLevel: 6, blockSize: 4096, resetInterval: 0x10000000 },
      );
      configurations.forEach((config, index) => {
        const archive = packFiles(files, config);
        const input = join(directory, `${index}.chm`);
        const output = join(directory, `out-${index}`);
        writeFileSync(input, archive);
        execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
          timeout: 20000,
        });
        for (const [name, expected] of files)
          assert.deepEqual(
            readFileSync(join(output, name)),
            expected,
            `${index}: ${name}`,
          );
        for (const [name, expected] of readArchiveForVerification(archive)) {
          if (name.startsWith('/') && !name.endsWith('/'))
            assert.deepEqual(
              readFileSync(join(output, name.slice(1))),
              expected,
              `${index}: ${name}`,
            );
        }
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
