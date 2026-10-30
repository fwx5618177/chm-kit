import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { promises as fs, fstatSync, truncateSync } from 'fs';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { setTimeout as delay } from 'timers/promises';
import { packFiles } from '../../src/encoder/archive-builder';
import { ExtractorOperations } from '../../src/operations/extractor';
import { FileReconstructor } from '../../src/core/files/file-reconstructor';
import { FileByteSource } from '../../src/reader/file-byte-source';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { BitReader } from '../../src/utils/io/bit-reader';
import type { ExtractProgress } from '../../src/core/types';

let root: string;
let archive: string;
const payload = Buffer.alloc(19 * 1024 + 7, 0x71);

beforeEach(async () => {
  root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'chm-parallel-'));
  archive = join(root, 'input.chm');
  await fs.writeFile(
    archive,
    packFiles(
      new Map(['a', 'b', 'c', 'd', 'e'].map(name => [`${name}.bin`, payload])),
      { compression: false },
    ),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { force: true, recursive: true });
});

const filter = (name: string) => name.endsWith('.bin');

function trackInputs() {
  const opened: Array<{ source: FileByteSource; fd: number }> = [];
  const open = FileByteSource.open;
  vi.spyOn(FileByteSource, 'open').mockImplementation(async path => {
    const source = await open(path);
    opened.push({ source, fd: (source as unknown as { fd: number }).fd });
    return source;
  });
  return opened;
}

function expectInputsClosed(inputs: ReturnType<typeof trackInputs>) {
  expect(inputs).toHaveLength(1);
  for (const { source, fd } of inputs) {
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
    expect(() => source.read(0, 0)).toThrow(/closed/);
    expect(source.cache.getStats().bytes).toBe(0);
  }
}

for (const compression of [false, true]) {
  test(`filtered extraction reads only metadata/selected frames, with one input handle (compression=${compression})`, async () => {
    const selected = Buffer.from('selected input');
    const packed = packFiles(
      new Map([
        ['large.bin', randomBytes(1024 * 1024)],
        ['selected.bin', selected],
      ]),
      { compression },
    );
    await fs.writeFile(archive, packed);
    const inputs = trackInputs();
    const readFile = vi
      .spyOn(fs, 'readFile')
      .mockRejectedValue(new Error('whole-file read forbidden'));
    const output = join(root, 'filtered');
    const result = await ExtractorOperations.extract(archive, output, {
      filter: name => name === '/selected.bin',
      concurrency: 3,
      chunkSize: 1024,
    });
    expect(readFile).not.toHaveBeenCalled();
    readFile.mockRestore();
    expect(result.files).toEqual(['/selected.bin']);
    expect(result.errors).toEqual([]);
    expect(await fs.readFile(join(output, 'selected.bin'))).toEqual(selected);
    expect(inputs[0].source.getIOStats().bytesRead).toBeLessThan(128 * 1024);
    expectInputsClosed(inputs);
  });
}

test('sparse extraction reads data at a 5 GiB base without materializing the sparse gap', async () => {
  const packed = packFiles(
    new Map([['data.bin', Buffer.from('five GiB input offset')]]),
    { compression: false },
  );
  const parsed = new CHMParser().parse(new BitReader(packed));
  const oldBase = parsed.header.itsf.unknown4;
  const base = 5 * 1024 * 1024 * 1024;
  const header = Buffer.from(packed.subarray(0, oldBase));
  header.writeBigUInt64LE(BigInt(base), 0x58);
  const handle = await fs.open(archive, 'w');
  try {
    await handle.truncate(base + packed.length - oldBase);
    await handle.write(header, 0, header.length, 0);
    await handle.write(packed, oldBase, packed.length - oldBase, base);
  } finally {
    await handle.close();
  }
  const inputs = trackInputs();
  const output = join(root, 'sparse');
  const result = await ExtractorOperations.extract(archive, output, {
    filter: name => name === '/data.bin',
  });
  expect(result.files).toEqual(['/data.bin']);
  expect(result.errors).toEqual([]);
  expect(await fs.readFile(join(output, 'data.bin'), 'utf8')).toBe(
    'five GiB input offset',
  );
  expect(inputs[0].source.getIOStats().bytesRead).toBeLessThan(16384);
  expectInputsClosed(inputs);
});

