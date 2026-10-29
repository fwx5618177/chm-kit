import type { LZXCHeader } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { SlidingWindow } from './sliding-window';
import { LZXBitReader } from './lzx-bit-reader';

/**
 * A bounded canonical decoder. Like 7-Zip and libmspack, require full trees;
 * only the secondary length tree may be empty (and then cannot be used).
 */
class CanonicalTree {
  private readonly counts = new Uint16Array(17);
  private readonly firstCodes = new Uint32Array(17);
  private readonly firstSymbols = new Uint16Array(17);
  private readonly symbols: number[] = [];
  private maxLength = 0;

  constructor(lengths: readonly number[], allowEmpty = false) {
    for (const length of lengths) {
      if (!Number.isInteger(length) || length < 0 || length > 16) {
        throw new Error('Invalid LZX Huffman code length');
      }
      if (length !== 0) {
        this.counts[length]!++;
        this.maxLength = Math.max(this.maxLength, length);
      }
    }
    if (this.maxLength === 0) {
      if (allowEmpty) return;
      throw new Error('Empty LZX Huffman tree');
    }
    let free = 1;
    let code = 0;
    for (let length = 1; length <= 16; length++) {
      free = free * 2 - this.counts[length]!;
      if (free < 0) throw new Error('Oversubscribed LZX Huffman tree');
      code = (code + (this.counts[length - 1] ?? 0)) * 2;
      this.firstCodes[length] = code;
      this.firstSymbols[length] = this.symbols.length;
      for (let symbol = 0; symbol < lengths.length; symbol++) {
        if (lengths[symbol] === length) this.symbols.push(symbol);
      }
    }
    if (free !== 0) throw new Error('Incomplete LZX Huffman tree');
  }

  decode(reader: LZXBitReader): number {
    let code = 0;
    for (let length = 1; length <= this.maxLength; length++) {
      code = code * 2 + reader.read(1);
      const index = code - this.firstCodes[length]!;
      if (index >= 0 && index < this.counts[length]!) {
        return this.symbols[this.firstSymbols[length]! + index]!;
      }
    }
    throw new Error('Invalid or empty LZX Huffman code');
  }
}

/** Standard (non-DELTA) LZX, with 32 KiB frames and byte-valued CHM resets. */
export class LZXDecoder {
  static readonly FRAME_SIZE = 0x8000;
  // A corrupt size must not cause an eager multi-gigabyte allocation. Large
  // resources can be reconstructed in independent reset-aligned batches.
  static readonly MAX_OUTPUT_SIZE = 256 * 1024 * 1024;
  static readonly ALIGNED_NUM_ELEMENTS = 8;

  private readonly window: SlidingWindow;
  private readonly windowSize: number;
  private readonly resetInterval: number;
  private readonly mainLengths: number[];
  private readonly lengthLengths = new Array<number>(249).fill(0);
  private readonly positionBases: number[] = [];
  private readonly extraBits: number[] = [];
  private mainTree: CanonicalTree | null = null;
  private lengthTree: CanonicalTree | null = null;
  private alignedTree: CanonicalTree | null = null;
  private recentOffsets: [number, number, number] = [1, 1, 1];
  private headerRead = false;
  private intelFileSize = 0;
  private intelStarted = false;
  private blockType = 0;
  private blockRemaining = 0;
  private oddRawPadding = false;
  private historySize = 0;

  constructor(lzxcHeader: LZXCHeader) {
    this.windowSize = lzxcHeader.windowSize;
    this.resetInterval = lzxcHeader.resetInterval;
    if (!this.validate())
      throw new Error('Invalid LZX window size or reset interval');
    this.window = new SlidingWindow(this.windowSize);
    const slots = [30, 32, 34, 36, 38, 42, 50][
      Math.log2(this.windowSize) - 15
    ]!;
    this.mainLengths = new Array<number>(256 + slots * 8).fill(0);
    let base = 0;
    for (let slot = 0; slot < slots; slot++) {
      const extra = slot < 4 ? 0 : Math.min(17, Math.floor(slot / 2) - 1);
      this.positionBases.push(base);
      this.extraBits.push(extra);
      base += 2 ** extra;
    }
  }

