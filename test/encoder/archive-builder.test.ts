import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { sevenZip } from '../support/sevenzip';
import { packFiles } from '../../src/encoder/archive-builder';
import {
  readArchiveForVerification,
  compareArchiveFiles,
} from '../../src/encoder/archive-validation';
import { CHMEncoder } from '../../src/encoder/chm-encoder';
import { CHMFileWriter } from '../../src/encoder/chm-file-writer';
import {
  allBytes,
  inspectDirectory,
  storedEntry,
  reencodeArchive,
} from './archive-fixtures';

const STORAGE = '::DataSpace/Storage/MSCompressed/';
const RESET = `${STORAGE}Transform/{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}/InstanceData/ResetTable`;

function fixture(): Map<string, Buffer> {
  const files = new Map([
    ['index.html', Buffer.from('<title>中文 & 标题</title><p>你好🌍</p>')],
    ['all-bytes.bin', allBytes(131075)],
    ['empty.bin', Buffer.alloc(0)],
    ['空目录/更深/', Buffer.alloc(0)],
    [
      `中文目录/${'很长的路径'.repeat(12)}.html`,
      Buffer.from([0, 0x80, 0xe8, 0xff]),
    ],
    ['nested/topic.htm', Buffer.from('<title>Nested</title>nested topic')],
  ]);
  for (let index = 0; index < 600; index++) {
    files.set(
      `多块目录/文件-${index.toString().padStart(4, '0')}.bin`,
      Buffer.from([index % 256, 0x80, 0xff]),
    );
  }
  return files;
}

function metadata(archive: Buffer): Map<number, string> {
  const { entries } = inspectDirectory(archive);
  const data = storedEntry(archive, entries.get('/#SYSTEM')!);
  assert.equal(data.readUInt32LE(0), 3);
  const fields = new Map<number, string>();
  for (let offset = 4; offset < data.length; ) {
    const code = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    assert.ok(offset + 4 + length <= data.length);
    if ([0, 1, 2, 3].includes(code)) {
      assert.equal(data[offset + 4 + length - 1], 0);
      fields.set(
        code,
        data.toString('utf8', offset + 4, offset + 4 + length - 1),
      );
    }
    offset += 4 + length;
  }
  return fields;
}

function tempDirectory(): string {
  mkdirSync('dist/test-tmp', { recursive: true });
  return mkdtempSync('dist/test-tmp/encoder-');
}

