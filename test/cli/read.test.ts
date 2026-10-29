import { test, describe, beforeEach, afterEach } from 'vitest';
import { strict as assert } from 'node:assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readArchive } from '../../src/cli/commands/read';
import { CHMReader } from '../../src/reader/chm-reader';
import { packFiles } from '../../src/encoder/archive-builder';

describe('CLI Reader integration', () => {
  const originalOpen = CHMReader.open;
  const data = Buffer.alloc(300023);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const packed = packFiles(new Map([['large.bin', data]]));
  let root: string;
  let reader: CHMReader;

  beforeEach(async () => {
    root = await fs.mkdtemp(
      join(await fs.realpath(tmpdir()), 'chm-cli-reader-'),
    );
    reader = new CHMReader(packed, { maxFileSize: 64 * 1024 });
    CHMReader.open = async () => reader;
  });

  afterEach(async () => {
    CHMReader.open = originalOpen;
    reader.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  function forbidFullReads(): void {
    reader.readFile = () => {
      throw new Error('Unexpected full-file read');
    };
  }

  function trackRanges(): [number, number | undefined][] {
    const calls: [number, number | undefined][] = [];
    const original = reader.readRange.bind(reader);
    reader.readRange = (path, start = 0, end) => {
      calls.push([start, end]);
      return original(path, start, end);
    };
    return calls;
  }

  function trackStreams() {
    const requests: [number, number | undefined][] = [];
    const chunks: number[] = [];
    const create = reader.createReadStream.bind(reader);
    reader.createReadStream = (path, start = 0, end) => {
      requests.push([start, end]);
      const source = create(path, start, end).getReader();
      return new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            const next = await source.read();
            if (next.done) controller.close();
            else {
              chunks.push(next.value.length);
              controller.enqueue(next.value);
            }
          },
          cancel(reason) {
            return source.cancel(reason);
          },
        },
        { highWaterMark: 0 },
      );
    };
    return { requests, chunks };
  }

  test('--range calls readRange directly, even when full file exceeds Reader limits', async () => {
    forbidFullReads();
    const calls = trackRanges();
    const output = join(root, 'range.bin');
    await readArchive('input.chm', 'large.bin', {
      range: '104853:104889',
      format: 'raw',
      output,
    });
    assert.deepEqual(calls, [[104853, 104889]]);
    assert.deepEqual(await fs.readFile(output), data.subarray(104853, 104889));
    assert.equal(reader.isOpen(), false);
  });

  test('--stream consumes Reader WHATWG streams in bounded chunks and closes Reader', async () => {
    forbidFullReads();
    const calls = trackRanges();
    const { requests, chunks } = trackStreams();
    const output = join(root, 'stream.bin');
    await readArchive('input.chm', 'large.bin', { stream: true, output });
    assert.deepEqual(requests, [[0, undefined]]);
    assert.deepEqual(await fs.readFile(output), data);
    assert.deepEqual(
      calls,
      [],
      'streams reuse decoding state rather than repeated ranges',
    );
    assert.deepEqual(chunks, [
      65536,
      65536,
      65536,
      65536,
      data.length - 262144,
    ]);
    assert.equal(reader.isOpen(), false);
  });

  test('--stream --range requests only the selected range through one stateful stream', async () => {
    forbidFullReads();
    const calls = trackRanges();
    const { requests, chunks } = trackStreams();
    const output = join(root, 'range-stream.bin');
    await readArchive('input.chm', 'large.bin', {
      stream: true,
      range: '101000:251013',
      output,
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(requests, [[101000, 251013]]);
    assert.deepEqual(chunks, [65536, 65536, 18941]);
    assert.deepEqual(await fs.readFile(output), data.subarray(101000, 251013));
    assert.equal(reader.isOpen(), false);
  });

  for (const field of ['toc', 'index'] as const) {
    test(`--${field} --format json uses structured Reader navigation`, async () => {
      forbidFullReads();
      reader.getMetadata = () => {
        throw new Error('Unexpected CLI navigation-source lookup');
      };
      const expected = [
        {
          name: 'Root',
          local: '/large.bin',
          level: 0,
          children: [{ name: 'Child', local: '/large.bin#child', level: 1 }],
        },
      ];
      reader[field === 'toc' ? 'getTOC' : 'getIndex'] = () => expected;
      const output = join(root, 'navigation.json');
      await readArchive('input.chm', undefined, {
        [field]: true,
        format: 'json',
        output,
      });
      assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), expected);
      assert.equal(reader.isOpen(), false);
    });
  }

  test('range decoding errors still close Reader', async () => {
    reader.readRange = () => {
      throw new Error('range decode failed');
    };
    await assert.rejects(
      readArchive('input.chm', 'large.bin', {
        range: '0:10',
        output: join(root, 'error.bin'),
      }),
      /range decode failed/,
    );
    assert.equal(reader.isOpen(), false);
  });

  test('WHATWG source errors propagate through pipeline, close output and Reader', async () => {
    reader.createReadStream = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('stream decode failed'));
        },
      });
    const output = join(root, 'source-error.bin');
    await assert.rejects(
      readArchive('input.chm', 'large.bin', { stream: true, output }),
      /stream decode failed/,
    );
    assert.equal(reader.isOpen(), false);
    await fs.rm(output, { force: true });
  });

  test('destination errors cancel the WHATWG stream and close Reader', async () => {
    let cancelled = false;
    reader.createReadStream = () =>
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            controller.enqueue(new Uint8Array(64 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
    await assert.rejects(
      readArchive('input.chm', 'large.bin', { stream: true, output: root }),
      /EISDIR/,
    );
    assert.equal(cancelled, true);
    assert.equal(reader.isOpen(), false);
  });

  test('invalid ranges do not truncate existing output and still close Reader', async () => {
    const output = join(root, 'protected.bin');
    await fs.writeFile(output, 'original');
    await assert.rejects(
      readArchive('input.chm', 'large.bin', {
        stream: true,
        range: '300020:300030',
        output,
      }),
      /range/,
    );
    assert.equal(await fs.readFile(output, 'utf8'), 'original');
    assert.equal(reader.isOpen(), false);
  });
});