  /**
   * Compatibility entry point for a contiguous LZX stream. The existing byte
   * reader must be byte-aligned; its bytes are read in LZX word order here.
   * Each call starts a new stream. Success advances the supplied reader;
   * failure leaves its cursor unchanged and clears the decoder. A partial
   * match at the requested endpoint is allowed, but never across a 32 KiB
   * boundary. For Intel-filtered prefixes use decodeFrames with lastFrameSize.
   */
  decode(reader: BitReader, size: number): Buffer {
    this.reset();
    this.checkOutputSize(size);
    if (
      reader.bitPosition !== 0 ||
      !Number.isSafeInteger(reader.position) ||
      reader.position < 0 ||
      reader.position > reader.buffer.length
    ) {
      throw new Error('LZX input reader must be byte-aligned and in bounds');
    }
    const input = new LZXBitReader(reader.buffer.subarray(reader.position));
    const chunks: Buffer[] = [];
    try {
      for (let position = 0, frame = 0; position < size; frame++) {
        this.beginFrame(frame);
        const length = Math.min(LZXDecoder.FRAME_SIZE, size - position);
        chunks.push(this.readFrame(input, length, frame));
        position += length;
      }
      const output = Buffer.concat(chunks, size);
      reader.position += input.position;
      return output;
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  /**
   * Decode frame buffers from the nearest reset point. startFrame is the
   * absolute 32 KiB frame index, not an index into frames, and must be reset
   * aligned. outputSize is the requested output prefix. For a prefix ending
   * inside a physical frame, supply that frame's actual unpacked length as
   * lastFrameSize (32768 for CHM, including CHM's final padded frame). That
   * whole frame is decoded and Intel-filtered before returning the prefix.
   * Without lastFrameSize, the requested end is treated as the physical end
   * for Intel tail exclusion, retaining support for short CAB frames.
   * State persists within this call, never between calls; errors clear it.
   */
  decodeFrames(
    frames: readonly Uint8Array[],
    outputSize: number,
    startFrame = 0,
    lastFrameSize?: number,
  ): Buffer {
    this.reset();
    this.checkOutputSize(outputSize);
    const resetFrames = this.resetInterval / LZXDecoder.FRAME_SIZE;
    if (
      !Number.isSafeInteger(startFrame) ||
      startFrame < 0 ||
      startFrame >
        Math.floor(Number.MAX_SAFE_INTEGER / LZXDecoder.FRAME_SIZE) -
          frames.length ||
      startFrame % resetFrames !== 0
    ) {
      throw new Error(
        'LZX startFrame must be an absolute reset-aligned frame index',
      );
    }
    if (frames.length !== Math.ceil(outputSize / LZXDecoder.FRAME_SIZE)) {
      throw new Error('LZX frame count does not match output size');
    }
    const lastRequested =
      outputSize === 0
        ? 0
        : outputSize - (frames.length - 1) * LZXDecoder.FRAME_SIZE;
    const lastPhysical = lastFrameSize ?? lastRequested;
    if (
      !Number.isInteger(lastPhysical) ||
      lastPhysical < lastRequested ||
      lastPhysical > LZXDecoder.FRAME_SIZE ||
      (outputSize === 0 && lastPhysical !== 0)
    ) {
      throw new Error('Invalid LZX lastFrameSize');
    }
    const chunks: Buffer[] = [];
    let remaining = outputSize;
    try {
      for (let i = 0; i < frames.length; i++) {
        const frame = startFrame + i;
        this.beginFrame(frame);
        const input = new LZXBitReader(frames[i]!);
        const length = Math.min(LZXDecoder.FRAME_SIZE, remaining);
        const physical =
          i === frames.length - 1 ? lastPhysical : LZXDecoder.FRAME_SIZE;
        const decoded = this.readFrame(
          input,
          physical,
          frame,
          lastFrameSize === undefined,
        );
        chunks.push(decoded.subarray(0, length));
        remaining -= length;
      }
      return Buffer.concat(chunks, outputSize);
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  /**
   * Lazily decode a reset-aligned sequence, retaining only the dictionary and
   * current physical frame. Unlike decodeFrames, outputSize is not an aggregate
   * allocation limit. The source must contain exactly ceil(outputSize / 32768)
   * frames; its count and any later errors are checked as iteration advances.
   * Prefix/physical-tail semantics match decodeFrames. Do not interleave other
   * operations on this decoder while iterating. Exhaustion, return() and errors
   * close the source and clear stream state; merely abandoning an iterator does
   * not run its cleanup.
   */
  *iterateFrames(
    frames: Iterable<Uint8Array>,
    outputSize: number,
    startFrame = 0,
    lastFrameSize?: number,
  ): Generator<Buffer> {
    this.reset();
    if (!Number.isSafeInteger(outputSize) || outputSize < 0)
      throw new Error('Invalid LZX output size');
    const count = Math.ceil(outputSize / LZXDecoder.FRAME_SIZE);
    const resetFrames = this.resetInterval / LZXDecoder.FRAME_SIZE;
    if (
      !Number.isSafeInteger(startFrame) ||
      startFrame < 0 ||
      startFrame >
        Math.floor(Number.MAX_SAFE_INTEGER / LZXDecoder.FRAME_SIZE) - count ||
      startFrame % resetFrames !== 0
    )
      throw new Error(
        'LZX startFrame must be an absolute reset-aligned frame index',
      );
    const lastRequested =
      count === 0 ? 0 : outputSize - (count - 1) * LZXDecoder.FRAME_SIZE;
    const lastPhysical = lastFrameSize ?? lastRequested;
    if (
      !Number.isInteger(lastPhysical) ||
      lastPhysical < lastRequested ||
      lastPhysical > LZXDecoder.FRAME_SIZE ||
      (count === 0 && lastPhysical !== 0)
    )
      throw new Error('Invalid LZX lastFrameSize');
    let index = 0;
    try {
      for (const bytes of frames) {
        if (index >= count)
          throw new Error('LZX frame count does not match output size');
        const frame = startFrame + index;
        this.beginFrame(frame);
        const requested =
          index === count - 1 ? lastRequested : LZXDecoder.FRAME_SIZE;
        const physical =
          index === count - 1 ? lastPhysical : LZXDecoder.FRAME_SIZE;
        const decoded = this.readFrame(
          new LZXBitReader(bytes),
          physical,
          frame,
          lastFrameSize === undefined,
        );
        index++;
        yield decoded.subarray(0, requested);
      }
      if (index !== count)
        throw new Error('LZX frame count does not match output size');
    } finally {
      this.reset();
    }
  }

  /** Clear all stream state, including the dictionary and delta code lengths. */
  reset(): void {
    this.window.reset();
    this.mainLengths.fill(0);
    this.lengthLengths.fill(0);
    this.mainTree = this.lengthTree = this.alignedTree = null;
    this.recentOffsets = [1, 1, 1];
    this.headerRead = false;
    this.intelFileSize = 0;
    this.intelStarted = false;
    this.blockType = 0;
    this.blockRemaining = 0;
    this.oddRawPadding = false;
    this.historySize = 0;
  }

  validate(): boolean {
    return (
      Number.isInteger(this.windowSize) &&
      this.windowSize >= 0x8000 &&
      this.windowSize <= 0x200000 &&
      Number.isInteger(Math.log2(this.windowSize)) &&
      Number.isSafeInteger(this.resetInterval) &&
      this.resetInterval > 0 &&
      this.resetInterval % LZXDecoder.FRAME_SIZE === 0
    );
  }

  getStatus(): string {
    return [
      `窗口大小: ${this.windowSize} 字节`,
      `重置间隔: ${this.resetInterval} 字节`,
      this.window.getStatus(),
    ].join('\n');
  }

  private checkOutputSize(size: number): void {
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > LZXDecoder.MAX_OUTPUT_SIZE
    ) {
      throw new Error(
        `Invalid LZX output size (maximum ${LZXDecoder.MAX_OUTPUT_SIZE} bytes)`,
      );
    }
  }

  private beginFrame(frame: number): void {
    if (frame % (this.resetInterval / LZXDecoder.FRAME_SIZE) === 0) {
      if (this.blockRemaining !== 0)
        throw new Error('LZX block crosses a reset boundary');
      this.reset();
    }
  }

  private readFrame(
    reader: LZXBitReader,
    size: number,
    frame: number,
    allowPrefixMatch = true,
  ): Buffer {
    if (!this.headerRead) {
      if (reader.read(1)) {
        this.intelFileSize = (reader.read(16) * 0x10000 + reader.read(16)) | 0;
      }
      this.headerRead = true;
    }
    const output = Buffer.alloc(size);
    let position = 0;
    while (position < size) {
      if (this.blockRemaining === 0) this.readBlockHeader(reader);
      if (this.blockType === 3) {
        const count = Math.min(this.blockRemaining, size - position);
        const bytes = reader.readRaw(count);
        output.set(bytes, position);
        for (const byte of bytes) this.writeByte(byte);
        position += count;
        this.blockRemaining -= count;
        continue;
      }
      const symbol = this.mainTree!.decode(reader);
      if (symbol < 256) {
        output[position++] = symbol;
        this.writeByte(symbol);
        this.blockRemaining--;
      } else {
        const { offset, length } = this.readMatch(reader, symbol);
        const frameLimit = allowPrefixMatch ? LZXDecoder.FRAME_SIZE : size;
        if (length > this.blockRemaining || length > frameLimit - position) {
          throw new Error('LZX match exceeds block or frame boundary');
        }
        if (offset <= 0 || offset > this.historySize) {
          throw new Error('LZX match offset exceeds available history');
        }
        for (let i = 0; i < length; i++) {
          const byte = this.window.readBackByte(offset);
          if (position < size) output[position] = byte;
          position++;
          this.writeByte(byte);
        }
        this.blockRemaining -= length;
      }
    }
    reader.alignFrame();
    // Padding belongs to the raw block, not to the following compressed tree.
    // Consume it here if it is in this frame, otherwise defer until next header.
    if (
      this.blockRemaining === 0 &&
      this.oddRawPadding &&
      reader.remainingBytes > 0
    ) {
      reader.readRaw(1);
      this.oddRawPadding = false;
    }
    this.translateIntel(output, frame);
    return output;
  }

  private writeByte(byte: number): void {
    this.window.writeByte(byte);
    this.historySize = Math.min(this.windowSize, this.historySize + 1);
  }

  private readBlockHeader(reader: LZXBitReader): void {
    if (this.oddRawPadding) {
      reader.readRaw(1);
      this.oddRawPadding = false;
    }
    this.blockType = reader.read(3);
    this.blockRemaining = reader.read(16) * 256 + reader.read(8);
    if (this.blockRemaining === 0) throw new Error('Zero-length LZX block');
    if (this.blockType === 3) {
      this.intelStarted = true;
      reader.alignUncompressed();
      this.recentOffsets = [
        reader.readUInt32LE(),
        reader.readUInt32LE(),
        reader.readUInt32LE(),
      ];
      if (
        this.recentOffsets.some(
          offset => offset === 0 || offset > this.windowSize,
        )
      ) {
        throw new Error('Invalid LZX uncompressed repeated offset');
      }
      this.oddRawPadding = (this.blockRemaining & 1) !== 0;
      return;
    }
    if (this.blockType !== 1 && this.blockType !== 2) {
      throw new Error(`Invalid LZX block type: ${this.blockType}`);
    }
    this.alignedTree =
      this.blockType === 2
        ? new CanonicalTree(Array.from({ length: 8 }, () => reader.read(3)))
        : null;
    // These are two separate length ranges, each with its own pretree.
    this.readLengths(reader, this.mainLengths, 0, 256);
    this.readLengths(reader, this.mainLengths, 256, this.mainLengths.length);
    this.mainTree = new CanonicalTree(this.mainLengths);
    if (this.mainLengths[0xe8] !== 0) this.intelStarted = true;
    this.readLengths(reader, this.lengthLengths, 0, 249);
    this.lengthTree = new CanonicalTree(this.lengthLengths, true);
  }

  private readLengths(
    reader: LZXBitReader,
    lengths: number[],
    first: number,
    end: number,
  ): void {
    const pretree = new CanonicalTree(
      Array.from({ length: 20 }, () => reader.read(4)),
    );
    let position = first;
    while (position < end) {
      const symbol = pretree.decode(reader);
      if (symbol <= 16) {
        lengths[position] = (lengths[position]! - symbol + 17) % 17;
        position++;
        continue;
      }
      let count: number;
      let value = 0;
      if (symbol === 17) {
        count = reader.read(4) + 4;
      } else if (symbol === 18) {
        count = reader.read(5) + 20;
      } else {
        count = reader.read(1) + 4;
        const delta = pretree.decode(reader);
        if (delta > 16)
          throw new Error('Invalid LZX repeated code-length delta');
        value = (lengths[position]! - delta + 17) % 17;
      }
      if (count > end - position)
        throw new Error('LZX code-length run exceeds tree range');
      lengths.fill(value, position, position + count);
      position += count;
    }
  }

  private readMatch(
    reader: LZXBitReader,
    symbol: number,
  ): { offset: number; length: number } {
    const match = symbol - 256;
    const slot = Math.floor(match / 8);
    let length = match & 7;
    if (length === 7) length += this.lengthTree!.decode(reader);
    length += 2;
    let offset: number;
    if (slot < 3) {
      offset = this.recentOffsets[slot]!;
      // R2 swaps with R0; R1 is NOT shifted when selecting slot 2.
      if (slot !== 0) {
        this.recentOffsets[slot] = this.recentOffsets[0];
        this.recentOffsets[0] = offset;
      }
    } else {
      const extra = this.extraBits[slot]!;
      offset = this.positionBases[slot]! - 2;
      if (this.blockType === 2 && extra >= 3) {
        offset += reader.read(extra - 3) * 8 + this.alignedTree!.decode(reader);
      } else {
        offset += reader.read(extra);
      }
      this.recentOffsets = [
        offset,
        this.recentOffsets[0],
        this.recentOffsets[1],
      ];
    }
    return { offset, length };
  }

  private translateIntel(output: Buffer, frame: number): void {
    // CHM resets start independent LZX streams, including their Intel header
    // and translation origin (7-Zip/CHMLib). startFrame remains absolute only
    // for reset scheduling; a seek to any reset must produce identical bytes.
    const frameInReset = frame % (this.resetInterval / LZXDecoder.FRAME_SIZE);
    if (
      !this.intelStarted ||
      !this.intelFileSize ||
      frameInReset >= 32768 ||
      output.length <= 10
    )
      return;
    const framePosition = frameInReset * LZXDecoder.FRAME_SIZE;
    for (let i = 0; i < output.length - 10; i++) {
      if (output[i] !== 0xe8) continue;
      const position = framePosition + i;
      const absolute = output.readInt32LE(i + 1);
      if (absolute >= -position && absolute < this.intelFileSize) {
        const relative =
          absolute >= 0 ? absolute - position : absolute + this.intelFileSize;
        output.writeInt32LE(relative | 0, i + 1);
      }
      i += 4;
    }
  }
}
