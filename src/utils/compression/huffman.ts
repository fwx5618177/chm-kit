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
   * 创建 Canonical Huffman 表
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
   * @returns 解码的符号
   */
  public static decodeSymbol(reader: BitReader, tree: HuffmanTree): number {
    return HuffmanTreeOperations.decodeSymbol(reader, tree);
  }

  /**
   * 创建 LZX 解码器
   * @param windowSize 窗口大小
   * @returns Huffman 解码器
   */
  public static createLZXDecoder(windowSize: number): HuffmanDecoder {
    return LZXHuffmanDecoder.createLZXDecoder(windowSize);
  }

  /**
   * 从位读取器读取码长
   * @param reader 位读取器
   * @param count 要读取的码长数量
   * @returns 码长数组
   */
  public static readCodeLengths(reader: BitReader, count: number): number[] {
    return LZXHuffmanDecoder.readLZXCodeLengths(reader, count);
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
