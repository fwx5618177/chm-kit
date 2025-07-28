import type { HuffmanTree, HuffmanDecoder } from '../../core/types';
import { BitReader } from '../io/bit-reader';
import { HuffmanTreeOperations } from './huffman-tree';

/**
 * LZX 特定的 Huffman 解码器
 * 负责 LZX 压缩格式中的 Huffman 解码
 */
export class LZXHuffmanDecoder {
  /**
   * 创建 LZX 解码器
   * @param windowSize 窗口大小
   * @returns Huffman 解码器
   */
  static createLZXDecoder(windowSize: number): HuffmanDecoder {
    // LZX 使用三个 Huffman 表
    const literalTreeSize = 256;
    const matchTreeSize = 8;
    const lengthTreeSize = this.calculateLengthTreeSize(windowSize);

    return {
      literalTree: HuffmanTreeOperations.createEmptyTree(literalTreeSize),
      matchTree: HuffmanTreeOperations.createEmptyTree(matchTreeSize),
      lengthTree: HuffmanTreeOperations.createEmptyTree(lengthTreeSize),
    };
  }

  /**
   * 从位读取器读取 LZX 码长
   * @param reader 位读取器
   * @param count 要读取的码长数量
   * @returns 码长数组
   */
  static readLZXCodeLengths(reader: BitReader, count: number): number[] {
    const lengths: number[] = [];

    for (let i = 0; i < count; i++) {
      if (!reader.hasMore()) {
        throw new Error(
          'Unexpected end of stream while reading LZX code lengths',
        );
      }

      const length = reader.read(4); // LZX 使用 4 位表示码长
      lengths.push(length);
    }

    return lengths;
  }

  /**
   * 构建预定义的 LZX Huffman 表
   * @param type 表类型 ('literal' | 'match' | 'length')
   * @param windowSize 窗口大小
   * @returns Huffman 树
   */
  static buildLZXPredefinedTree(
    type: 'literal' | 'match' | 'length',
    windowSize: number,
  ): HuffmanTree {
    switch (type) {
      case 'literal':
        return this.buildLiteralTree();
      case 'match':
        return this.buildMatchTree();
      case 'length':
        return this.buildLengthTree(windowSize);
      default:
        throw new Error(`Unknown LZX tree type: ${type}`);
    }
  }

  /**
   * 解码 LZX 符号
   * @param reader 位读取器
   * @param tree Huffman 树
   * @returns 解码的符号
   */
  static decodeLZXSymbol(reader: BitReader, tree: HuffmanTree): number {
    return HuffmanTreeOperations.decodeSymbol(reader, tree, 16);
  }

  /**
   * 更新 LZX 解码器的树
   * @param decoder 解码器
   * @param type 树类型
   * @param lengths 新的码长数组
   */
  static updateLZXTree(
    decoder: HuffmanDecoder,
    type: 'literal' | 'match' | 'length',
    lengths: number[],
  ): void {
    const newTree = HuffmanTreeOperations.createCanonicalTree(lengths);

    switch (type) {
      case 'literal':
        decoder.literalTree = newTree;
        break;
      case 'match':
        decoder.matchTree = newTree;
        break;
      case 'length':
        decoder.lengthTree = newTree;
        break;
    }
  }

  /**
   * 验证 LZX 解码器的有效性
   * @param decoder 解码器
   * @returns 验证结果
   */
  static validateLZXDecoder(decoder: HuffmanDecoder): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!HuffmanTreeOperations.validateTree(decoder.literalTree)) {
      errors.push('字面量树无效');
    }

    if (!HuffmanTreeOperations.validateTree(decoder.matchTree)) {
      errors.push('匹配树无效');
    }

    if (!HuffmanTreeOperations.validateTree(decoder.lengthTree)) {
      errors.push('长度树无效');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * 计算 LZX 长度树大小
   * @param windowSize 窗口大小
   * @returns 长度树大小
   */
  private static calculateLengthTreeSize(windowSize: number): number {
    let size = 0;
    let temp = windowSize;
    while (temp > 0) {
      size++;
      temp >>= 1;
    }
    return size * 8;
  }

  /**
   * 构建 LZX 字面量树
   * @returns 字面量 Huffman 树
   */
  private static buildLiteralTree(): HuffmanTree {
    const lengths = new Array(256).fill(8); // 所有字面量使用 8 位
    return HuffmanTreeOperations.createCanonicalTree(lengths);
  }

  /**
   * 构建 LZX 匹配树
   * @returns 匹配 Huffman 树
   */
  private static buildMatchTree(): HuffmanTree {
    const lengths = new Array(8).fill(3); // 所有匹配使用 3 位
    return HuffmanTreeOperations.createCanonicalTree(lengths);
  }

  /**
   * 构建 LZX 长度树
   * @param windowSize 窗口大小
   * @returns 长度 Huffman 树
   */
  private static buildLengthTree(windowSize: number): HuffmanTree {
    const size = this.calculateLengthTreeSize(windowSize);
    const lengths = new Array(size).fill(4); // 所有长度使用 4 位
    return HuffmanTreeOperations.createCanonicalTree(lengths);
  }

  /**
   * 获取 LZX 解码器统计信息
   * @param decoder 解码器
   * @returns 统计信息
   */
  static getLZXDecoderStats(decoder: HuffmanDecoder): {
    literalStats: ReturnType<typeof HuffmanTreeOperations.getTreeStats>;
    matchStats: ReturnType<typeof HuffmanTreeOperations.getTreeStats>;
    lengthStats: ReturnType<typeof HuffmanTreeOperations.getTreeStats>;
  } {
    return {
      literalStats: HuffmanTreeOperations.getTreeStats(decoder.literalTree),
      matchStats: HuffmanTreeOperations.getTreeStats(decoder.matchTree),
      lengthStats: HuffmanTreeOperations.getTreeStats(decoder.lengthTree),
    };
  }

  /**
   * 重置 LZX 解码器为默认状态
   * @param decoder 解码器
   * @param windowSize 窗口大小
   */
  static resetLZXDecoder(decoder: HuffmanDecoder, windowSize: number): void {
    decoder.literalTree = this.buildLiteralTree();
    decoder.matchTree = this.buildMatchTree();
    decoder.lengthTree = this.buildLengthTree(windowSize);
  }
}
