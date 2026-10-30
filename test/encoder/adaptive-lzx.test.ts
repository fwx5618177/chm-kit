import { test, vi } from 'vitest';
import { strict as assert } from 'node:assert';
import { CanonicalHuffman } from '../../src/encoder/canonical-huffman';
import {
  LZXEncoder,
  LZX_FRAME_SIZE as FRAME,
  type LZXEncoderOptions,
} from '../../src/encoder/lzx-encoder';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { CHMHeaderBuilder } from '../../src/encoder/builders/header-builder';
import { BitReader } from '../../src/utils/io/bit-reader';
import { deterministicRandom } from './archive-fixtures';

function check(input: Buffer, config: LZXEncoderOptions = {}) {
  const encoder = new LZXEncoder(config);
  const result = encoder.compress(input);
  const size = Math.ceil(input.length / FRAME) * FRAME;
  const output = new LZXDecoder(
    CHMHeaderBuilder.createLZXCHeader(encoder.getConfig()),
  ).decode(new BitReader(result.compressedData), size);
  assert.deepEqual(output.subarray(0, input.length), input);
  assert.deepEqual(
    output.subarray(input.length),
    Buffer.alloc(size - input.length),
  );
  assert.deepEqual(encoder.compress(input), result);
  return result;
}

function minimumCost(weights: number[], limit: number): number {
  let best = Infinity;
  const visit = (symbol: number, capacity: number, cost: number): void => {
    if (symbol === weights.length) {
      if (capacity === 0) best = Math.min(best, cost);
      return;
    }
    for (let bits = 1; bits <= limit; bits++) {
      const units = 2 ** (limit - bits);
      if (units <= capacity)
        visit(symbol + 1, capacity - units, cost + weights[symbol]! * bits);
    }
  };
  visit(0, 2 ** limit, 0);
  return best;
}

test('package-merge is complete, deterministic and optimal against exhaustive small-tree enumeration', () => {
  for (const limit of [2, 3, 4]) {
    for (let count = 2; count <= Math.min(6, 2 ** limit); count++) {
      for (let seed = 1; seed <= 8; seed++) {
        const weights = Array.from(
          { length: count },
          (_, index) => 1 + ((seed * (index + 3) ** 2) % 17),
        );
        const tree = CanonicalHuffman.fromFrequencies(weights, limit);
        assert.ok(Math.max(...tree.lengths) <= limit);
        assert.equal(
          [...tree.lengths].reduce((sum, length) => sum + 2 ** -length, 0),
          1,
        );
        assert.equal(
          [...tree.lengths].reduce(
            (sum, length, index) => sum + length * weights[index]!,
            0,
          ),
          minimumCost(weights, limit),
        );
        assert.deepEqual(
          CanonicalHuffman.fromFrequencies(weights, limit),
          tree,
        );
      }
    }
  }
});

test('16-bit limit holds for pathological skew and sparse/single/unused alphabets remain decodable', () => {
  const fibonacci = [1, 1];
  while (fibonacci.length < 40)
    fibonacci.push(
      fibonacci[fibonacci.length - 1]! + fibonacci[fibonacci.length - 2]!,
    );
  const tree = CanonicalHuffman.fromFrequencies(fibonacci);
  assert.equal(Math.max(...tree.lengths), 16);
  assert.equal(
    [...tree.lengths].reduce((sum, length) => sum + 2 ** -length, 0),
    1,
  );
  const words = [...tree.lengths].map((bits, symbol) =>
    tree.codes[symbol]!.toString(2).padStart(bits, '0'),
  );
  for (let left = 0; left < words.length; left++)
    for (let right = 0; right < words.length; right++) {
      if (left !== right)
        assert.equal(words[left]!.startsWith(words[right]!), false);
    }
  for (const frequencies of [new Array<number>(249).fill(0), [0, 0, 1000, 0]]) {
    const sparse = CanonicalHuffman.fromFrequencies(frequencies);
    assert.equal([...sparse.lengths].filter(Boolean).length, 2);
    assert.equal(
      [...sparse.lengths]
        .filter(Boolean)
        .reduce((sum, bits) => sum + 2 ** -bits, 0),
      1,
    );
  }
  assert.throws(
    () => CanonicalHuffman.fromFrequencies([1, 1, 1], 1),
    /Too many/,
  );
  assert.throws(() => CanonicalHuffman.fromFrequencies([1, -1]), /frequency/);
});

test('canonical boundaries reject inexact counts, own code lengths and support the full 16-bit alphabet', () => {
  for (const weights of [
    [0.5, 1],
    [Infinity, 1],
    [NaN, 1],
    [Number.MAX_SAFE_INTEGER, 1],
  ])
    assert.throws(() => CanonicalHuffman.fromFrequencies(weights), /frequency/);
  for (const count of [0, 1, 2.5, 65537, Infinity])
    assert.throws(() => CanonicalHuffman.fixed(count), /alphabet/);
  const original = Uint8Array.of(1, 1);
  const tree = new CanonicalHuffman(original);
  original.fill(16);
  assert.deepEqual(tree.lengths, Uint8Array.of(1, 1));
  const full = CanonicalHuffman.fixed(65536);
  assert.equal(full.lengths[65535], 16);
  assert.equal(full.codes[65535], 65535);
});