test('input source closes on parse/filter errors and cancellation between opening and parsing', async () => {
  const inputs = trackInputs();
  await expect(
    ExtractorOperations.extract(archive, join(root, 'bad-filter'), {
      filter: () => {
        throw new Error('filter failed');
      },
    }),
  ).rejects.toThrow('filter failed');
  expectInputsClosed(inputs);
  vi.restoreAllMocks();
  await fs.writeFile(archive, 'invalid CHM');
  const invalid = trackInputs();
  await expect(
    ExtractorOperations.extract(archive, join(root, 'invalid')),
  ).rejects.toThrow();
  expectInputsClosed(invalid);
  vi.restoreAllMocks();
  const controller = new AbortController();
  const open = FileByteSource.open;
  let input: FileByteSource | undefined;
  let fd: number | undefined;
  vi.spyOn(FileByteSource, 'open').mockImplementation(async path => {
    input = await open(path);
    fd = (input as unknown as { fd: number }).fd;
    controller.abort();
    return input;
  });
  const result = await ExtractorOperations.extract(
    archive,
    join(root, 'abort-open'),
    { signal: controller.signal },
  );
  expect(result.cancelled).toBe(true);
  expect(input!.getIOStats().bytesRead).toBe(0);
  expect(() => fstatSync(fd!)).toThrow(/EBADF/);
});

test('input mutation after a progress callback is not hidden by cached input/decoder state', async () => {
  const inputs = trackInputs();
  const output = join(root, 'input-changed');
  let changed = false;
  const result = await ExtractorOperations.extract(archive, output, {
    concurrency: 2,
    chunkSize: 1024,
    filter,
    onProgress: update => {
      if (!changed && update.bytesWritten) {
        changed = true;
        truncateSync(archive, 0);
      }
    },
  });
  expect(result.files).toEqual([]);
  expect(result.errors.some(error => /input changed|closed/.test(error))).toBe(
    true,
  );
  expect(await fs.readdir(output)).toEqual([]);
  expectInputsClosed(inputs);
});

test('parallel I/O is real, bounded, chunked, and reported without whole-file reconstruction', async () => {
  const open = fs.open.bind(fs);
  let active = 0;
  let peak = 0;
  let handles = 0;
  let maxChunk = 0;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    handles++;
    const write = handle.writeFile.bind(handle);
    const close = handle.close.bind(handle);
    handle.writeFile = async (data, options) => {
      active++;
      peak = Math.max(peak, active);
      if (data instanceof Uint8Array)
        maxChunk = Math.max(maxChunk, data.length);
      try {
        await delay(3);
        await write(data, options);
      } finally {
        active--;
      }
    };
    handle.close = async () => {
      try {
        await close();
      } finally {
        handles--;
      }
    };
    return handle;
  });
  vi.spyOn(FileReconstructor.prototype, 'reconstructFile').mockImplementation(
    () => {
      throw new Error('must stream');
    },
  );
  const progress: Readonly<ExtractProgress>[] = [];
  const output = join(root, 'out');
  const result = await ExtractorOperations.extract(archive, output, {
    concurrency: 2,
    chunkSize: 1024,
    filter,
    onProgress: update => progress.push(update),
  });
  expect(peak).toBe(2);
  expect(maxChunk).toBeLessThanOrEqual(1024);
  expect(handles).toBe(0);
  expect(result.cancelled).toBe(false);
  expect(result.errors).toEqual([]);
  expect(result.files).toEqual([
    '/a.bin',
    '/b.bin',
    '/c.bin',
    '/d.bin',
    '/e.bin',
  ]);
  for (const file of result.files)
    expect(await fs.readFile(join(output, file.slice(1)))).toEqual(payload);
  expect(progress[0]).toMatchObject({
    completedFiles: 0,
    bytesWritten: 0,
    totalBytes: payload.length * 5,
  });
  expect(progress[progress.length - 1]).toMatchObject({
    completedFiles: 5,
    succeededFiles: 5,
    failedFiles: 0,
    bytesWritten: payload.length * 5,
  });
  for (let i = 1; i < progress.length; i++) {
    expect(progress[i]!.bytesWritten).toBeGreaterThanOrEqual(
      progress[i - 1]!.bytesWritten,
    );
    expect(progress[i]!.completedFiles).toBeGreaterThanOrEqual(
      progress[i - 1]!.completedFiles,
    );
    expect(progress[i]).not.toBe(progress[i - 1]);
  }
});

test('parallel compressed extraction preserves multi-frame/reset contents with small output chunks', async () => {
  const first = Buffer.from('first compressed stream '.repeat(7000));
  const second = Buffer.from('second compressed stream '.repeat(8000));
  await fs.writeFile(
    archive,
    packFiles(
      new Map([
        ['first.bin', first],
        ['second.bin', second],
      ]),
      { windowBits: 17, resetInterval: 65536 },
    ),
  );
  const output = join(root, 'compressed');
  const result = await ExtractorOperations.extract(archive, output, {
    concurrency: 2,
    chunkSize: 777,
    filter,
  });
  expect(result.errors).toEqual([]);
  expect(result.files).toEqual(['/first.bin', '/second.bin']);
  expect(await fs.readFile(join(output, 'first.bin'))).toEqual(first);
  expect(await fs.readFile(join(output, 'second.bin'))).toEqual(second);
});

