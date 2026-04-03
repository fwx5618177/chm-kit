import type {
  LZXBlock,
  LZXCHeader,
  HuffmanDecoder,
  HuffmanTree,
} from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { SlidingWindow } from './sliding-window';
import { ResetTableProcessor } from './reset-table';
import { Huffman } from '../../utils/compression/huffman';

/**
 * LZX 块类型常量
 */
enum LZXBlockType {
  VERBATIM = 1, // 逐字块
  ALIGNED = 2, // 对齐块
  UNCOMPRESSED = 3, // 未压缩块
}

/**
 * LZX 解码器
 * 负责实现完整的 LZX 解码算法，包括滑动窗口、霍夫曼解码等
 */
export class LZXDecoder {
  private window: SlidingWindow;
  private _resetProcessor: ResetTableProcessor; // 将来会使用
  private huffmanDecoder: HuffmanDecoder | null = null;
  private alignedTree: HuffmanTree | null = null;
  private windowSize: number;
  private resetInterval: number;
  // LZX R0/R1/R2 最近使用偏移缓存（初始值均为 1）
  private recentOffsets: [number, number, number] = [1, 1, 1];
  // LZX 树长度持久化状态（跨块 delta 解码基准）
  private prevMainLengths: number[] = [];
  private prevLengthLengths: number[] = [];

  // LZX 常量
  private static readonly NUM_CHARS = 256;
  private static readonly PRETREE_NUM_ELEMENTS = 20;
  private static readonly _ALIGNED_NUM_ELEMENTS = 8; // 将来会使用
  // NUM_PRIMARY_LENGTHS = 7: 主树中每个位置槽的内联长度数量（length_header 0-6）
  // 步幅为 8（0-7，其中 7 是哨兵值 = 使用长度树），在 decodeMatch 中以字面量 8 表示
  private static readonly NUM_SECONDARY_LENGTHS = 249; // 长度树符号总数（0..248）

  // 窗口大小 → 位置槽数量映射（LZX 规范，每翻倍加 2）
  private static readonly POSITION_SLOTS: ReadonlyMap<number, number> = new Map(
    [
      [512, 10],
      [1024, 12],
      [2048, 14],
      [4096, 16],
      [8192, 18],
      [16384, 20],
      [32768, 22],
      [65536, 24],
      [131072, 26],
      [262144, 28],
      [524288, 30],
      [1048576, 32],
      [2097152, 34],
    ],
  );

  /**
   * 根据窗口大小获取位置槽数量
   */
  private getNumPositionSlots(): number {
    return LZXDecoder.POSITION_SLOTS.get(this.windowSize) ?? 22;
  }

  /**
   * 获取字面量/主树的符号总数
   * LZX 规范：NUM_CHARS + 8 * numPositionSlots
   */
  private getMainTreeElementCount(): number {
    return LZXDecoder.NUM_CHARS + 8 * this.getNumPositionSlots();
  }

  constructor(lzxcHeader: LZXCHeader) {
    this.windowSize = lzxcHeader.windowSize;
    this.resetInterval = lzxcHeader.resetInterval;
    this.window = new SlidingWindow(this.windowSize);
    this._resetProcessor = new ResetTableProcessor();
  }

  /**
   * 解码 LZX 数据块
   * @param reader 位读取器
   * @param uncompressedSize 预期的未压缩大小
   * @returns 解码后的数据
   */
  decode(reader: BitReader, uncompressedSize: number): Buffer {
    const result = Buffer.alloc(uncompressedSize);
    let outputPosition = 0;

    // 重置解码器状态
    this.reset();

    while (outputPosition < uncompressedSize) {
      // 读取块头
      const block = this.readBlockHeader(reader);

      // 解码块数据
      const decodedData = this.decodeBlock(reader, block);

      // 将解码数据写入结果缓冲区
      const bytesToCopy = Math.min(
        decodedData.length,
        uncompressedSize - outputPosition,
      );

      decodedData.copy(result, outputPosition, 0, bytesToCopy);
      outputPosition += bytesToCopy;

      // 注意：窗口已在 decodeBlock 内部实时更新（字面量和匹配各自在解码时写入）
      // 对于未压缩块，窗口也在 decodeUncompressedBlock 内部更新
      // 此处无需再次调用 window.write()，避免双写导致状态错误
    }

    return result;
  }

