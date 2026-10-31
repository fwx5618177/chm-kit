import type { HuffmanTree } from '../../core/types';
import { BitReader } from '../io/bit-reader';
import { HuffmanTreeOperations } from './huffman-tree';

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
