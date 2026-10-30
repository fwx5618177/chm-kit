import { test, vi } from 'vitest';
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
import { packFiles, updateArchive } from '../../src/encoder/archive-builder';
import { readArchiveForVerification } from '../../src/encoder/archive-validation';
import { CHMHeaderBuilder } from '../../src/encoder/builders/header-builder';
import type { DirectoryEntry } from '../../src/core/types';
import { CHMArchive } from '../../src/reader/chm-archive';
import { sevenZip } from '../support/sevenzip';
import { inspectDirectory, storedEntry } from './archive-fixtures';

/** Test container construction permits opaque internal streams the public writer refuses. */
function withInternalEntry(
  original: Buffer,
  name: string,
  value: Buffer,
): Buffer {
  const files = readArchiveForVerification(original);
  files.set(name, value);
  const entries: DirectoryEntry[] = [];
  const sections: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    entries.push({
      name,
      section: 0,
      offset,
      length: data.length,
      isCompressed: false,
    });
    sections.push(data);
    offset += data.length;
  }
  const directory = CHMHeaderBuilder.serializeDirectory(entries, 4096);
  const itsp = CHMHeaderBuilder.serializeITSPHeader(
    CHMHeaderBuilder.createITSPHeader({ numChunks: directory.length / 4096 }),
  );
  const itsf = CHMHeaderBuilder.serializeITSFHeader(
    CHMHeaderBuilder.createITSFHeader({
      directoryOffset: 120,
      directoryLength: itsp.length + directory.length,
      languageId: 0x804,
      timestamp: 1234567,
    }),
  );
  const aux = Buffer.alloc(24);
  aux.writeUInt32LE(0x01fe);
  aux.writeBigUInt64LE(
    BigInt(120 + itsp.length + directory.length + offset),
    8,
  );
  return Buffer.concat([itsf, aux, itsp, directory, ...sections]);
}

function fixture(compression: boolean): Buffer {
  return packFiles(
    new Map([
      [
        'index.html',
        Buffer.from('<title>Original title</title>Original content'),
      ],
      ['remove.bin', Buffer.from([1, 0, 255])],
      ['keep.bin', Buffer.from([0, 1, 128, 232, 255])],
      ['empty-dir/', Buffer.alloc(0)],
      [
        'custom.hhc',
        Buffer.from(
          '<html><body><ul><li><object type="text/sitemap"><param name="Name" value="Authored"><param name="Local" value="index.html"></object></ul></body></html>',
        ),
      ],
      ['custom.hhk', Buffer.from('authored index bytes\0\xff')],
    ]),
    {
      compression,
      title: '原始中文标题',
      languageId: 0x804,
      htmlHelp: {
        compiler: 'original compiler',
        defaultWindow: 'Main',
        extraRecords: new Map([[0x1234, Uint8Array.of(0, 17, 255)]]),
      },
      ...(compression ? { windowBits: 16, resetInterval: 65536 } : {}),
    },
  );
}

