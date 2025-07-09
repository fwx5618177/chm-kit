import type { HuffmanTree, HuffmanDecoder } from '../core/types';
import { BitReader } from './bit-reader';

/**
 * Huffman 解码器工具类
 */
export class Huffman {
  /**
   * 创建 Canonical Huffman 表
   * @param lengths 码长数组
   * @returns Huffman 树
   */
  public static createCanonicalTree(lengths: number[]): HuffmanTree {
    const symbols: number[] = [];
    const codes: number[] = [];
    const treeLengths: number[] = [];

    // 按码长排序符号
    const sortedSymbols = lengths
      .map((length, symbol) => ({ symbol, length }))
      .filter(item => item.length > 0)
      .sort((a, b) => {
        if (a.length !== b.length) {
          return a.length - b.length;
        }
        return a.symbol - b.symbol;
      });

    let code = 0;
    let prevLength = 0;

    for (const item of sortedSymbols) {
      // 如果码长增加，左移代码
      if (item.length > prevLength) {
        code <<= item.length - prevLength;
        prevLength = item.length;
      }

      symbols.push(item.symbol);
      codes.push(code);
      treeLengths.push(item.length);

      code++;
    }

    return {
      symbols,
      codes,
      lengths: treeLengths,
    };
  }

  /**
   * 解码单个符号
   * @param reader 位读取器
   * @param tree Huffman 树
   * @returns 解码的符号
   */
  public static decodeSymbol(reader: BitReader, tree: HuffmanTree): number {
    let code = 0;
    let length = 0;

    // 逐位读取直到找到匹配的码
    while (length < 16) {
      // 最大码长限制
      if (!reader.hasMore()) {
        throw new Error(
          'Unexpected end of stream while decoding Huffman symbol',
        );
      }

      const bit = reader.read(1);
      code = (code << 1) | bit;
      length++;

      // 查找匹配的码
      for (let i = 0; i < tree.codes.length; i++) {
        if (tree.lengths[i] === length && tree.codes[i] === code) {
          return tree.symbols[i]!;
        }
      }
    }

    throw new Error('Invalid Huffman code');
  }

  /**
   * 创建 LZX 解码器
   * @param windowSize 窗口大小
   * @returns Huffman 解码器
   */
  public static createLZXDecoder(windowSize: number): HuffmanDecoder {
    // LZX 使用三个 Huffman 表
    const literalTreeSize = 256;
    const matchTreeSize = 8;
    const lengthTreeSize = this.calculateLengthTreeSize(windowSize);

    return {
      literalTree: this.createEmptyTree(literalTreeSize),
      matchTree: this.createEmptyTree(matchTreeSize),
      lengthTree: this.createEmptyTree(lengthTreeSize),
    };
  }

  /**
   * 计算长度树大小
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
   * 创建空的 Huffman 树
   * @param size 树的大小
   * @returns 空的 Huffman 树
   */
  private static createEmptyTree(size: number): HuffmanTree {
    return {
      symbols: new Array(size).fill(0).map((_, i) => i),
      codes: new Array(size).fill(0),
      lengths: new Array(size).fill(0),
    };
  }

  /**
   * 从位读取器读取码长
   * @param reader 位读取器
   * @param count 要读取的码长数量
   * @returns 码长数组
   */
  public static readCodeLengths(reader: BitReader, count: number): number[] {
    const lengths: number[] = [];

    for (let i = 0; i < count; i++) {
      if (!reader.hasMore()) {
        throw new Error('Unexpected end of stream while reading code lengths');
      }

      const length = reader.read(4); // LZX 使用 4 位表示码长
      lengths.push(length);
    }

    return lengths;
  }

  /**
   * 构建预定义的 Huffman 表
   * @param type 表类型 ('literal' | 'match' | 'length')
   * @param windowSize 窗口大小
   * @returns Huffman 树
   */
  public static buildPredefinedTree(
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
        throw new Error(`Unknown tree type: ${type}`);
    }
  }

  /**
   * 构建字面量树
   * @returns 字面量 Huffman 树
   */
  private static buildLiteralTree(): HuffmanTree {
    const lengths = new Array(256).fill(8); // 所有字面量使用 8 位
    return this.createCanonicalTree(lengths);
  }

  /**
   * 构建匹配树
   * @returns 匹配 Huffman 树
   */
  private static buildMatchTree(): HuffmanTree {
    const lengths = new Array(8).fill(3); // 所有匹配使用 3 位
    return this.createCanonicalTree(lengths);
  }

  /**
   * 构建长度树
   * @param windowSize 窗口大小
   * @returns 长度 Huffman 树
   */
  private static buildLengthTree(windowSize: number): HuffmanTree {
    const size = this.calculateLengthTreeSize(windowSize);
    const lengths = new Array(size).fill(4); // 所有长度使用 4 位
    return this.createCanonicalTree(lengths);
  }

  /**
   * 验证 Huffman 树的有效性
   * @param tree Huffman 树
   * @returns 是否有效
   */
  public static validateTree(tree: HuffmanTree): boolean {
    if (
      tree.symbols.length !== tree.codes.length ||
      tree.symbols.length !== tree.lengths.length
    ) {
      return false;
    }

    // 检查是否有重复的码
    const codeMap = new Map<string, number>();
    for (let i = 0; i < tree.codes.length; i++) {
      const key = `${tree.codes[i]}-${tree.lengths[i]}`;
      if (codeMap.has(key)) {
        return false;
      }
      codeMap.set(key, tree.symbols[i]!);
    }

    return true;
  }

  /**
   * 获取树的统计信息
   * @param tree Huffman 树
   * @returns 统计信息
   */
  public static getTreeStats(tree: HuffmanTree): {
    symbolCount: number;
    minLength: number;
    maxLength: number;
    avgLength: number;
  } {
    const symbolCount = tree.symbols.length;
    const minLength = symbolCount > 0 ? Math.min(...tree.lengths) : 0;
    const maxLength = symbolCount > 0 ? Math.max(...tree.lengths) : 0;
    const avgLength =
      symbolCount > 0
        ? tree.lengths.reduce((sum, len) => sum + len, 0) / symbolCount
        : 0;

    return {
      symbolCount,
      minLength,
      maxLength,
      avgLength,
    };
  }
}
