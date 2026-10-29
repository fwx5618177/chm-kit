import type { HuffmanTree, HuffmanDecoder } from '../../core/types';
import { BitReader } from '../io/bit-reader';
import { HuffmanTreeOperations } from './huffman-tree';
import { LZXHuffmanDecoder } from './lzx-huffman-decoder';

/**
 * Huffman 解码器门面类
 * 提供统一的 Huffman 操作接口
 */
export class Huffman {
  /**
   * 创建 Canonical Huffman 表（0 为未使用，支持 1–32 位码）。
   * @param lengths 码长数组
   * @returns Huffman 树
   */
  public static createCanonicalTree(lengths: number[]): HuffmanTree {
    return HuffmanTreeOperations.createCanonicalTree(lengths);
  }

  /**
   * 解码单个符号
   * @param reader 位读取器
   * @param tree Huffman 树
   * @param maxCodeLength 最大码长（默认 16，最大 32）
   * @returns 解码的符号
   */
  public static decodeSymbol(
    reader: BitReader,
    tree: HuffmanTree,
    maxCodeLength = 16,
  ): number {
    return HuffmanTreeOperations.decodeSymbol(reader, tree, maxCodeLength);
  }

  /**
   * @deprecated 不支持旧的三树 LZX 模型；请使用 chmkit 的 LZXDecoder。
   * @param windowSize 窗口大小
   * @returns Huffman 解码器
   */
  public static createLZXDecoder(windowSize: number): HuffmanDecoder {
    return LZXHuffmanDecoder.createLZXDecoder(windowSize);
  }

  /**
   * @deprecated 不支持将固定 4-bit 读取视为 LZX 码长解码；请使用 LZXDecoder。
   * @param reader 位读取器
   * @param count 要读取的码长数量
   * @returns 码长数组
   */
  public static readCodeLengths(reader: BitReader, count: number): number[] {
    return LZXHuffmanDecoder.readLZXCodeLengths(reader, count);
  }

  /**
   * @deprecated LZX 无此预定义三树模型；请使用 LZXDecoder。
   * @param type 表类型 ('literal' | 'match' | 'length')
   * @param windowSize 窗口大小
   * @returns Huffman 树
   */
  public static buildPredefinedTree(
    type: 'literal' | 'match' | 'length',
    windowSize: number,
  ): HuffmanTree {
    return LZXHuffmanDecoder.buildLZXPredefinedTree(type, windowSize);
  }

  /**
   * 验证 Huffman 树的有效性
   * @param tree Huffman 树
   * @returns 是否有效
   */
  public static validateTree(tree: HuffmanTree): boolean {
    return HuffmanTreeOperations.validateTree(tree);
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
    return HuffmanTreeOperations.getTreeStats(tree);
  }
}
