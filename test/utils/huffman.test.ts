import { test } from 'uvu';
import { equal, ok } from 'uvu/assert';
import { HuffmanTreeOperations } from '../../src/utils/compression/huffman-tree';
import { Huffman } from '../../src/utils/compression/huffman';
import { BitReader } from '../../src/utils/io/bit-reader';

test('createCanonicalTree should create tree from lengths', () => {
  // Simple example: symbols A(0), B(1) with lengths 1, 1
  const lengths = [1, 1];
  const tree = HuffmanTreeOperations.createCanonicalTree(lengths);

  equal(tree.symbols.length, 2);
  equal(tree.codes.length, 2);
  equal(tree.lengths.length, 2);
  // Canonical codes for 2 symbols with length 1: 0, 1
  equal(tree.codes[0], 0);
  equal(tree.codes[1], 1);
});

test('createCanonicalTree should handle different code lengths', () => {
  // Lengths: [2, 1, 3, 3] -> symbol 1 gets code 0 (1 bit), symbol 0 gets code 10 (2 bits),
  // symbols 2 and 3 get codes 110, 111 (3 bits)
  const lengths = [2, 1, 3, 3];
  const tree = HuffmanTreeOperations.createCanonicalTree(lengths);

  // Symbols should be sorted by length then by symbol
  equal(tree.symbols[0], 1); // length 1
  equal(tree.symbols[1], 0); // length 2
  equal(tree.symbols[2], 2); // length 3
  equal(tree.symbols[3], 3); // length 3
});

test('createCanonicalTree should skip zero-length symbols', () => {
  const lengths = [0, 2, 0, 2];
  const tree = HuffmanTreeOperations.createCanonicalTree(lengths);
  equal(tree.symbols.length, 2);
  equal(tree.symbols[0], 1);
  equal(tree.symbols[1], 3);
});

test('createEmptyTree should create tree of given size', () => {
  const tree = HuffmanTreeOperations.createEmptyTree(10);
  equal(tree.symbols.length, 10);
  equal(tree.codes.length, 10);
  equal(tree.lengths.length, 10);
});

test('validateTree should accept valid trees', () => {
  const lengths = [2, 1, 3, 3];
  const tree = HuffmanTreeOperations.createCanonicalTree(lengths);
  ok(HuffmanTreeOperations.validateTree(tree));
});

test('validateTree should reject trees with mismatched array lengths', () => {
  const tree = {
    symbols: [0, 1],
    codes: [0],
    lengths: [1, 1],
  };
  ok(!HuffmanTreeOperations.validateTree(tree));
});

test('decodeSymbol should decode a simple Huffman code', () => {
  // Create a simple tree: 0->A, 1->B
  const lengths = [1, 1];
  const tree = HuffmanTreeOperations.createCanonicalTree(lengths);

  // Bit stream: 0 1 -> should decode as A, B
  const buffer = Buffer.from([0b01000000]); // bits: 0, 1, 0, 0, ...
  const reader = new BitReader(buffer);

  equal(HuffmanTreeOperations.decodeSymbol(reader, tree), 0); // A
  equal(HuffmanTreeOperations.decodeSymbol(reader, tree), 1); // B
});

test('Huffman facade should delegate to tree operations', () => {
  const lengths = [2, 1, 2];
  const tree = Huffman.createCanonicalTree(lengths);

  ok(Huffman.validateTree(tree));

  const stats = Huffman.getTreeStats(tree);
  equal(stats.symbolCount, 3);
  equal(stats.minLength, 1);
  equal(stats.maxLength, 2);
});

test('getTreeStats should return correct statistics', () => {
  const lengths = [1, 2, 3, 3];
  const tree = HuffmanTreeOperations.createCanonicalTree(lengths);
  const stats = HuffmanTreeOperations.getTreeStats(tree);

  equal(stats.symbolCount, 4);
  equal(stats.minLength, 1);
  equal(stats.maxLength, 3);
});

test('calculateOptimalCompression should handle zero frequencies', () => {
  const result = HuffmanTreeOperations.calculateOptimalCompression([]);
  equal(result.totalSymbols, 0);
  equal(result.entropy, 0);
});

test('calculateOptimalCompression should compute entropy', () => {
  // Uniform distribution: 4 symbols each appearing once
  const result = HuffmanTreeOperations.calculateOptimalCompression([
    1, 1, 1, 1,
  ]);
  equal(result.totalSymbols, 4);
  // Entropy should be log2(4) = 2
  ok(Math.abs(result.entropy - 2) < 0.001);
});

test('buildTreeFromLengths should validate after building', () => {
  const tree = HuffmanTreeOperations.buildTreeFromLengths([1, 1]);
  ok(tree.symbols.length === 2);
});

test.run();
