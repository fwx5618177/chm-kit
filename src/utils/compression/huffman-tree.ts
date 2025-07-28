import type { HuffmanTree } from '../../core/types';
import { BitReader } from '../io/bit-reader';

/**
 * 通用 Huffman 树操作类
 * 负责通用的 Huffman 算法实现
 */
export class HuffmanTreeOperations {
  /**
   * 创建 Canonical Huffman 表
   * @param lengths 码长数组
   * @returns Huffman 树
   */
  static createCanonicalTree(lengths: number[]): HuffmanTree {
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
   * @param maxCodeLength 最大码长
   * @returns 解码的符号
   */
  static decodeSymbol(
    reader: BitReader,
    tree: HuffmanTree,
    maxCodeLength: number = 16,
  ): number {
    let code = 0;
    let length = 0;

    // 逐位读取直到找到匹配的码
    while (length < maxCodeLength) {
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
   * 创建空的 Huffman 树
   * @param size 树的大小
   * @returns 空的 Huffman 树
   */
  static createEmptyTree(size: number): HuffmanTree {
    return {
      symbols: new Array(size).fill(0).map((_, i) => i),
      codes: new Array(size).fill(0),
      lengths: new Array(size).fill(0),
    };
  }

  /**
   * 验证 Huffman 树的有效性
   * @param tree Huffman 树
   * @returns 是否有效
   */
  static validateTree(tree: HuffmanTree): boolean {
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
  static getTreeStats(tree: HuffmanTree): {
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

  /**
   * 从码长数组构建 Huffman 树
   * @param lengths 码长数组
   * @param validateAfterBuild 构建后是否验证
   * @returns Huffman 树
   */
  static buildTreeFromLengths(
    lengths: number[],
    validateAfterBuild: boolean = true,
  ): HuffmanTree {
    const tree = this.createCanonicalTree(lengths);

    if (validateAfterBuild && !this.validateTree(tree)) {
      throw new Error('构建的 Huffman 树无效');
    }

    return tree;
  }

  /**
   * 计算理论最优压缩率
   * @param frequencies 符号频率
   * @returns 理论最优压缩率信息
   */
  static calculateOptimalCompression(frequencies: number[]): {
    totalSymbols: number;
    entropy: number;
    averageBitsPerSymbol: number;
    compressionRatio: number;
  } {
    const totalSymbols = frequencies.reduce((sum, freq) => sum + freq, 0);

    if (totalSymbols === 0) {
      return {
        totalSymbols: 0,
        entropy: 0,
        averageBitsPerSymbol: 0,
        compressionRatio: 0,
      };
    }

    // 计算熵
    let entropy = 0;
    for (const freq of frequencies) {
      if (freq > 0) {
        const probability = freq / totalSymbols;
        entropy -= probability * Math.log2(probability);
      }
    }

    const averageBitsPerSymbol = entropy;
    const compressionRatio = 8 / averageBitsPerSymbol; // 假设原始数据是 8 位

    return {
      totalSymbols,
      entropy,
      averageBitsPerSymbol,
      compressionRatio,
    };
  }
}