  /**
   * 读取块头信息
   * @param reader 位读取器
   * @returns 块信息
   */
  private readBlockHeader(reader: BitReader): LZXBlock {
    // 读取块类型 (3 位)
    const blockType = reader.read(3);

    // 读取未压缩大小 (24 位)
    const uncompressedSize = reader.read(24);

    // 注意：LZX 格式中块头仅包含 type(3) + size(24)
    // 对齐块的对齐树（8×3 bits）在 decodeAlignedBlock 内部读取，此处不多读
    return {
      type: blockType,
      uncompressedSize,
      data: Buffer.alloc(0), // 临时占位，稍后填充
    };
  }

  /**
   * 解码数据块
   * @param reader 位读取器
   * @param block 块信息
   * @returns 解码后的数据
   */
  private decodeBlock(reader: BitReader, block: LZXBlock): Buffer {
    switch (block.type) {
      case LZXBlockType.VERBATIM:
        return this.decodeVerbatimBlock(reader, block.uncompressedSize);

      case LZXBlockType.ALIGNED:
        return this.decodeAlignedBlock(reader, block.uncompressedSize);

      case LZXBlockType.UNCOMPRESSED:
        return this.decodeUncompressedBlock(reader, block.uncompressedSize);

      default:
        throw new Error(`不支持的 LZX 块类型: ${block.type}`);
    }
  }

  /**
   * 解码逐字块
   * @param reader 位读取器
   * @param uncompressedSize 未压缩大小
   * @returns 解码后的数据
   */
  private decodeVerbatimBlock(
    reader: BitReader,
    uncompressedSize: number,
  ): Buffer {
    // 逐字块不使用对齐树
    this.alignedTree = null;
    // 读取霍夫曼表
    this.huffmanDecoder = this.readHuffmanTables(reader);

    const result = Buffer.alloc(uncompressedSize);
    let outputPosition = 0;

    while (outputPosition < uncompressedSize) {
      // 解码下一个符号
      const symbol = this.decodeSymbol(reader, this.huffmanDecoder.literalTree);

      if (symbol < LZXDecoder.NUM_CHARS) {
        // 字面量字符 — 立即写入滑动窗口（使后续匹配可引用）
        result[outputPosition] = symbol;
        this.window.writeByte(symbol);
        outputPosition++;
      } else {
        // 匹配序列
        const matchInfo = this.decodeMatch(reader, symbol);
        const matchData = this.window.copyData(
          matchInfo.offset,
          matchInfo.length,
        );

        // 复制匹配数据
        const bytesToCopy = Math.min(
          matchData.length,
          uncompressedSize - outputPosition,
        );

        matchData.copy(result, outputPosition, 0, bytesToCopy);
        outputPosition += bytesToCopy;
      }
    }

    return result;
  }

  /**
   * 解码对齐块
   * 对齐块与逐字块相似，但大偏移值的低3位使用对齐树编码
   * @param reader 位读取器
   * @param uncompressedSize 未压缩大小
   * @returns 解码后的数据
   */
  private decodeAlignedBlock(
    reader: BitReader,
    uncompressedSize: number,
  ): Buffer {
    // 读取8个3位的对齐树长度（位流顺序：对齐树在主树/长度树之前）
    const alignedLengths: number[] = [];
    for (let i = 0; i < 8; i++) {
      alignedLengths.push(reader.read(3));
    }
    // 构建对齐树，供 decodeMatch 在偏移 footer bits >= 3 时使用
    this.alignedTree = Huffman.createCanonicalTree(alignedLengths);

    // 读取主树与长度树（与逐字块相同）
    this.huffmanDecoder = this.readHuffmanTables(reader);

    const result = Buffer.alloc(uncompressedSize);
    let outputPosition = 0;

    while (outputPosition < uncompressedSize) {
      const symbol = this.decodeSymbol(reader, this.huffmanDecoder.literalTree);

      if (symbol < LZXDecoder.NUM_CHARS) {
        result[outputPosition] = symbol;
        this.window.writeByte(symbol);
        outputPosition++;
      } else {
        const matchInfo = this.decodeMatch(reader, symbol);
        const matchData = this.window.copyData(
          matchInfo.offset,
          matchInfo.length,
        );
        const bytesToCopy = Math.min(
          matchData.length,
          uncompressedSize - outputPosition,
        );
        matchData.copy(result, outputPosition, 0, bytesToCopy);
        outputPosition += bytesToCopy;
      }
    }

    return result;
  }

