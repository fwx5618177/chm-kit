import type { HuffmanTree, HuffmanDecoder } from '../../core/types';
import type { BitReader } from '../io/bit-reader';
import type { HuffmanTreeOperations } from './huffman-tree';

function unsupported(method: string): never {
  throw new Error(
    `Unsupported legacy LZX Huffman API: ${method}. Use LZXDecoder from chmkit for real LZX streams, or Huffman for generic byte-oriented Huffman trees.`,
  );
}

/**
 * @deprecated The legacy literal/match/length model is not LZX. These signatures
 * remain available, but all operations throw before consuming input or mutating
 * state. Use LZXDecoder, which handles LZX word order, pretrees and reset state.
 */
export class LZXHuffmanDecoder {
  /** @deprecated Unsupported; use LZXDecoder from chmkit. */
  static createLZXDecoder(windowSize: number): HuffmanDecoder {
    void windowSize;
    return unsupported('createLZXDecoder');
  }

  /** @deprecated Unsupported; LZX code lengths require pretree/delta decoding. */
  static readLZXCodeLengths(reader: BitReader, count: number): number[] {
    void reader;
    void count;
    return unsupported('readLZXCodeLengths');
  }

  /** @deprecated Unsupported; LZX has no such predefined three-tree model. */
  static buildLZXPredefinedTree(
    type: 'literal' | 'match' | 'length',
    windowSize: number,
  ): HuffmanTree {
    void type;
    void windowSize;
    return unsupported('buildLZXPredefinedTree');
  }

  /** @deprecated Unsupported; use Huffman.decodeSymbol for generic trees. */
  static decodeLZXSymbol(reader: BitReader, tree: HuffmanTree): number {
    void reader;
    void tree;
    return unsupported('decodeLZXSymbol');
  }

  /** @deprecated Unsupported; LZXDecoder owns the actual LZX tree state. */
  static updateLZXTree(
    decoder: HuffmanDecoder,
    type: 'literal' | 'match' | 'length',
    lengths: number[],
  ): void {
    void decoder;
    void type;
    void lengths;
    return unsupported('updateLZXTree');
  }

  /** @deprecated Unsupported; three generic trees cannot validate LZX state. */
  static validateLZXDecoder(decoder: HuffmanDecoder): {
    isValid: boolean;
    errors: string[];
  } {
    void decoder;
    return unsupported('validateLZXDecoder');
  }

  /** @deprecated Unsupported; use generic Huffman.getTreeStats for each tree. */
  static getLZXDecoderStats(decoder: HuffmanDecoder): {
    literalStats: ReturnType<typeof HuffmanTreeOperations.getTreeStats>;
    matchStats: ReturnType<typeof HuffmanTreeOperations.getTreeStats>;
    lengthStats: ReturnType<typeof HuffmanTreeOperations.getTreeStats>;
  } {
    void decoder;
    return unsupported('getLZXDecoderStats');
  }

  /** @deprecated Unsupported; use LZXDecoder.reset() for actual LZX state. */
  static resetLZXDecoder(decoder: HuffmanDecoder, windowSize: number): void {
    void decoder;
    void windowSize;
    return unsupported('resetLZXDecoder');
  }
}