for (const compression of [false, true]) {
  test(`standard CHM fields, addressable DataSpace, multichunk quickrefs (compression=${compression})`, () => {
    const files = fixture();
    const data = packFiles(files, {
      compression,
      title: '中文档案标题',
      defaultTopic: 'nested/topic.htm',
    });
    assert.equal(data.toString('ascii', 0, 4), 'ITSF');
    assert.equal(data.readUInt32LE(4), 3);
    assert.equal(data.readUInt32LE(8), 96);
    assert.equal(
      data.subarray(24, 56).toString('hex'),
      '10fd017caa7bd0119e0c00a0c922e6ec11fd017caa7bd0119e0c00a0c922e6ec',
    );
    assert.equal(data.readBigUInt64LE(56), 96n);
    assert.equal(data.readBigUInt64LE(64), 24n);
    assert.equal(data.readUInt32LE(96), 0x01fe);
    assert.equal(data.readBigUInt64LE(104), BigInt(data.length));
    assert.equal(data.readBigUInt64LE(72), 120n);
    assert.equal(data.readBigUInt64LE(88), 120n + data.readBigUInt64LE(80));
    assert.equal(data.toString('ascii', 120, 124), 'ITSP');
    const { entries, chunks } = inspectDirectory(data);
    assert.ok(chunks > 2, 'exercise several PMGL leaves and quickref regions');
    for (const [name, bytes] of files) {
      const entry = entries.get(`/${name}`);
      assert.ok(entry, `entry retained: ${name}`);
      assert.equal(entry.length, bytes.length);
      assert.equal(entry.section, name.endsWith('/') ? 0 : compression ? 1 : 0);
      if (!compression && !name.endsWith('/'))
        assert.deepEqual(storedEntry(data, entry), bytes);
    }
    const names = storedEntry(data, entries.get('::DataSpace/NameList')!);
    assert.equal(names.readUInt16LE(0) * 2, names.length);
    assert.equal(names.readUInt16LE(2), compression ? 2 : 1);
    assert.equal(names.readUInt16LE(4), 'Uncompressed'.length);
    assert.equal(names.toString('utf16le', 6, 6 + 24), 'Uncompressed');
    if (compression) {
      const control = storedEntry(data, entries.get(`${STORAGE}ControlData`)!);
      assert.equal(control.length, 28);
      assert.equal(control.readUInt32LE(0), 6);
      assert.equal(control.toString('ascii', 4, 8), 'LZXC');
      assert.equal(control.readUInt32LE(8), 2);
      assert.equal(control.readUInt32LE(12), 1);
      assert.equal(control.readUInt32LE(16), 1);
      const reset = storedEntry(data, entries.get(RESET)!);
      assert.equal(reset.readUInt32LE(12), 0x28);
      assert.equal(reset.readUInt32LE(8), 8);
      assert.equal(reset.readBigUInt64LE(32), 32768n);
      assert.equal(
        reset.readBigUInt64LE(24),
        BigInt(entries.get(`${STORAGE}Content`)!.length),
      );
      assert.equal(reset.readBigUInt64LE(40), 0n);
      assert.ok(reset.readUInt32LE(4) > 4);
      let previous = -1n;
      for (let offset = 40; offset < reset.length; offset += 8) {
        const cumulative = reset.readBigUInt64LE(offset);
        assert.ok(cumulative > previous);
        previous = cumulative;
      }
    } else {
      assert.equal(entries.has(`${STORAGE}Content`), false);
    }
    const fields = metadata(data);
    assert.equal(fields.get(3), '中文档案标题');
    assert.equal(fields.get(2), 'nested/topic.htm');
    assert.ok(entries.has(`/${fields.get(0)}`));
    assert.ok(entries.has(`/${fields.get(1)}`));
  });

  test(`pack -> independent parser -> extract preserves every byte (compression=${compression})`, () => {
    const files = fixture();
    const data = packFiles(files, { compression });
    const extracted = readArchiveForVerification(data);
    compareArchiveFiles(extracted, files);
    assert.ok(
      extracted
        .get('/Table of Contents.hhc')!
        .toString('utf8')
        .includes('nested/topic.htm'),
    );
    assert.ok(
      extracted
        .get('/Table of Contents.hhc')!
        .toString('utf8')
        .includes('&amp;'),
    );
  });

  (sevenZip ? test : test.skip)(
    `7zz list/extract and full byte comparison (compression=${compression})`,
    () => {
      const directory = tempDirectory();
      try {
        const files = fixture();
        const archive = packFiles(files, { compression, title: '7zz 中文' });
        const input = join(directory, 'archive.chm');
        const output = join(directory, 'extracted');
        writeFileSync(input, archive);
        const listing = execFileSync(sevenZip!, ['l', '-slt', input], {
          encoding: 'utf8',
          timeout: 20000,
        });
        assert.ok(listing.includes('Type = Chm'));
        execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
          timeout: 20000,
        });
        for (const [name, expected] of files) {
          const path = join(output, name);
          if (name.endsWith('/')) assert.ok(statSync(path).isDirectory());
          else assert.deepEqual(readFileSync(path), expected, name);
        }
        const { entries } = inspectDirectory(archive);
        assert.deepEqual(
          readFileSync(join(output, '#SYSTEM')),
          storedEntry(archive, entries.get('/#SYSTEM')!),
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
}

(sevenZip ? test : test.skip)(
  '7zz accepts multi-frame reset intervals, including a partial final reset group',
  () => {
    const directory = tempDirectory();
    try {
      const files = new Map([['bytes.bin', allBytes(131075)]]);
      const original = packFiles(files);
      // Compressed sizes and all following offsets may change with the reset interval.
      // 7-Zip's CHM container reader supports power-of-two reset intervals;
      // the raw LZX tests also cover the valid non-power-of-two 96 KiB case.
      for (const resetFrames of [2, 4]) {
        const archive = reencodeArchive(original, {
          resetInterval: resetFrames * 32768,
        });
        const input = join(directory, `reset-${resetFrames}.chm`);
        const output = join(directory, `reset-${resetFrames}`);
        writeFileSync(input, archive);
        execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
          timeout: 20000,
        });
        assert.deepEqual(
          readFileSync(join(output, 'bytes.bin')),
          files.get('bytes.bin'),
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

(sevenZip ? test : test.skip)(
  '7zz preserves empty and exact-frame-boundary streams',
  () => {
    const directory = tempDirectory();
    try {
      for (const size of [0, 32766, 32767, 32768, 32769, 65535, 65536]) {
        const files = new Map([
          ['file.bin', allBytes(size)],
          ['toc.hhc', Buffer.alloc(0)],
          ['index.hhk', Buffer.alloc(0)],
        ]);
        const data = packFiles(files);
        const { entries } = inspectDirectory(data);
        const reset = storedEntry(data, entries.get(RESET)!);
        const logicalSize = Number(reset.readBigUInt64LE(16));
        assert.ok(logicalSize >= size && logicalSize <= size + 2);
        assert.equal(reset.readUInt32LE(4), Math.ceil(logicalSize / 32768));
        const input = join(directory, `boundary-${size}.chm`);
        const output = join(directory, `boundary-${size}`);
        writeFileSync(input, data);
        execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
          timeout: 20000,
        });
        for (const [name, expected] of files)
          assert.deepEqual(readFileSync(join(output, name)), expected);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('empty input, empty files, and user-authored navigation are not lost or overwritten', () => {
  for (const compression of [false, true]) {
    assert.ok(
      inspectDirectory(packFiles(new Map(), { compression })).entries.has(
        '/#SYSTEM',
      ),
    );
    const files = new Map([
      ['custom.hhc', Buffer.from('original contents')],
      ['custom.hhk', Buffer.from('original index')],
      ['Table of Contents.hhc', Buffer.from('do not overwrite')],
      ['empty.txt', Buffer.alloc(0)],
    ]);
    const data = packFiles(files, { compression });
    const fields = metadata(data);
    assert.equal(fields.get(0), 'custom.hhc');
    assert.equal(fields.get(1), 'custom.hhk');
    compareArchiveFiles(readArchiveForVerification(data), files);
  }
});

test('paths longer than one default directory chunk retain their complete UTF-8 name', () => {
  const name = `${'目录/'.repeat(750)}file.bin`;
  const data = packFiles(new Map([[name, Buffer.from([0x80, 0xff])]]), {
    compression: false,
  });
  const inspected = inspectDirectory(data);
  assert.ok(inspected.chunkSize > 4096);
  assert.deepEqual(
    storedEntry(data, inspected.entries.get(`/${name}`)!),
    Buffer.from([0x80, 0xff]),
  );
});

test('ambiguous and reserved paths fail explicitly rather than silently dropping files', () => {
  for (const files of [
    new Map([
      ['a', Buffer.alloc(0)],
      ['/a', Buffer.alloc(0)],
    ]),
    new Map([
      ['A', Buffer.alloc(0)],
      ['a', Buffer.alloc(0)],
    ]),
    new Map([
      ['parent', Buffer.alloc(0)],
      ['parent/file', Buffer.alloc(0)],
    ]),
    new Map([
      ['parent/', Buffer.alloc(0)],
      ['parent', Buffer.alloc(0)],
    ]),
    new Map([['../escape', Buffer.alloc(0)]]),
    new Map([['#SYSTEM', Buffer.from('reserved')]]),
    new Map([['::DataSpace/NameList', Buffer.alloc(0)]]),
    new Map([['directory/', Buffer.from('invalid')]]),
  ])
    assert.throws(() => packFiles(files));
});

test('writer rejects non-portable/reserved names and canonically equivalent collisions', () => {
  for (const name of [
    'C:/a',
    'a:stream',
    'bad?.txt',
    'bad*.txt',
    'bad\u0001.txt',
    'trailing.',
    'trailing ',
    'CON.txt',
    'con .txt',
    'aux',
    'LPT1.bin',
    'com¹.txt',
    '#URLTBL',
    '$OBJINST',
    '//server/share',
  ])
    assert.throws(() => packFiles(new Map([[name, Buffer.alloc(0)]])), name);
  assert.throws(
    () =>
      packFiles(
        new Map([
          ['café.txt', Buffer.alloc(0)],
          ['cafe\u0301.txt', Buffer.alloc(0)],
        ]),
      ),
    /Duplicate/,
  );
  const files = new Map([
    ['index.html', Buffer.from('<h1 id="section">Topic</h1>')],
    ['space here.html', Buffer.alloc(0)],
  ]);
  for (const defaultTopic of [
    'missing.html',
    '../index.html',
    'https://example.com/index.html',
    '#section',
  ])
    assert.throws(() => packFiles(files, { defaultTopic }), defaultTopic);
  assert.ok(
    packFiles(files, { defaultTopic: 'index.html?query=yes#section' }).length >
      0,
  );
  assert.ok(
    packFiles(files, { defaultTopic: 'space%20here.html#section' }).length > 0,
  );
});

test('reusing CHMEncoder does not carry files across runs and preserves empty directories', async () => {
  const directory = tempDirectory();
  try {
    const first = join(directory, 'first');
    const second = join(directory, 'second');
    mkdirSync(join(first, '空目录'), { recursive: true });
    mkdirSync(second);
    writeFileSync(join(first, 'one.bin'), allBytes(32769));
    writeFileSync(join(second, 'two.bin'), Buffer.from([0xff, 0x80]));
    const encoder = new CHMEncoder();
    const firstOutput = join(first, 'packed.chm');
    await encoder.encode({
      inputDir: first,
      outputPath: firstOutput,
      compression: false,
    });
    await encoder.encode({
      inputDir: first,
      outputPath: firstOutput,
      compression: true,
    });
    const initial = readArchiveForVerification(readFileSync(firstOutput));
    assert.deepEqual(initial.get('/one.bin'), allBytes(32769));
    assert.ok(initial.has('/空目录/'));
    assert.equal(initial.has('/packed.chm'), false);
    const secondOutput = join(directory, 'second.chm');
    await encoder.encode({ inputDir: second, outputPath: secondOutput });
    const next = readArchiveForVerification(readFileSync(secondOutput));
    assert.deepEqual(next.get('/two.bin'), Buffer.from([0xff, 0x80]));
    assert.equal(next.has('/one.bin'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('validation rejects more than bad signatures and checks source bytes before write', async () => {
  const directory = tempDirectory();
  try {
    const files = new Map([['file.bin', allBytes(128)]]);
    const data = packFiles(files, { compression: false });
    const broken = Buffer.from(data);
    broken.writeBigUInt64LE(120n, 88);
    assert.throws(() => readArchiveForVerification(broken), /bounds/);
    await assert.rejects(
      CHMFileWriter.writeArchiveBuffer(
        join(directory, 'bad.chm'),
        data,
        {},
        new Map([['file.bin', Buffer.from('wrong')]]),
      ),
      /byte comparison/,
    );
    assert.equal(existsSync(join(directory, 'bad.chm')), false);
    const output = join(directory, 'changed.chm');
    await assert.rejects(
      CHMFileWriter.writeArchiveBuffer(output, data, {}, files, () => {
        const changed = Buffer.from(data);
        const entry = inspectDirectory(data).entries.get('/file.bin')!;
        changed[Number(data.readBigUInt64LE(88)) + entry.offset] ^= 0xff;
        writeFileSync(output, changed);
      }),
      /changed during disk write/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