  /**
   * 解码未压缩块
   * @param reader 位读取器
   * @param uncompressedSize 未压缩大小
   * @returns 解码后的数据
   */
  private decodeUncompressedBlock(
    reader: BitReader,
    uncompressedSize: number,
  ): Buffer {
    // 对齐到字节边界，再对齐到 16-bit（2 字节）边界
    reader.align();
    if (reader.position % 2 !== 0) {
      reader.read(8);
    }

    // LZX 规范：未压缩块在数据前显式编码新的 R0/R1/R2（各 4 字节 LE）
    this.recentOffsets[0] = this.readUInt32LE(reader);
    this.recentOffsets[1] = this.readUInt32LE(reader);
    this.recentOffsets[2] = this.readUInt32LE(reader);

    const result = Buffer.alloc(uncompressedSize);
    for (let i = 0; i < uncompressedSize; i++) {
      const byte = reader.read(8);
      result[i] = byte;
      // 未压缩块也需要立即更新滑动窗口
      this.window.writeByte(byte);
    }

    // LZX 规范：未压缩块字节数为奇数时，须跳过 1 个填充字节使下一块头对齐到 16-bit 边界
    if (uncompressedSize % 2 !== 0) {
      reader.read(8);
    }

    return result;
  }

  /**
   * 读取 4 字节小端序无符号整数（用于 R0/R1/R2 等字段）
   */
  private readUInt32LE(reader: BitReader): number {
    const b0 = reader.read(8);
    const b1 = reader.read(8);
    const b2 = reader.read(8);
    const b3 = reader.read(8);
    // >>> 0 将有符号 32 位整数转换为无符号，避免高位置 1 时产生负值
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
  }

  /**
   * 读取霍夫曼表
   * LZX 规范：主树和长度树各自使用独立的预树
   * @param reader 位读取器
   * @returns 霍夫曼解码器
   */
  private readHuffmanTables(reader: BitReader): HuffmanDecoder {
    const mainCount = this.getMainTreeElementCount();
    // LZX 规范：长度树仅有 249 个符号（0..248 代表额外长度值）
    // NUM_SECONDARY_LENGTHS = 249，不能与 NUM_PRIMARY_LENGTHS 相加
    const lengthCount = LZXDecoder.NUM_SECONDARY_LENGTHS;

    // 初始化历史长度数组（首个块第一次调用时）
    if (this.prevMainLengths.length !== mainCount) {
      this.prevMainLengths = new Array(mainCount).fill(0);
    }
    if (this.prevLengthLengths.length !== lengthCount) {
      this.prevLengthLengths = new Array(lengthCount).fill(0);
    }

    // 主树：读取主树预树，再 delta 解码主树长度
    const mainPretreeLengths = this.readPretreeLengths(reader);
    const mainPretree = Huffman.createCanonicalTree(mainPretreeLengths);
    const literalLengths = this.readTreeLengths(
      reader,
      mainPretree,
      mainCount,
      this.prevMainLengths,
    );
    this.prevMainLengths = [...literalLengths];

    // 长度树：读取长度树预树，再 delta 解码长度树
    const lengthPretreeLengths = this.readPretreeLengths(reader);
    const lengthPretree = Huffman.createCanonicalTree(lengthPretreeLengths);
    const lengthLengths = this.readTreeLengths(
      reader,
      lengthPretree,
      lengthCount,
      this.prevLengthLengths,
    );
    this.prevLengthLengths = [...lengthLengths];

    return {
      literalTree: Huffman.createCanonicalTree(literalLengths),
      matchTree: Huffman.createCanonicalTree([]), // LZX 不使用独立 matchTree
      lengthTree: Huffman.createCanonicalTree(lengthLengths),
    };
  }

