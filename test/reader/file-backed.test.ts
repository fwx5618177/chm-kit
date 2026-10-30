import { describe, test, vi } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  closeSync,
  fstatSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  rmSync,
  truncateSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { CHMReader } from '../../src/reader/chm-reader';
import { FileByteSource } from '../../src/reader/file-byte-source';
import { FileReconstructor } from '../../src/core/files/file-reconstructor';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { BitReader } from '../../src/utils/io/bit-reader';
import { packFiles } from '../../src/encoder/archive-builder';
import { reencodeArchive } from '../encoder/archive-fixtures';

test('readAhead switch: bounded window uses 7 reads/22 KiB versus 20 reads/20 KiB without speculation', async () => {
  const directory = mkdtempSync('test/reader/positioned-');
  const path = join(directory, 'read-ahead.chm');
  const packed = packFiles(new Map([['data.bin', randomBytes(131072)]]), {
    compression: false,
  });
  writeFileSync(path, packed);
  try {
    for (const readAhead of [true, false]) {
      const reader = await CHMReader.open(path, {
        maxCacheBytes: 32768,
        readAhead,
      });
      try {
        const before = reader.getIOStats()!;
        for (let offset = 0; offset < 20480; offset += 1024)
          reader.readRange('data.bin', offset, offset + 1024);
        const after = reader.getIOStats()!;
        assert.equal(after.readCalls - before.readCalls, readAhead ? 7 : 20);
        assert.equal(
          after.bytesRead - before.bytesRead,
          readAhead ? 22528 : 20480,
        );
        assert.equal(reader.getCacheStats().source.bytes, 4096);
        assert.equal(reader.getCacheStats().source.maxBytes, 4096);
        reader.clearCache();
        assert.equal(reader.getCacheStats().source.bytes, 0);
      } finally {
        reader.close();
      }
    }
    await assert.rejects(
      CHMReader.open(path, { readAhead: 'yes' as unknown as boolean }),
      /readAhead/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const compression of [false, true]) {
  for (const cached of ['file', 'range', 'stream'] as const) {
    test(`changed input cannot bypass ${cached} cache/decoder (compression=${compression})`, async () => {
      const directory = mkdtempSync('test/reader/positioned-');
      const path = join(directory, 'changed.chm');
      const payload = randomBytes(131072);
      writeFileSync(
        path,
        packFiles(new Map([['data.bin', payload]]), { compression }),
      );
      const reader = await CHMReader.open(path);
      let stream: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        if (cached === 'file') reader.readFile('data.bin');
        else if (cached === 'range') reader.readRange('data.bin', 0, 100);
        else {
          stream = reader.createReadStream('data.bin').getReader();
          await stream.read();
        }
        // A backwards mtime with unchanged size must invalidate just like truncation.
        if (cached === 'range') truncateSync(path, 100);
        else utimesSync(path, new Date(0), new Date(0));
        if (stream) await assert.rejects(stream.read(), /input changed/);
        else
          assert.throws(
            () => reader.readRange('data.bin', 0, 100),
            /input changed/,
          );
        assert.equal(reader.isOpen(), false);
        assert.equal(reader.getCacheStats().bytes, 0);
        assert.throws(() => reader.listFiles(), /closed/);
      } finally {
        await stream?.cancel().catch(() => undefined);
        reader.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

test('same-size rewrite with restored mtime invalidates the source via ctime, even on a window hit', async () => {
  const directory = mkdtempSync('test/reader/positioned-');
  const path = join(directory, 'restored-mtime.bin');
  writeFileSync(path, Buffer.alloc(8192, 1));
  utimesSync(path, new Date(0), new Date(0));
  const source = await FileByteSource.open(path);
  const fd = descriptor(source);
  const before = fstatSync(fd, { bigint: true });
  try {
    source.cache.setLimit(4096);
    const output = source.read(0, 100);
    const writer = openSync(path, 'r+');
    try {
      writeSync(writer, Buffer.from([2]), 0, 1, 0);
    } finally {
      closeSync(writer);
    }
    utimesSync(path, new Date(0), new Date(0));
    const after = fstatSync(fd, { bigint: true });
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeNs, before.mtimeNs);
    assert.throws(() => source.read(0, 100), /input changed/);
    assert.equal(source.cache.getStats().bytes, 0);
    assert.throws(() => fstatSync(fd), /EBADF/);
    assert.deepEqual(
      output,
      Buffer.alloc(100, 1),
      'previous caller-owned output is not recycled',
    );
  } finally {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('closed source with a filled I/O window cannot serve stale cached bytes', async () => {
  const directory = mkdtempSync('test/reader/positioned-');
  const path = join(directory, 'closed.bin');
  writeFileSync(path, Buffer.alloc(8192));
  const source = await FileByteSource.open(path);
  const fd = descriptor(source);
  try {
    source.cache.setLimit(4096);
    source.read(0, 100);
    assert.equal(source.cache.getStats().bytes, 4096);
    source.close();
    assert.throws(() => source.read(0, 100), /closed/);
    assert.equal(source.cache.getStats().bytes, 0);
    assert.throws(() => fstatSync(fd), /EBADF/);
  } finally {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('uncacheable reset groups read only necessary frames, not the entire reset stream', async () => {
  const directory = mkdtempSync('test/reader/positioned-');
  const path = join(directory, 'large-reset.chm');
  const payload = randomBytes(1024 * 1024);
  const packed = reencodeArchive(packFiles(new Map([['a.bin', payload]])), {
    resetInterval: 1024 * 1024,
  });
  const parsed = new CHMParser().parse(new BitReader(packed));
  writeFileSync(path, packed);
  const reader = await CHMReader.open(path, { maxCacheBytes: 0 });
  try {
    const before = reader.getIOStats()!;
    assert.deepEqual(reader.readRange('a.bin', 0, 1), payload.subarray(0, 1));
    const after = reader.getIOStats()!;
    assert.equal(after.readCalls - before.readCalls, 1);
    assert.equal(
      after.bytesRead - before.bytesRead,
      parsed.resetTable.entries[1].compressedLength,
    );
    assert.ok(after.bytesRead - before.bytesRead < packed.length / 16);
    assert.equal(reader.getCacheStats().bytes, 0);
  } finally {
    reader.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sparse input beyond 4 GiB uses safe positioned offsets without allocating the gap', async () => {
  const directory = mkdtempSync('test/reader/positioned-');
  const path = join(directory, 'sparse.chm');
  const payload = Buffer.from('large positioned offset');
  const packed = packFiles(new Map([['data.bin', payload]]), {
    compression: false,
  });
  const parsed = new CHMParser().parse(new BitReader(packed));
  const oldBase = parsed.header.itsf.unknown4;
  const base = 5 * 1024 * 1024 * 1024;
  const header = Buffer.from(packed.subarray(0, oldBase));
  header.writeBigUInt64LE(BigInt(base), 0x58);
  const fd = openSync(path, 'w');
  try {
    ftruncateSync(fd, base + packed.length - oldBase);
    writeSync(fd, header, 0, header.length, 0);
    writeSync(fd, packed, oldBase, packed.length - oldBase, base);
  } finally {
    closeSync(fd);
  }
  let reader: CHMReader | undefined;
  try {
    reader = await CHMReader.open(path, { cacheStrategy: 'none' });
    assert.ok(reader.getIOStats()!.bytesRead < 16384);
    assert.deepEqual(reader.readFile('data.bin'), payload);
    assert.ok(reader.getIOStats()!.size > 0x100000000);
    assert.ok(reader.getIOStats()!.bytesRead < 16384);
  } finally {
    reader?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function descriptor(source: FileByteSource): number {
  return (source as unknown as { fd: number }).fd;
}

for (const compression of [false, true]) {
  describe(`positioned CHMReader (compression=${compression})`, () => {
    const payload = randomBytes(512 * 1024 + 13);
    const packed = packFiles(
      new Map([
        ['large.bin', payload],
        ['empty', Buffer.alloc(0)],
        ['index.html', Buffer.from('<title>中文</title>')],
      ]),
      { compression, title: 'file-backed', defaultTopic: 'index.html' },
    );
    const parsed = new CHMParser().parse(new BitReader(packed));

    test('open/list read exactly structural metadata, ranges read only requested payload/reset groups', async () => {
      const directory = mkdtempSync('test/reader/positioned-');
      const path = join(directory, '中文.chm');
      writeFileSync(path, packed);
      let reader: CHMReader | undefined;
      try {
        reader = await CHMReader.open(path, { cacheStrategy: 'none' });
        const initial = reader.getIOStats()!;
        let expected =
          12 +
          parsed.header.itsf.headerLength +
          parsed.header.itsf.directoryLength;
        if (compression)
          for (const entry of parsed.directory.entries.values())
            if (/ControlData$|ResetTable$/.test(entry.name))
              expected += entry.length;
        assert.equal(initial.bytesRead, expected);
        assert.equal(initial.readCalls, compression ? 5 : 3);
        assert.ok(initial.bytesRead < packed.length / 8);
        assert.ok(reader.listFiles().includes('/large.bin'));
        assert.ok(reader.exists('LARGE.BIN'));
        reader.getFileInfo('large.bin');
        assert.deepEqual(
          reader.getIOStats(),
          initial,
          'directory queries perform no payload I/O',
        );
        assert.deepEqual(
          reader.readRange('large.bin', payload.length, payload.length),
          Buffer.alloc(0),
        );
        assert.deepEqual(reader.readFile('empty'), Buffer.alloc(0));
        assert.deepEqual(
          reader.getIOStats(),
          initial,
          'empty reads perform no I/O',
        );
        for (const [start, end] of [
          [0, 1],
          [32767, 32769],
          [65530, 65550],
          [payload.length - 1, payload.length],
        ]) {
          const before = reader.getIOStats()!;
          assert.deepEqual(
            reader.readRange('large.bin', start, end),
            payload.subarray(start, end),
          );
          const delta: number =
            reader.getIOStats()!.bytesRead - before.bytesRead;
          assert.ok(delta > 0);
          assert.ok(delta < 140000, `unexpected range I/O: ${delta}`);
          if (!compression) assert.equal(delta, end - start);
        }
        assert.throws(() => reader!.readRange('large.bin', -1, 0), RangeError);
        assert.throws(
          () => reader!.readRange('large.bin', 0, payload.length + 1),
          RangeError,
        );
        assert.equal(reader.getMetadata().title, 'file-backed');
        assert.deepEqual(reader.readFile('large.bin'), payload);
      } finally {
        reader?.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });

    test('streams stay lazy and backpressured, cancellation/close release suspended iterators immediately', async () => {
      const directory = mkdtempSync('test/reader/positioned-');
      const path = join(directory, 'stream.chm');
      writeFileSync(path, packed);
      const reader = await CHMReader.open(path, { maxCacheBytes: 0 });
      const original = FileReconstructor.prototype.iterateFileChunks;
      let released = 0;
      const spy = vi
        .spyOn(FileReconstructor.prototype, 'iterateFileChunks')
        .mockImplementation(function* (this: FileReconstructor, ...args) {
          try {
            yield* original.apply(this, args);
          } finally {
            released++;
          }
        });
      try {
        const before = reader.getIOStats()!;
        const stream = reader.createReadStream('large.bin').getReader();
        await Promise.resolve();
        assert.deepEqual(reader.getIOStats(), before);
        const first = (await stream.read()).value!;
        assert.deepEqual(Buffer.from(first), payload.subarray(0, 65536));
        const afterFirst = reader.getIOStats()!;
        assert.ok(afterFirst.bytesRead - before.bytesRead < 140000);
        await Promise.resolve();
        assert.deepEqual(
          reader.getIOStats(),
          afterFirst,
          'no demand means no more disk reads',
        );
        await stream.cancel();
        assert.equal(released, 1);
        assert.deepEqual(reader.getIOStats(), afterFirst);
        const ranged = reader
          .createReadStream('large.bin', 32767, 131073)
          .getReader();
        const chunks: Buffer[] = [];
        for (;;) {
          const next = await ranged.read();
          if (next.done) break;
          chunks.push(Buffer.from(next.value));
        }
        assert.deepEqual(
          Buffer.concat(chunks),
          payload.subarray(32767, 131073),
        );
        assert.equal(released, 2);
        const active = reader.createReadStream('large.bin').getReader();
        await active.read();
        reader.close();
        assert.equal(
          released,
          3,
          'close returns active generators before another pull',
        );
        await assert.rejects(active.read(), /closed/);
        assert.equal(reader.getCacheStats().bytes, 0);
        assert.equal(reader.isOpen(), false);
      } finally {
        spy.mockRestore();
        reader.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });

    test('file/source/reset caches share a hard budget and never lend reusable storage', async () => {
      const directory = mkdtempSync('test/reader/positioned-');
      const path = join(directory, 'cache.chm');
      writeFileSync(path, packed);
      const reader = await CHMReader.open(path, { maxCacheBytes: 256 * 1024 });
      try {
        const first = reader.readRange('large.bin', 0, 32);
        const after = reader.getIOStats()!;
        assert.deepEqual(reader.readRange('large.bin', 0, 32), first);
        assert.deepEqual(
          reader.getIOStats(),
          after,
          'source or reset-group hit avoids disk',
        );
        first.fill(0);
        assert.deepEqual(
          reader.readRange('large.bin', 0, 32),
          payload.subarray(0, 32),
        );
        for (let start = 65536; start + 32 < payload.length; start += 65536) {
          reader.readRange('large.bin', start, start + 32);
          const stats = reader.getCacheStats();
          assert.ok(stats.bytes <= stats.maxBytes);
          assert.equal(
            stats.bytes,
            stats.files.bytes + stats.blocks.bytes + stats.source.bytes,
          );
          assert.ok(
            stats.files.maxBytes +
              stats.blocks.maxBytes +
              stats.source.maxBytes <=
              stats.maxBytes,
          );
        }
        if (!compression)
          assert.equal(reader.getCacheStats().blocks.maxBytes, 0);
        reader.setCacheStrategy('none');
        assert.equal(reader.getCacheStats().bytes, 0);
        const before = reader.getIOStats()!;
        reader.readRange('large.bin', 0, 32);
        reader.readRange('large.bin', 0, 32);
        assert.ok(reader.getIOStats()!.readCalls >= before.readCalls + 2);
        assert.equal(reader.getCacheStats().bytes, 0);
      } finally {
        reader.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
}

test('adaptive source reads use bounded sequential read-ahead, reset on seeks, and keep outputs stable', async () => {
  const directory = mkdtempSync('test/reader/positioned-');
  const path = join(directory, 'source.bin');
  const input = randomBytes(32768);
  writeFileSync(path, input);
  const source = await FileByteSource.open(path);
  const fd = descriptor(source);
  try {
    source.cache.setLimit(4096);
    const outputs: Buffer[] = [];
    for (let offset = 100; offset < 120; offset++)
      outputs.push(source.read(offset, 1));
    assert.equal(source.getIOStats().readCalls, 3);
    assert.equal(source.getIOStats().bytesRead, 4098);
    assert.ok(source.cache.getStats().hits >= 17);
    assert.equal(source.cache.getStats().bytes, 4096);
    const before = source.getIOStats();
    for (const offset of [9000, 18000, 27000])
      assert.deepEqual(
        source.read(offset, 1),
        input.subarray(offset, offset + 1),
      );
    assert.equal(
      source.getIOStats().bytesRead - before.bytesRead,
      3,
      'seeks disable speculative reads',
    );
    assert.deepEqual(
      Buffer.concat(outputs),
      input.subarray(100, 120),
      'window reuse cannot alias old results',
    );
    assert.deepEqual(source.read(input.length, 0), Buffer.alloc(0));
    assert.throws(() => source.read(input.length, 1), /out of bounds/);
    assert.throws(
      () => source.read(Number.MAX_SAFE_INTEGER, 1),
      /unsafe range/,
    );
    assert.throws(() => source.read(0.5, 1), /unsafe range/);
    assert.throws(() => source.cache.setLimit(-1), RangeError);
    source.cache.clear();
    assert.equal(source.cache.getStats().bytes, 0);
    source.close();
    source.close();
    assert.throws(() => source.read(0, 0), /closed/);
    assert.throws(() => fstatSync(fd), /EBADF/);
  } finally {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed parsing/options closes the actual descriptor; disk truncation fails exactly', async () => {
  const directory = mkdtempSync('test/reader/positioned-');
  const path = join(directory, 'failure.chm');
  const packed = packFiles(new Map([['large.bin', randomBytes(131072)]]), {
    compression: false,
  });
  const opened: Array<{ source: FileByteSource; fd: number }> = [];
  const original = FileByteSource.open;
  const spy = vi
    .spyOn(FileByteSource, 'open')
    .mockImplementation(async path => {
      const source = await original(path);
      opened.push({ source, fd: descriptor(source) });
      return source;
    });
  try {
    writeFileSync(path, 'not a CHM');
    await assert.rejects(CHMReader.open(path));
    writeFileSync(path, packed);
    await assert.rejects(
      CHMReader.open(path, { maxCacheBytes: -1 }),
      /maxCacheBytes/,
    );
    for (const { source, fd } of opened) {
      assert.throws(() => source.read(0, 0), /closed/);
      assert.throws(() => fstatSync(fd), /EBADF/);
    }
    const reader = await CHMReader.open(path, { cacheStrategy: 'none' });
    try {
      const parsed = new CHMParser().parse(new BitReader(packed));
      const entry = parsed.directory.entries.get('/large.bin')!;
      truncateSync(
        path,
        parsed.header.itsf.unknown4 + entry.offset + entry.length - 1,
      );
      assert.throws(
        () => reader.readRange('large.bin', 131071, 131072),
        /input changed/,
      );
      assert.equal(reader.isOpen(), false);
      assert.equal(reader.getCacheStats().bytes, 0);
      assert.throws(() => reader.readFile('large.bin'), /closed/);
    } finally {
      reader.close();
    }
    assert.throws(() => fstatSync(opened[2].fd), /EBADF/);
  } finally {
    spy.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  }
});
