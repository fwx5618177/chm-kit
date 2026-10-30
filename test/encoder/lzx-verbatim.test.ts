import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { sevenZip } from '../support/sevenzip';
import type { LZXConfig } from '../../src/core/types';
import {
  LZXEncoder,
  LZX_FRAME_SIZE as FRAME,
} from '../../src/encoder/lzx-encoder';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { ResetTableProcessor } from '../../src/core/lzx/reset-table';
import { CHMHeaderBuilder } from '../../src/encoder/builders/header-builder';
import { packFiles } from '../../src/encoder/archive-builder';
import { BitReader } from '../../src/utils/io/bit-reader';
import {
  allBytes,
  deterministicRandom,
  inspectDirectory,
  reencodeArchive,
  storedEntry,
} from './archive-fixtures';

const STORAGE = '::DataSpace/Storage/MSCompressed/';
const RESET = `${STORAGE}Transform/{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}/InstanceData/ResetTable`;

function framesOf(result: {
  compressedData: Buffer;
  resetTable: Buffer;
}): Buffer[] {
  const table = new ResetTableProcessor().parseResetTable(
    new BitReader(result.resetTable),
  );
  return table.entries.map((entry, index) =>
    result.compressedData.subarray(
      entry.compressedLength,
      table.entries[index + 1]?.compressedLength ?? table.compressedLength,
    ),
  );
}

function blockType(frame: Buffer, reset = true): number {
  return (frame.readUInt16LE(0) >>> (reset ? 12 : 13)) & 7;
}

function roundTrip(input: Buffer, config: LZXConfig = {}) {
  const encoder = new LZXEncoder(config);
  const result = encoder.compress(input);
  const header = CHMHeaderBuilder.createLZXCHeader(encoder.getConfig());
  const frames = framesOf(result);
  const paddedSize = Math.ceil(input.length / FRAME) * FRAME;
  const decoded = new LZXDecoder(header).decodeFrames(frames, paddedSize);
  assert.deepEqual(decoded.subarray(0, input.length), input);
  assert.deepEqual(
    decoded.subarray(input.length),
    Buffer.alloc(paddedSize - input.length),
  );
  assert.deepEqual(
    new LZXDecoder(header).decode(
      new BitReader(result.compressedData),
      paddedSize,
    ),
    decoded,
  );
  assert.equal(result.resetTable.readBigUInt64LE(16), BigInt(input.length));
  assert.equal(
    result.resetTable.readBigUInt64LE(24),
    BigInt(result.compressedSize),
  );
  assert.deepEqual(
    encoder.compress(input),
    result,
    'encoder state must not leak between calls',
  );
  return { ...result, frames };
}

function mixedFrames(): Buffer {
  const pattern = Buffer.from('abcdefghijklmnopq');
  const repeated = Buffer.alloc(FRAME);
  for (let index = 0; index < repeated.length; index++)
    repeated[index] = pattern[index % pattern.length]!;
  return Buffer.concat([
    deterministicRandom(FRAME, 0x12345678),
    repeated,
    deterministicRandom(FRAME, 0x87654321),
    Buffer.from('XYZ'.repeat(Math.ceil(FRAME / 3))).subarray(0, FRAME),
  ]);
}

test('default level 6 performs real VERBATIM/LZ77/Huffman compression', () => {
  const input = Buffer.from(
    '<html><title>中文帮助</title><p>可靠的无损压缩 and repeated text.</p></html>\n'.repeat(
      4000,
    ),
  );
  const result = roundTrip(input);
  const stored = new LZXEncoder({ compressionLevel: 0 }).compress(input);
  assert.ok(
    result.compressedSize < input.length * 0.1,
    `${result.compressedSize}/${input.length}`,
  );
  assert.ok(result.compressedSize < stored.compressedSize * 0.1);
  for (const frame of result.frames)
    assert.ok([1, 2].includes(blockType(frame)));
});

test('all 256 byte values, E8 operands and odd tails round-trip without clearing high bits', () => {
  for (const length of [
    0, 1, 2, 255, 257, 32767, 32768, 32769, 65537, 131075,
  ]) {
    roundTrip(allBytes(length), { resetInterval: 3 * FRAME });
  }
  const intelLike = Buffer.from([
    0xe8, 0x80, 0xff, 0xff, 0xff, 0, 0xe8, 0, 0, 0, 0, 0xff,
  ]);
  const input = Buffer.concat(Array.from({ length: 10000 }, () => intelLike));
  const result = roundTrip(input, { resetInterval: 2 * FRAME });
  for (let index = 0; index < result.frames.length; index += 2) {
    assert.equal(
      result.frames[index]!.readUInt16LE(0) >>> 15,
      0,
      'Intel transform is disabled',
    );
  }
});