test('compressed cancellation stops the stateful iterator at the current chunk and removes partial output', async () => {
  const inputs = trackInputs();
  await fs.writeFile(
    archive,
    packFiles(new Map([['data.bin', Buffer.alloc(100000, 42)]])),
  );
  const iterate = FileReconstructor.prototype.iterateFileChunks;
  let chunks = 0;
  vi.spyOn(FileReconstructor.prototype, 'iterateFileChunks').mockImplementation(
    function* (this: FileReconstructor, ...args) {
      for (const chunk of iterate.call(this, ...args)) {
        chunks++;
        yield chunk;
      }
    },
  );
  const controller = new AbortController();
  const output = join(root, 'compressed-cancel');
  const result = await ExtractorOperations.extract(archive, output, {
    filter,
    concurrency: 1,
    chunkSize: 1024,
    signal: controller.signal,
    onProgress: update => {
      if (update.bytesWritten) controller.abort();
    },
  });
  expect(result.cancelled).toBe(true);
  expect(chunks).toBe(1);
  expect(await fs.readdir(output)).toEqual([]);
  expectInputsClosed(inputs);
});

test('pre-aborted extraction performs no input/output work, even for nonexistent input', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  const output = join(root, 'not-created');
  const result = await ExtractorOperations.extract('missing.chm', output, {
    signal: controller.signal,
  });
  expect(result).toEqual({
    files: [],
    totalFiles: 0,
    errors: [],
    cancelled: true,
  });
  await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('mid-file cancellation removes unfinished files and does not schedule later work', async () => {
  const controller = new AbortController();
  const output = join(root, 'cancelled');
  const result = await ExtractorOperations.extract(archive, output, {
    concurrency: 2,
    chunkSize: 1024,
    filter,
    signal: controller.signal,
    onProgress: update => {
      if (update.bytesWritten >= 1024) controller.abort();
    },
  });
  expect(result.cancelled).toBe(true);
  expect(result.files).toEqual([]);
  expect(result.errors).toEqual([]);
  expect(await fs.readdir(output)).toEqual([]);
  await fs.rm(output, { recursive: true });
});

test('cancellation retains completed files and actual errors instead of treating abort as a file error', async () => {
  const output = join(root, 'partial');
  await fs.mkdir(output);
  await fs.writeFile(join(output, 'a.bin'), 'original');
  const controller = new AbortController();
  const result = await ExtractorOperations.extract(archive, output, {
    concurrency: 1,
    filter,
    signal: controller.signal,
    onProgress: update => {
      if (update.succeededFiles === 1) controller.abort();
    },
  });
  expect(result.cancelled).toBe(true);
  expect(result.files).toEqual(['/b.bin']);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain('拒绝覆盖');
  expect(await fs.readFile(join(output, 'a.bin'), 'utf8')).toBe('original');
  expect(await fs.readFile(join(output, 'b.bin'))).toEqual(payload);
  expect((await fs.readdir(output)).sort()).toEqual(['a.bin', 'b.bin']);
});

test('observer exceptions drain workers, close handles and clean incomplete output before rejection', async () => {
  const inputs = trackInputs();
  const output = join(root, 'observer');
  await expect(
    ExtractorOperations.extract(archive, output, {
      concurrency: 3,
      filter,
      chunkSize: 1024,
      onProgress: update => {
        if (update.bytesWritten) throw new Error('observer failed');
      },
    }),
  ).rejects.toThrow('observer failed');
  expect(await fs.readdir(output)).toEqual([]);
  expectInputsClosed(inputs);
});

test('a write failure remains per-file, cleans its partial output, and does not stop other workers', async () => {
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).endsWith('b.bin'))
      handle.writeFile = async () => {
        throw new Error('disk write failed');
      };
    return handle;
  });
  let last: Readonly<ExtractProgress> | undefined;
  const output = join(root, 'errors');
  const result = await ExtractorOperations.extract(archive, output, {
    concurrency: 3,
    filter,
    onProgress: p => {
      last = p;
    },
  });
  expect(result.files).toEqual(['/a.bin', '/c.bin', '/d.bin', '/e.bin']);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain('disk write failed');
  expect(result.cancelled).toBe(false);
  expect(last).toMatchObject({
    completedFiles: 5,
    succeededFiles: 4,
    failedFiles: 1,
  });
  await expect(fs.stat(join(output, 'b.bin'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

for (const name of ['concurrency', 'chunkSize'] as const) {
  test(`${name} rejects zero, negatives, fractions and unsafe sizes before touching disk`, async () => {
    for (const value of [
      0,
      -1,
      0.1,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(
        ExtractorOperations.extract('missing', join(root, 'bad'), {
          [name]: value,
        }),
      ).rejects.toThrow(name);
    }
    await expect(fs.stat(join(root, 'bad'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
}