for (const compression of [false, true]) {
  test(`update preserves every unmodified payload, raw metadata and navigation (compression=${compression})`, () => {
    const original = fixture(compression);
    const before = Buffer.from(original);
    const initial = readArchiveForVerification(original);
    const next = updateArchive(
      new Uint8Array(original),
      new Map<string, Uint8Array | null>([
        ['INDEX.HTML', Buffer.from('<title>Changed title</title>New content')],
        ['remove.bin', null],
        ['added/data.bin', Buffer.from([3, 0, 128, 255])],
        ['empty-dir/', null],
        ['new-empty/', new Uint8Array()],
      ]),
    );
    assert.deepEqual(original, before, 'update must not mutate the source');
    const updated = readArchiveForVerification(next);
    for (const [name, expected] of initial) {
      if (
        name.startsWith('::') ||
        ['/index.html', '/remove.bin', '/empty-dir/'].includes(name)
      )
        continue;
      assert.deepEqual(updated.get(name), expected, name);
    }
    assert.equal(updated.has('/remove.bin'), false);
    assert.equal(updated.has('/empty-dir/'), false);
    assert.ok(updated.has('/new-empty/'));
    assert.deepEqual(
      updated.get('/added/data.bin'),
      Buffer.from([3, 0, 128, 255]),
    );
    assert.equal(
      updated.has('/INDEX.HTML'),
      false,
      'case-insensitive replacement retains canonical spelling',
    );
    assert.deepEqual(updated.get('/#SYSTEM'), initial.get('/#SYSTEM'));
    assert.equal(next.readUInt32LE(20), original.readUInt32LE(20));
    assert.equal(next.readUInt32BE(16), original.readUInt32BE(16));
    const reader = new CHMArchive(next);
    assert.equal(reader.getMetadata().title, '原始中文标题');
    assert.equal(reader.getTOC()[0]!.name, 'Authored');
    assert.equal(reader.getDefaultPage(), '/index.html');
    reader.close();
    const entries = inspectDirectory(next).entries;
    if (compression) {
      const control = storedEntry(
        next,
        entries.get('::DataSpace/Storage/MSCompressed/ControlData')!,
      );
      assert.equal(control.readUInt32LE(12), 2);
      assert.equal(control.readUInt32LE(16), 2);
    } else
      assert.equal(
        entries.has('::DataSpace/Storage/MSCompressed/Content'),
        false,
      );
    assert.deepEqual(
      updateArchive(original, new Map()),
      original,
      'no-op updates preserve the whole original container',
    );
  });
}

test('updates reject decoded default/nav deletion even when a literal percent alias still exists', () => {
  const original = packFiles(
    new Map([
      ['a b.html', Buffer.from('real default')],
      ['a%20b.html', Buffer.from('literal alias')],
      ['nav#v.hhc', Buffer.from('selected navigation')],
      ['nav%23v.hhc', Buffer.from('literal navigation alias')],
    ]),
    { defaultTopic: 'a%20b.html', contentsFile: 'nav#v.hhc' },
  );
  assert.throws(
    () => updateArchive(original, new Map([['a b.html', null]])),
    /does not name a file/,
  );
  assert.throws(
    () => updateArchive(original, new Map([['nav#v.hhc', null]])),
    /does not name a file/,
  );
  const next = updateArchive(
    original,
    new Map([['a%20b.html', Buffer.from('changed literal')]]),
  );
  assert.deepEqual(
    readArchiveForVerification(next).get('/#SYSTEM'),
    readArchiveForVerification(original).get('/#SYSTEM'),
  );
  const reader = new CHMArchive(next);
  assert.equal(reader.getDefaultPage(), '/a b.html');
  reader.close();
});

test('unknown namespace/transform/control extensions and malformed or legacy references are refused rather than discarded', () => {
  const original = fixture(true);
  const storage = '::DataSpace/Storage/MSCompressed/';
  const control = Buffer.alloc(32);
  const entries = inspectDirectory(original).entries;
  storedEntry(original, entries.get(`${storage}ControlData`)!).copy(control);
  control.writeUInt32LE(7, 0);
  control.writeUInt32LE(1234, 28);
  for (const [name, value] of [
    ['::DataSpace/NameList', Buffer.from('custom namespace metadata')],
    [`${storage}Transform/List`, Buffer.alloc(16, 255)],
    [`${storage}SpanInfo`, Buffer.alloc(8)],
    [`${storage}ControlData`, control],
  ] as const) {
    const unsupported = withInternalEntry(original, name, value);
    assert.throws(
      () =>
        updateArchive(unsupported, new Map([['added.bin', Buffer.alloc(0)]])),
      /Cannot safely update/,
    );
    assert.deepEqual(updateArchive(unsupported, new Map()), unsupported);
  }
  for (const system of [
    Buffer.from([3, 0, 0, 0, 1]),
    Buffer.from([3, 0, 0, 0, 0, 0, 2, 0, 255, 0]),
  ]) {
    const unsupported = withInternalEntry(fixture(false), '/#SYSTEM', system);
    assert.throws(
      () => updateArchive(unsupported, new Map([['new.bin', Buffer.alloc(0)]])),
      /Truncated|legacy-encoded/,
    );
  }
});