test('incompressible complete frames fall back to standard stored blocks', () => {
  const input = deterministicRandom(4 * FRAME);
  const result = roundTrip(input, { resetInterval: 4 * FRAME });
  assert.equal(result.compressedSize, input.length + 4 * 16);
  result.frames.forEach((frame, index) => {
    assert.equal(blockType(frame, index === 0), 3);
    assert.deepEqual(
      frame.subarray(16),
      input.subarray(index * FRAME, (index + 1) * FRAME),
    );
  });
});

test('random odd-sized final frames use stored fallback with correct raw padding', () => {
  for (const length of [32765, 32766, 32767]) {
    const input = deterministicRandom(length);
    const result = roundTrip(input);
    assert.equal(blockType(result.frames[0]!), 3);
    assert.deepEqual(result.frames[0]!.subarray(16, 16 + length), input);
    if (length & 1) assert.equal(result.frames[0]![16 + length], 0);
  }
});

test('mixed fallback keeps previous tree lengths and R0/R1/R2 across frames', () => {
  const input = mixedFrames();
  for (const resetFrames of [4, 8]) {
    const result = roundTrip(input, { resetInterval: resetFrames * FRAME });
    assert.deepEqual(
      result.frames.map((frame, index) => blockType(frame, index === 0)),
      [3, 2, 3, 1],
    );
    const stored = result.frames[2]!;
    assert.deepEqual(
      [stored.readUInt32LE(4), stored.readUInt32LE(8), stored.readUInt32LE(12)],
      [17, 17, 17],
    );
    const sizes = result.frames.map(frame => frame.length);
    assert.ok(
      new Set(sizes).size > 1,
      'ResetTable must address variable-sized frames',
    );
  }
});

test('stored fallback retains LZ77 history for the next compressed frame', () => {
  const random = deterministicRandom(FRAME);
  const input = Buffer.concat([random, random]);
  const result = roundTrip(input, {
    windowSize: 2 * FRAME,
    resetInterval: 2 * FRAME,
  });
  assert.deepEqual(
    result.frames.map((frame, index) => blockType(frame, index === 0)),
    [3, 2],
  );
  assert.ok(result.frames[1]!.length < FRAME * 0.1);
});

test('the last 32 KiB position slot encodes distance 32765 without overflow', () => {
  const random = deterministicRandom(FRAME, 0x1badb002);
  const input = Buffer.concat([
    random,
    random.subarray(3),
    Buffer.from([0x80, 0xff, 0xe8]),
  ]);
  const result = roundTrip(input, { resetInterval: 2 * FRAME });
  assert.equal(blockType(result.frames[0]!), 3);
  assert.equal(blockType(result.frames[1]!, false), 2);
  assert.ok(result.frames[1]!.length < FRAME * 0.1);
});

test('large position slots encode 17-bit distance suffixes for up to 2 MiB windows', () => {
  for (const windowSize of [0x40000, 0x100000, 0x200000]) {
    const history = deterministicRandom(windowSize / 2, 0x89abcdef);
    const input = Buffer.concat([history, history.subarray(0, FRAME)]);
    const result = roundTrip(input, { windowSize, resetInterval: windowSize });
    const last = result.frames[result.frames.length - 1]!;
    assert.equal(blockType(last, false), 2);
    assert.ok(last.length < FRAME * 0.1);
  }
});

test('complete fixed trees work for every public window size and search level', () => {
  const input = Buffer.concat([
    deterministicRandom(FRAME),
    allBytes(2 * FRAME + 257),
  ]);
  for (const windowSize of [
    0x8000, 0x10000, 0x20000, 0x40000, 0x80000, 0x100000, 0x200000,
  ]) {
    for (const compressionLevel of [1, 6, 9]) {
      roundTrip(input, {
        windowSize,
        compressionLevel,
        resetInterval: 3 * FRAME,
      });
    }
  }
  for (const compressionLevel of [-1, 10, 0.5, Number.NaN]) {
    assert.throws(
      () => new LZXEncoder({ compressionLevel }),
      /compressionLevel/,
    );
  }
});

test('deterministic mixed-content cases preserve bytes across reset boundaries', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const input = deterministicRandom(2 * FRAME + seed * 31, seed * 1234567);
    for (let start = seed * 7; start + 300 < input.length; start += 991) {
      input.copy(input, start + 32, start, start + 257);
    }
    roundTrip(input, {
      resetInterval: ((seed % 4) + 1) * FRAME,
      compressionLevel: (seed % 9) + 1,
    });
  }
});