  /**
   * 读取预树长度
   * @param reader 位读取器
   * @returns 预树长度数组
   */
  private readPretreeLengths(reader: BitReader): number[] {
    const lengths: number[] = [];

    for (let i = 0; i < LZXDecoder.PRETREE_NUM_ELEMENTS; i++) {
      lengths.push(reader.read(4));
    }

    return lengths;
  }

  /**
   * 读取树长度
   * @param reader 位读取器
   * @param pretree 预树，用于解码码长符号序列
   * @param count 要读取的长度数量
   * @param prevLengths 上一个块的树长度（delta 解码基准，首次为全零）
   * @returns 长度数组
   */
  private readTreeLengths(
    reader: BitReader,
    pretree: HuffmanTree | null,
    count: number,
    prevLengths: number[],
  ): number[] {
    const lengths: number[] = [];
    let i = 0;

    while (i < count) {
      const symbol = this.decodeSymbol(reader, pretree);

      if (symbol <= 16) {
        // Delta 解码：new_len = (prev_len - delta + 17) % 17
        // 首块 prev=0，后续块使用上一块的实际长度
        const prev = prevLengths[i] ?? 0;
        lengths.push((prev - symbol + 17) % 17);
        i++;
      } else if (symbol === 17) {
        // 重复零长度 (4~19 个零)
        const zeros = reader.read(4) + 4;
        for (let j = 0; j < zeros && i < count; j++, i++) {
          lengths.push(0);
        }
      } else if (symbol === 18) {
        // 重复零长度 (20~51 个零)
        const zeros = reader.read(5) + 20;
        for (let j = 0; j < zeros && i < count; j++, i++) {
          lengths.push(0);
        }
      } else if (symbol === 19) {
        // 重复某长度 4 或 5 次：
        // 先读 1 bit extra，再从预树解码参考符号并 delta 解码得到实际长度
        const extra = reader.read(1);
        const s = this.decodeSymbol(reader, pretree);
        const prev = prevLengths[i] ?? 0;
        const len = (prev - s + 17) % 17;
        const repeats = 4 + extra;
        for (let j = 0; j < repeats && i < count; j++, i++) {
          lengths.push(len);
        }
      } else {
        // 不应出现 symbol > 19（预树有效时不可能），但加防护避免死循环
        throw new Error(`无效的预树符号: ${symbol}`);
      }
    }

    return lengths;
  }

  /**
   * 解码霍夫曼符号
   * @param reader 位读取器
   * @param tree 霍夫曼树
   * @returns 解码的符号
   */
  private decodeSymbol(reader: BitReader, tree: HuffmanTree | null): number {
    if (!tree || tree.symbols.length === 0) {
      return reader.read(8);
    }

    let code = 0;
    let length = 0;

    while (length < 16) {
      if (!reader.hasMore()) {
        throw new Error('解码霍夫曼符号时遇到数据结尾');
      }

      const bit = reader.read(1);
      code = (code << 1) | bit;
      length++;

      for (let i = 0; i < tree.codes.length; i++) {
        if (tree.lengths[i] === length && tree.codes[i] === code) {
          return tree.symbols[i]!;
        }
      }
    }

    throw new Error('无效的霍夫曼编码');
  }