test('inner-block ALIGNED savings accumulate before the single frame word padding', () => {
  const pattern = deterministicRandom(32, 123);
  const bytes = Buffer.from(
    Array.from(
      { length: FRAME },
      (_, index) => pattern[index % pattern.length]!,
    ),
  );
  const aligned = check(bytes, { blockSize: 4096, compressionLevel: 4 });
  const verbatim = check(bytes, { blockSize: 4096, compressionLevel: 3 });
  // Per-block word rounding produced 510 bytes; carrying the inner block bits
  // yields 504. Keep a bound, so future valid improvements remain possible.
  assert.ok(aligned.compressedSize <= 504);
  assert.ok(aligned.compressedSize < verbatim.compressedSize);
});

test('long resets use virtual final zero fill, without allocating a padded input/reset-sized work buffer', () => {
  const input = deterministicRandom(8 * FRAME + 17);
  const encoderConfig = { resetInterval: 0x10000000, windowSize: FRAME };
  for (const compressionLevel of [0, 6]) {
    const allocations = vi.spyOn(Buffer, 'alloc');
    let result: ReturnType<LZXEncoder['compress']>;
    try {
      result = new LZXEncoder({ ...encoderConfig, compressionLevel }).compress(
        input,
      );
      assert.ok(allocations.mock.calls.length > 0);
      assert.ok(
        Math.max(...allocations.mock.calls.map(([size]) => size)) <= FRAME + 32,
      );
    } finally {
      allocations.mockRestore();
    }
    assert.deepEqual(
      new LZXDecoder(CHMHeaderBuilder.createLZXCHeader(encoderConfig)).decode(
        new BitReader(result!.compressedData),
        input.length,
      ),
      input,
    );
  }
});

test('levels change actual encoding: stored -> fixed VERBATIM -> adaptive VERBATIM -> ALIGNED', () => {
  const input = Buffer.from('a'.repeat(FRAME));
  const stored = check(input, { compressionLevel: 0 });
  const fixed = check(input, { compressionLevel: 1 });
  const adaptive = check(input, { compressionLevel: 2 });
  assert.equal((stored.compressedData.readUInt16LE(0) >>> 12) & 7, 3);
  assert.equal((fixed.compressedData.readUInt16LE(0) >>> 12) & 7, 1);
  assert.equal((adaptive.compressedData.readUInt16LE(0) >>> 12) & 7, 1);
  assert.ok(adaptive.compressedSize < fixed.compressedSize / 3);
  assert.ok(fixed.compressedSize < stored.compressedSize / 10);

  const pattern = deterministicRandom(64, 0x98765432);
  const alignedInput = Buffer.concat(
    Array.from({ length: FRAME / 64 }, () => pattern),
  );
  const verbatim = check(alignedInput, { compressionLevel: 3 });
  const aligned = check(alignedInput, { compressionLevel: 4 });
  assert.equal((verbatim.compressedData.readUInt16LE(0) >>> 12) & 7, 1);
  assert.equal((aligned.compressedData.readUInt16LE(0) >>> 12) & 7, 2);
  assert.ok(aligned.compressedSize < verbatim.compressedSize);
  // ALIGNED must pay for its 24-bit tree; distance 1 does not benefit.
  const shortDistance = check(input, { compressionLevel: 4 });
  assert.equal((shortDistance.compressedData.readUInt16LE(0) >>> 12) & 7, 1);
  for (const compressionLevel of [0, 1, 2, 3, 4, 9]) {
    const random = check(deterministicRandom(FRAME), { compressionLevel });
    assert.equal((random.compressedData.readUInt16LE(0) >>> 12) & 7, 3);
    assert.equal(random.compressedSize, FRAME + 16);
  }
});

test('higher levels actually search deeper hash chains, not merely change advertised level', () => {
  const target = deterministicRandom(257, 0xabcdef01);
  // The full match lies behind 48 shorter matches sharing a 128-byte prefix.
  const decoys = Array.from({ length: 48 }, (_, index) =>
    Buffer.concat([
      target.subarray(0, 128),
      deterministicRandom(129, index + 1),
    ]),
  );
  const input = Buffer.concat([target, ...decoys, target]);
  const fast = check(input, { compressionLevel: 4 });
  const deep = check(input, { compressionLevel: 9 });
  assert.ok(
    deep.compressedSize < fast.compressedSize,
    `${deep.compressedSize} vs ${fast.compressedSize}`,
  );
});

test('empty and odd partial sub-blocks never emit zero-length blocks or lose final padding', () => {
  for (const length of [
    0, 1, 2, 255, 256, 257, 511, 512, 513, 32767, 32768, 32769,
  ]) {
    for (const compressionLevel of [0, 2, 9]) {
      check(deterministicRandom(length), {
        blockSize: 256,
        compressionLevel,
        resetInterval: 2 * FRAME,
      });
    }
  }
  assert.equal(new LZXEncoder({ blockSize: 512 }).getConfig().blockSize, 512);
});

test('sub-frame blocks preserve bit alignment, tree deltas, raw padding, history and reset state', () => {
  const chunks = Array.from({ length: 193 }, (_, index) =>
    index % 3 === 0
      ? deterministicRandom(512, index + 1)
      : Buffer.from('repeated text 0123456789 abcdefgh '.repeat(16)),
  );
  const input = Buffer.concat(chunks).subarray(0, 2 * FRAME + 511);
  for (const blockSize of [256, 512, 1024, 4096, FRAME]) {
    for (const compressionLevel of [0, 1, 2, 4, 9]) {
      check(input, {
        blockSize,
        compressionLevel,
        resetInterval: 2 * FRAME,
        windowSize: 2 * FRAME,
      });
    }
  }
  for (const blockSize of [0, 255, 257, 65536, NaN])
    assert.throws(() => new LZXEncoder({ blockSize }), /blockSize/);
});