(sevenZip ? test : test.skip)(
  '7zz independently restores VERBATIM, mixed stored fallback and non-default dictionaries',
  () => {
    mkdirSync('dist/test-tmp', { recursive: true });
    const directory = mkdtempSync('dist/test-tmp/verbatim-');
    try {
      const files = new Map([
        ['mixed.bin', mixedFrames()],
        [
          '中文/text.html',
          Buffer.from(
            '<title>真实压缩</title>中文 repeated text and HTML\n'.repeat(5000),
          ),
        ],
        ['all-bytes.bin', allBytes(131075)],
        ['random.bin', deterministicRandom(2 * FRAME, 0xfaceb00c)],
        ['empty.bin', Buffer.alloc(0)],
        ['空目录/', Buffer.alloc(0)],
      ]);
      const original = packFiles(files, { title: 'VERBATIM 中文' });
      const inputSize = [...files.values()].reduce(
        (sum, data) => sum + data.length,
        0,
      );
      assert.ok(
        original.length < inputSize / 2,
        'packFiles compression=true must really compress repetitive content',
      );
      const configurations: LZXConfig[] = [
        {},
        { compressionLevel: 0 },
        { resetInterval: 4 * FRAME },
        { resetInterval: 8 * FRAME, windowSize: 2 * FRAME },
        { resetInterval: 8 * FRAME, windowSize: 0x200000 },
      ];
      configurations.forEach((config, index) => {
        const archive =
          index === 0 ? original : reencodeArchive(original, config);
        const input = join(directory, `archive-${index}.chm`);
        const output = join(directory, `extracted-${index}`);
        writeFileSync(input, archive);
        const listing = execFileSync(sevenZip!, ['l', '-slt', input], {
          encoding: 'utf8',
          timeout: 20000,
        });
        assert.ok(listing.includes('Method = LZX:'));
        execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
          timeout: 20000,
        });
        for (const [name, expected] of files) {
          if (name.endsWith('/'))
            assert.ok(statSync(join(output, name)).isDirectory());
          else
            assert.deepEqual(
              readFileSync(join(output, name)),
              expected,
              `${index}: ${name}`,
            );
        }
        // Compare generated navigation and #SYSTEM too, not just original files.
        const { entries } = inspectDirectory(archive);
        const control = storedEntry(
          archive,
          entries.get(`${STORAGE}ControlData`)!,
        );
        const reset = storedEntry(archive, entries.get(RESET)!);
        const content = storedEntry(archive, entries.get(`${STORAGE}Content`)!);
        const frames = framesOf({ compressedData: content, resetTable: reset });
        const decoded = new LZXDecoder(
          CHMHeaderBuilder.createLZXCHeader({
            resetInterval: control.readUInt32LE(12) * FRAME,
            windowSize: control.readUInt32LE(16) * FRAME,
          }),
        ).decodeFrames(frames, frames.length * FRAME);
        for (const entry of entries.values()) {
          if (!entry.name.startsWith('/') || entry.name.endsWith('/')) continue;
          const expected =
            entry.section === 0
              ? storedEntry(archive, entry)
              : decoded.subarray(entry.offset, entry.offset + entry.length);
          assert.deepEqual(
            readFileSync(join(output, entry.name.slice(1))),
            expected,
            `${index}: ${entry.name}`,
          );
        }
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

(sevenZip ? test : test.skip)(
  '7zz restores large-distance matches and odd stored-frame tails',
  () => {
    mkdirSync('dist/test-tmp', { recursive: true });
    const directory = mkdtempSync('dist/test-tmp/verbatim-distance-');
    try {
      const history = deterministicRandom(0x100000, 0x89abcdef);
      const distant = Buffer.concat([history, history.subarray(0, FRAME)]);
      const inputs = [
        distant,
        deterministicRandom(32765),
        deterministicRandom(32766),
      ];
      inputs.forEach((bytes, index) => {
        const files = new Map([
          ['data.bin', bytes],
          ['toc.hhc', Buffer.alloc(0)],
          ['index.hhk', Buffer.alloc(0)],
        ]);
        const original = packFiles(files);
        const archive =
          index === 0
            ? reencodeArchive(original, {
                windowSize: 0x200000,
                resetInterval: 64 * FRAME,
              })
            : original;
        const input = join(directory, `archive-${index}.chm`);
        const output = join(directory, `extracted-${index}`);
        writeFileSync(input, archive);
        execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
          timeout: 20000,
        });
        for (const [name, expected] of files)
          assert.deepEqual(readFileSync(join(output, name)), expected);
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
