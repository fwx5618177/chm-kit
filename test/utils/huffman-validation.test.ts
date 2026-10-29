import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { Huffman } from '../../src/utils/compression/huffman';
import { HuffmanTreeOperations } from '../../src/utils/compression/huffman-tree';
import { LZXHuffmanDecoder } from '../../src/utils/compression/lzx-huffman-decoder';
import { BitReader } from '../../src/utils/io/bit-reader';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { LZXEncoder } from '../../src/encoder/lzx-encoder';
import type { HuffmanDecoder, HuffmanTree } from '../../src/core/types';

test('canonical trees retain symbol ordering and allow unused/incomplete code space', () => {
  const tree = Huffman.createCanonicalTree([0, 2, 0, 2]);
  assert.deepEqual(tree, {
    symbols: [1, 3],
    codes: [0, 1],
    lengths: [2, 2],
  });
  assert.equal(Huffman.validateTree(tree), true);
  const reader = new BitReader(Buffer.from([0b00010000]));
  assert.equal(Huffman.decodeSymbol(reader, tree), 1);
  assert.equal(Huffman.decodeSymbol(reader, tree), 3);
});

test('empty canonical tables remain representable but cannot decode input', () => {
  for (const lengths of [[], [0, 0]]) {
    const tree = Huffman.createCanonicalTree(lengths);
    assert.deepEqual(tree, { symbols: [], codes: [], lengths: [] });
    assert.equal(Huffman.validateTree(tree), true);
    const reader = new BitReader(Buffer.from([0]));
    assert.throws(
      () => Huffman.decodeSymbol(reader, tree),
      /empty Huffman tree/,
    );
    assert.deepEqual(reader.getPosition(), { byte: 0, bit: 0 });
  }
  assert.equal(
    Huffman.validateTree(HuffmanTreeOperations.createEmptyTree(2)),
    false,
    'zero-length placeholders are not assigned codes',
  );
});

test.each([-1, 1.5, NaN, Infinity, -Infinity, 33])(
  'canonical construction rejects invalid code length %s',
  length => {
    assert.throws(
      () => Huffman.createCanonicalTree([1, length]),
      /Invalid Huffman code length/,
    );
  },
);

test('canonical construction rejects sparse lengths rather than silently skipping them', () => {
  assert.throws(
    () => Huffman.createCanonicalTree(new Array<number>(2)),
    /Invalid Huffman code length/,
  );
});

test.each([
  { lengths: [1, 1, 1] },
  { lengths: [1, 2, 2, 2] },
  { lengths: [2, 2, 2, 2, 2] },
])(
  'canonical construction rejects oversubscribed lengths $lengths',
  ({ lengths }) => {
    assert.throws(
      () => Huffman.createCanonicalTree(lengths),
      /Oversubscribed Huffman tree/,
    );
    assert.throws(
      () => HuffmanTreeOperations.buildTreeFromLengths(lengths, false),
      /Oversubscribed Huffman tree/,
      'the optional post-build check cannot bypass construction invariants',
    );
  },
);

test('32-bit canonical codes and decoding do not overflow signed bitwise arithmetic', () => {
  const lengths = [
    ...Array.from({ length: 31 }, (_, index) => index + 1),
    32,
    32,
  ];
  const tree = Huffman.createCanonicalTree(lengths);
  assert.deepEqual(tree.codes.slice(-2), [0xfffffffe, 0xffffffff]);
  assert.equal(Huffman.validateTree(tree), true);
  for (const [lastByte, symbol] of [
    [0xfe, 31],
    [0xff, 32],
  ]) {
    const reader = new BitReader(Buffer.from([0xff, 0xff, 0xff, lastByte]));
    assert.equal(Huffman.decodeSymbol(reader, tree, 32), symbol);
    assert.deepEqual(reader.getPosition(), { byte: 4, bit: 0 });
  }
});

test.each([0, -1, 1.5, NaN, Infinity, 33])(
  'symbol decoding rejects invalid maximum code length %s before reading',
  maximum => {
    const reader = new BitReader(Buffer.from([0]));
    assert.throws(
      () =>
        Huffman.decodeSymbol(
          reader,
          Huffman.createCanonicalTree([1, 1]),
          maximum,
        ),
      /Invalid Huffman maximum code length/,
    );
    assert.deepEqual(reader.getPosition(), { byte: 0, bit: 0 });
  },
);

test('tree validation rejects invalid active lengths, symbols and code values', () => {
  for (const length of [0, -1, 1.5, NaN, Infinity, 33]) {
    assert.equal(
      Huffman.validateTree({ symbols: [0], codes: [0], lengths: [length] }),
      false,
      `length ${length}`,
    );
  }
  for (const code of [-1, 0.5, NaN, Infinity, 2]) {
    assert.equal(
      Huffman.validateTree({ symbols: [0], codes: [code], lengths: [1] }),
      false,
      `code ${code}`,
    );
  }
  assert.equal(
    Huffman.validateTree({ symbols: [0], codes: [2 ** 32], lengths: [32] }),
    false,
  );
  for (const symbol of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(
      Huffman.validateTree({ symbols: [symbol], codes: [0], lengths: [1] }),
      false,
      `symbol ${symbol}`,
    );
  }
  assert.equal(
    Huffman.validateTree({ symbols: [0, 0], codes: [0, 1], lengths: [1, 1] }),
    false,
  );
});