test('undefined update options preserve inherited compression/window/reset and remain true no-ops', () => {
  const options = {
    compression: undefined,
    windowBits: undefined,
    resetInterval: undefined,
    blockSize: undefined,
    compressionLevel: undefined,
  };
  for (const compression of [false, true]) {
    const original = fixture(compression);
    assert.deepEqual(updateArchive(original, new Map(), options), original);
    const updated = updateArchive(
      original,
      new Map([['added.bin', Buffer.from('new')]]),
      options,
    );
    const { entries } = inspectDirectory(updated);
    assert.equal(entries.get('/keep.bin')!.section, compression ? 1 : 0);
    if (compression) {
      const control = storedEntry(
        updated,
        entries.get('::DataSpace/Storage/MSCompressed/ControlData')!,
      );
      assert.equal(control.readUInt32LE(12), 2);
      assert.equal(control.readUInt32LE(16), 2);
    }
  }
  const compiled = withInternalEntry(
    fixture(false),
    '/#TOPICS',
    Buffer.from('opaque compiled bytes'),
  );
  assert.deepEqual(updateArchive(compiled, new Map(), options), compiled);
});

test('updates with maximum declared reset intervals allocate actual data, never a reset-sized group buffer', () => {
  const files = new Map([
    ['index.html', Buffer.from('<title>Help</title>')],
    ['data.bin', Buffer.from('0123456789abcdef'.repeat(17000))],
  ]);
  const original = packFiles(files, { resetInterval: 0x10000000 });
  const allocations = vi.spyOn(Buffer, 'alloc');
  let next: Buffer;
  try {
    next = updateArchive(
      original,
      new Map([['new.bin', Buffer.from([0, 255])]]),
    );
    assert.ok(allocations.mock.calls.length > 0);
    assert.ok(
      Math.max(...allocations.mock.calls.map(([size]) => size)) < 1024 * 1024,
    );
  } finally {
    allocations.mockRestore();
  }
  const actual = readArchiveForVerification(next!);
  assert.deepEqual(actual.get('/data.bin'), files.get('data.bin'));
  assert.deepEqual(actual.get('/new.bin'), Buffer.from([0, 255]));
});

test('result size is preflighted before override copies and opaque metadata cannot hide file/directory conflicts', () => {
  const original = fixture(false);
  // Report an oversized view without allocating a 256 MiB fixture. This
  // verifies the preflight error occurs before Buffer.from attempts a copy.
  const oversized = new Proxy(Uint8Array.of(1), {
    get(target, key) {
      return key === 'length' ? 0x10000001 : Reflect.get(target, key, target);
    },
  });
  assert.throws(
    () => updateArchive(original, new Map([['large.bin', oversized]])),
    /resulting payloads.*256 MiB/,
  );
  const file = withInternalEntry(original, '/#CUSTOM', Buffer.from('file'));
  const conflicting = withInternalEntry(
    file,
    '/#CUSTOM/child',
    Buffer.from('child'),
  );
  assert.throws(
    () => updateArchive(conflicting, new Map([['new.bin', Buffer.alloc(0)]])),
    /parent directory/,
  );
});