  /**
   * 解码匹配信息（含 R0/R1/R2 最近偏移缓存）
   * @param reader 位读取器
   * @param symbol 匹配符号
   * @returns 匹配信息
   */
  private decodeMatch(
    reader: BitReader,
    symbol: number,
  ): { offset: number; length: number } {
    // 计算位置槽和长度头
    // LZX 规范：主树中每个位置槽占 8 个符号（步幅 = 8）
    //   调整后符号 = positionSlot × 8 + lengthHeader
    //   lengthHeader 0-6: 内联长度 = 2 + lengthHeader（值域 2-8）
    //   lengthHeader = 7:  长度哨兵，需从长度树读取额外长度
    const adjustedSymbol = symbol - LZXDecoder.NUM_CHARS;
    const POS_SLOT_STRIDE = 8; // 每个位置槽的步幅（非 NUM_PRIMARY_LENGTHS=7）
    const positionSlot = Math.floor(adjustedSymbol / POS_SLOT_STRIDE);
    const lengthHeader = adjustedSymbol % POS_SLOT_STRIDE;

    // 解码匹配长度
    let matchLength: number;
    if (lengthHeader === 7) {
      // 哨兵值 7：需要从长度树读取额外长度，matchLength = 9 + extra（值域 9-257）
      const extraLength = this.huffmanDecoder?.lengthTree
        ? this.decodeSymbol(reader, this.huffmanDecoder.lengthTree)
        : 0;
      matchLength = 9 + extraLength;
    } else {
      // lengthHeader 0-6：内联长度
      matchLength = lengthHeader + 2;
    }

    // 解码匹配偏移（基于位置槽和 R0/R1/R2 缓存）
    let matchOffset: number;
    if (positionSlot === 0) {
      // 重用 R0（最近使用的偏移）
      matchOffset = this.recentOffsets[0];
    } else if (positionSlot === 1) {
      // 重用 R1，并将 R1 提升为 R0
      matchOffset = this.recentOffsets[1];
      this.recentOffsets[1] = this.recentOffsets[0];
      this.recentOffsets[0] = matchOffset;
    } else if (positionSlot === 2) {
      // 重用 R2，并将 R2 提升为 R0
      matchOffset = this.recentOffsets[2];
      this.recentOffsets[2] = this.recentOffsets[1];
      this.recentOffsets[1] = this.recentOffsets[0];
      this.recentOffsets[0] = matchOffset;
    } else {
      // 计算额外位数和基值（基于位置槽，参照 LZX 规范 lzx_position_base 表）
      // 公式：extraBits = max(0, floor(slot/2) - 1)
      //       baseOffset = (2 + (slot & 1)) << extraBits
      // 验证：slot3→3, slot4→4, slot5→6, slot6→8, slot7→12, slot8→16, slot9→24 ✓
      const extraBits = Math.max(0, Math.floor(positionSlot / 2) - 1);
      const baseOffset = (2 + (positionSlot & 1)) << extraBits;

      if (extraBits > 3 && this.alignedTree) {
        // 对齐块：高位从位流读取，低3位从对齐树解码
        const highBits = reader.read(extraBits - 3);
        const lowBits = this.decodeSymbol(reader, this.alignedTree);
        matchOffset = baseOffset + (highBits << 3) + lowBits;
      } else if (extraBits === 3 && this.alignedTree) {
        // 对齐块：全部3位从对齐树解码
        matchOffset = baseOffset + this.decodeSymbol(reader, this.alignedTree);
      } else if (extraBits > 0) {
        matchOffset = baseOffset + reader.read(extraBits);
      } else {
        matchOffset = baseOffset;
      }

      // 更新 R2 ← R1, R1 ← R0, R0 ← matchOffset
      this.recentOffsets[2] = this.recentOffsets[1];
      this.recentOffsets[1] = this.recentOffsets[0];
      this.recentOffsets[0] = matchOffset;
    }

    return { offset: Math.max(1, matchOffset), length: matchLength };
  }

  /**
   * 重置解码器状态
   */
  private reset(): void {
    this.window.reset();
    this.huffmanDecoder = null;
    this.alignedTree = null;
    // LZX 规范：重置时清空树历史长度（下一块重新从全零基准 delta 解码）
    this.prevMainLengths = [];
    this.prevLengthLengths = [];
    // LZX 规范：R0/R1/R2 初始值均为 1
    this.recentOffsets = [1, 1, 1];
  }

  /**
   * 获取解码器状态信息
   * @returns 状态信息字符串
   */
  getStatus(): string {
    return [
      `窗口大小: ${this.windowSize} 字节`,
      `重置间隔: ${this.resetInterval}`,
      this.window.getStatus(),
    ].join('\n');
  }

  /**
   * 验证解码器配置
   * @returns 验证结果
   */
  validate(): boolean {
    return (
      this.windowSize > 0 &&
      this.resetInterval > 0 &&
      this._resetProcessor !== undefined
    );
  }

  /**
   * 获取对齐元素数量
   */
  static get ALIGNED_NUM_ELEMENTS(): number {
    return LZXDecoder._ALIGNED_NUM_ELEMENTS;
  }
}