test('tree validation detects prefix conflicts and duplicate codes in either ordering', () => {
  const conflicts: HuffmanTree[] = [
    { symbols: [0, 1], codes: [0, 0], lengths: [1, 2] },
    { symbols: [0, 1], codes: [0, 0], lengths: [2, 1] },
    { symbols: [0, 1], codes: [1, 2], lengths: [1, 2] },
    { symbols: [0, 1], codes: [3, 1], lengths: [2, 1] },
    { symbols: [0, 1], codes: [1, 1], lengths: [2, 2] },
    { symbols: [0, 1, 2], codes: [0, 1, 2], lengths: [1, 1, 1] },
  ];
  for (const tree of conflicts) {
    assert.equal(Huffman.validateTree(tree), false, JSON.stringify(tree));
    const reader = new BitReader(Buffer.from([0xff]));
    assert.throws(
      () => Huffman.decodeSymbol(reader, tree),
      /Invalid.*Huffman tree/,
    );
    assert.deepEqual(reader.getPosition(), { byte: 0, bit: 0 });
  }
  // 01 and 1 are distinct prefixes even though both numeric code values are 1.
  const valid = { symbols: [3, 7], codes: [1, 1], lengths: [2, 1] };
  assert.equal(Huffman.validateTree(valid), true);
  const reader = new BitReader(Buffer.from([0b01100000]));
  assert.equal(Huffman.decodeSymbol(reader, valid), 3);
  assert.equal(Huffman.decodeSymbol(reader, valid), 7);
});

test('tree validation rejects malformed arrays and accepts adjacent unsigned 32-bit codes', () => {
  for (const tree of [
    null,
    {},
    { symbols: [0], codes: [], lengths: [1] },
    { symbols: [0], codes: [0], lengths: [] },
    { symbols: [0], codes: [0], lengths: '1' },
  ]) {
    assert.equal(Huffman.validateTree(tree as HuffmanTree), false);
  }
  assert.equal(
    Huffman.validateTree({
      symbols: [0, 1],
      codes: [0xffffffff, 0xfffffffe],
      lengths: [32, 32],
    }),
    true,
  );
});

const legacyCalls: Array<
  [string, (reader: BitReader, decoder: HuffmanDecoder) => unknown]
> = [
  ['createLZXDecoder', () => LZXHuffmanDecoder.createLZXDecoder(32768)],
  [
    'readLZXCodeLengths',
    reader => LZXHuffmanDecoder.readLZXCodeLengths(reader, 2),
  ],
  [
    'buildLZXPredefinedTree',
    () => LZXHuffmanDecoder.buildLZXPredefinedTree('length', 32768),
  ],
  [
    'decodeLZXSymbol',
    (reader, decoder) =>
      LZXHuffmanDecoder.decodeLZXSymbol(reader, decoder.literalTree),
  ],
  [
    'updateLZXTree',
    (_reader, decoder) =>
      LZXHuffmanDecoder.updateLZXTree(decoder, 'literal', [1, 1]),
  ],
  [
    'validateLZXDecoder',
    (_reader, decoder) => LZXHuffmanDecoder.validateLZXDecoder(decoder),
  ],
  [
    'getLZXDecoderStats',
    (_reader, decoder) => LZXHuffmanDecoder.getLZXDecoderStats(decoder),
  ],
  [
    'resetLZXDecoder',
    (_reader, decoder) => LZXHuffmanDecoder.resetLZXDecoder(decoder, 32768),
  ],
  ['Huffman.createLZXDecoder', () => Huffman.createLZXDecoder(32768)],
  ['Huffman.readCodeLengths', reader => Huffman.readCodeLengths(reader, 2)],
  [
    'Huffman.buildPredefinedTree',
    () => Huffman.buildPredefinedTree('literal', 32768),
  ],
];

test.each(legacyCalls)(
  'legacy %s explicitly fails without consuming input or mutating state',
  (_name, invoke) => {
    const tree = Huffman.createCanonicalTree([1, 1]);
    const decoder = { literalTree: tree, matchTree: tree, lengthTree: tree };
    const original = structuredClone(decoder);
    const reader = new BitReader(Buffer.from([0b01010000]));
    reader.read(1);
    const position = reader.getPosition();
    assert.throws(
      invoke.bind(undefined, reader, decoder),
      /Unsupported legacy LZX.*LZXDecoder.*Huffman/,
    );
    assert.deepEqual(reader.getPosition(), position);
    assert.deepEqual(decoder, original);
    assert.equal(decoder.literalTree, tree);
    assert.equal(decoder.matchTree, tree);
    assert.equal(decoder.lengthTree, tree);
  },
);

test('all legacy predefined-tree variants reject rather than inventing LZX trees', () => {
  for (const type of ['literal', 'match', 'length'] as const) {
    assert.throws(
      () => Huffman.buildPredefinedTree(type, 32768),
      /Unsupported legacy LZX/,
    );
  }
});

test('real LZX encoding/decoding remains separate from the deprecated helpers', () => {
  const input = Buffer.from('real LZX tree and reset state\n'.repeat(100));
  const encoded = new LZXEncoder().compress(input);
  const decoder = new LZXDecoder({
    signature: 'LZXC',
    version: 2,
    windowSize: 32768,
    resetInterval: 32768,
    cacheSize: 0,
    unknown: 0,
  });
  assert.deepEqual(
    decoder.decode(new BitReader(encoded.compressedData), input.length),
    input,
  );
});