test('opaque metadata is preserved, unsafe compiled structures and unknown DataSpaces fail explicitly', () => {
  const original = fixture(false);
  const opaque = withInternalEntry(
    original,
    '/#CUSTOM',
    Buffer.from([0, 255, 17, 128]),
  );
  const updated = updateArchive(
    opaque,
    new Map([['index.html', Buffer.from('new bytes')]]),
  );
  const actual = readArchiveForVerification(updated);
  assert.deepEqual(actual.get('/#CUSTOM'), Buffer.from([0, 255, 17, 128]));
  assert.equal(updated.readUInt32BE(16), 1234567);
  for (const name of [
    '/#TOPICS',
    '/#FIftiMain',
    '/#WINDOWS',
    '/$OBJINST',
    '::DataSpace/Storage/Unknown/Content',
    '::DataSpace/Storage/Unknown/',
  ]) {
    const unsupported = withInternalEntry(
      original,
      name,
      name.endsWith('/')
        ? Buffer.alloc(0)
        : Buffer.from('opaque compiled bytes'),
    );
    assert.throws(
      () =>
        updateArchive(unsupported, new Map([['new.bin', Buffer.from('new')]])),
      /Cannot safely update/,
    );
    assert.deepEqual(
      updateArchive(unsupported, new Map()),
      unsupported,
      'no-op need not discard or regenerate compiled data',
    );
  }
});

test('updates are transactional: reject dangling defaults/nav, aliases, missing deletes and reserved or conflicting paths', () => {
  const original = fixture(false);
  for (const changes of [
    new Map([['index.html', null]]),
    new Map([['custom.hhc', null]]),
    new Map([['custom.hhk', null]]),
    new Map([['absent.bin', null]]),
    new Map([['#SYSTEM', Buffer.from('bad')]]),
    new Map([['../escape', Buffer.from('bad')]]),
    new Map([['CON.txt', Buffer.from('bad')]]),
    new Map([['keep.bin/child', Buffer.from('bad')]]),
    new Map([
      ['new', Buffer.from('one')],
      ['/NEW', Buffer.from('two')],
    ]),
  ])
    assert.throws(() => updateArchive(original, changes));
  const withDirectory = updateArchive(
    original,
    new Map([['directory/file.bin', Buffer.from('data')]]),
  );
  assert.throws(
    () => updateArchive(withDirectory, new Map([['directory/', null]])),
    /nonempty/,
  );
  const removed = updateArchive(
    withDirectory,
    new Map([
      ['directory/', null],
      ['directory/file.bin', null],
    ]),
  );
  assert.equal(readArchiveForVerification(removed).has('/directory/'), false);
  assert.throws(
    () => updateArchive(original, new Map(), { title: 'not allowed' } as never),
    /Unsupported updateArchive option/,
  );
  assert.throws(() => updateArchive(Uint8Array.of(1, 2, 3), new Map()), /./);
});

(sevenZip ? test : test.skip)(
  '7-Zip restores updated archives with preserved metadata/navigation and explicit recompression options',
  () => {
    mkdirSync('dist/test-tmp', { recursive: true });
    const directory = mkdtempSync('dist/test-tmp/update-');
    try {
      for (const compression of [false, true]) {
        const original = fixture(!compression);
        const archive = updateArchive(
          original,
          new Map<string, Uint8Array | null>([
            ['index.html', Buffer.from('Updated content '.repeat(10000))],
            ['remove.bin', null],
            ['nested/new.bin', Buffer.from([255, 0, 128])],
          ]),
          {
            compression,
            compressionLevel: 9,
            blockSize: 512,
            windowBits: 21,
            resetInterval: 131072,
          },
        );
        const input = join(directory, `${compression}.chm`);
        const output = join(directory, `out-${compression}`);
        writeFileSync(input, archive);
        execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
          timeout: 20000,
        });
        for (const [name, bytes] of readArchiveForVerification(archive)) {
          if (name.startsWith('/') && !name.endsWith('/'))
            assert.deepEqual(
              readFileSync(join(output, name.slice(1))),
              bytes,
              name,
            );
        }
        assert.deepEqual(
          readFileSync(join(output, '#SYSTEM')),
          readArchiveForVerification(original).get('/#SYSTEM'),
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
