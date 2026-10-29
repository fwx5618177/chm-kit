import type { LZXConfig } from '../core/types';

export const LZX_FRAME_SIZE = 0x8000;

type RecentOffsets = [number, number, number];
type Token = number | { length: number; distance: number };

/** LZX bits are MSB-first inside little-endian 16-bit words. */
class WordWriter {
  private readonly bytes: number[] = [];
  private word = 0;
  private used = 0;

  write(value: number, bits: number): void {
    while (bits > 0) {
      const take = Math.min(16 - this.used, bits);
      bits -= take;
      this.word = (this.word << take) | ((value >>> bits) & (2 ** take - 1));
      this.used += take;
      if (this.used === 16) {
        this.bytes.push(this.word & 0xff, this.word >>> 8);
        this.word = this.used = 0;
      }
    }
  }

  finish(): Buffer {
    if (this.used) this.write(0, 16 - this.used);
    return Buffer.from(this.bytes);
  }
}

/** A balanced, complete canonical tree: no decoder-specific empty-tree cases. */
class FixedTree {
  readonly lengths: Uint8Array;
  private readonly codes: Uint16Array;

  constructor(count: number) {
    const bits = Math.floor(Math.log2(count));
    const shortCount = 2 ** (bits + 1) - count;
    this.lengths = new Uint8Array(count).fill(bits + 1);
    this.lengths.fill(bits, 0, shortCount);
    this.codes = new Uint16Array(count);
    let shortCode = 0;
    let longCode = shortCount * 2;
    for (let symbol = 0; symbol < count; symbol++) {
      this.codes[symbol] = symbol < shortCount ? shortCode++ : longCode++;
    }
  }

  write(writer: WordWriter, symbol: number): void {
    writer.write(this.codes[symbol]!, this.lengths[symbol]!);
  }
}

const PRETREE = new FixedTree(20);
const LENGTH_TREE = new FixedTree(249);

/** Bounded hash chains retain dictionary history even when a frame is stored. */
class MatchFinder {
  private readonly heads = new Float64Array(0x10000).fill(-1);
  private readonly previous: Float64Array;
  private resetStart = 0;

  constructor(
    private readonly data: Uint8Array,
    private readonly windowSize: number,
    private readonly searchDepth: number,
  ) {
    this.previous = new Float64Array(windowSize);
  }

  reset(position: number): void {
    this.heads.fill(-1);
    this.resetStart = position;
  }

  private hash(position: number): number {
    const value =
      (this.data[position]! << 16) |
      (this.data[position + 1]! << 8) |
      this.data[position + 2]!;
    return (Math.imul(value, 0x1e35a7bd) >>> 16) & 0xffff;
  }

  private insert(position: number): void {
    if (position + 2 >= this.data.length) return;
    const hash = this.hash(position);
    this.previous[position % this.windowSize] = this.heads[hash]!;
    this.heads[hash] = position;
  }

  tokenize(start: number, end: number): Token[] {
    const tokens: Token[] = [];
    let position = start;
    while (position < end) {
      let bestLength = 0;
      let bestDistance = 0;
      const maximum = Math.min(257, end - position);
      if (maximum >= 3) {
        let candidate = this.heads[this.hash(position)]!;
        // LZX's final position slot reaches windowSize - 3, not windowSize.
        const minimum = Math.max(
          this.resetStart,
          position - this.windowSize + 3,
        );
        for (
          let searched = 0;
          candidate >= minimum && searched < this.searchDepth;
          searched++
        ) {
          if (
            this.data[candidate + bestLength] ===
            this.data[position + bestLength]
          ) {
            let length = 0;
            while (
              length < maximum &&
              this.data[candidate + length] === this.data[position + length]
            )
              length++;
            if (length > bestLength) {
              bestLength = length;
              bestDistance = position - candidate;
              if (length === maximum) break;
            }
          }
          const next = this.previous[candidate % this.windowSize]!;
          if (next >= candidate) break;
          candidate = next;
        }
      }
      if (bestLength >= 3) {
        tokens.push({ length: bestLength, distance: bestDistance });
        for (let index = 0; index < bestLength; index++)
          this.insert(position + index);
        position += bestLength;
      } else {
        tokens.push(this.data[position]!);
        this.insert(position++);
      }
    }
    return tokens;
  }
}

/**
 * Lossless LZX VERBATIM (type 1): greedy LZ77 plus complete canonical Huffman
 * trees. Each frame falls back to type 3 stored blocks if they are smaller.
 * Level 0 is stored-only; levels 1–9 control bounded hash-chain search depth.
 */
export class LZXEncoder {
  private readonly windowSize: number;
  private readonly resetInterval: number;
  private readonly compressionLevel: number;
  private readonly mainTree: FixedTree;
  private readonly positionBases: number[] = [];
  private readonly extraBits: number[] = [];

  constructor(config: LZXConfig = {}) {
    this.windowSize = config.windowSize ?? LZX_FRAME_SIZE;
    this.resetInterval = config.resetInterval ?? LZX_FRAME_SIZE;
    this.compressionLevel = config.compressionLevel ?? 6;
    if (
      !Number.isInteger(this.windowSize) ||
      this.windowSize < LZX_FRAME_SIZE ||
      this.windowSize > 0x200000 ||
      (this.windowSize & (this.windowSize - 1)) !== 0
    ) {
      throw new Error(
        'LZX windowSize must be a power of two from 32 KiB to 2 MiB',
      );
    }
    if (
      !Number.isSafeInteger(this.resetInterval) ||
      this.resetInterval <= 0 ||
      this.resetInterval % LZX_FRAME_SIZE !== 0
    ) {
      throw new Error(
        'LZX resetInterval must be a positive multiple of 32 KiB',
      );
    }
    if (
      !Number.isInteger(this.compressionLevel) ||
      this.compressionLevel < 0 ||
      this.compressionLevel > 9
    ) {
      throw new Error('LZX compressionLevel must be an integer from 0 to 9');
    }
    const slots = [30, 32, 34, 36, 38, 42, 50][
      Math.log2(this.windowSize) - 15
    ]!;
    this.mainTree = new FixedTree(256 + slots * 8);
    let base = 0;
    for (let slot = 0; slot < slots; slot++) {
      const extra = slot < 4 ? 0 : Math.min(17, Math.floor(slot / 2) - 1);
      this.positionBases.push(base);
      this.extraBits.push(extra);
      base += 2 ** extra;
    }
  }

  compress(inputBuffer: Uint8Array): {
    compressedData: Buffer;
    resetTable: Buffer;
    uncompressedSize: number;
    compressedSize: number;
  } {
    const chunks: Buffer[] = [];
    const offsets: number[] = [];
    let compressedSize = 0;
    // CHM decoders consume complete 32 KiB frames, including the final one.
    // ResetTable retains the logical length, so zero fill is never file content.
    const paddedSize =
      Math.ceil(inputBuffer.length / LZX_FRAME_SIZE) * LZX_FRAME_SIZE;
    const data = Buffer.alloc(paddedSize);
    data.set(inputBuffer);
    const finder =
      this.compressionLevel === 0
        ? undefined
        : new MatchFinder(
            data,
            this.windowSize,
            Math.min(256, 2 ** this.compressionLevel),
          );
    const previousMain = new Uint8Array(this.mainTree.lengths.length);
    const previousLength = new Uint8Array(LENGTH_TREE.lengths.length);
    let recent: RecentOffsets = [1, 1, 1];
    for (let position = 0; position < paddedSize; position += LZX_FRAME_SIZE) {
      offsets.push(compressedSize);
      const length = Math.min(LZX_FRAME_SIZE, inputBuffer.length - position);
      const reset = position % this.resetInterval === 0;
      if (reset) {
        finder?.reset(position);
        previousMain.fill(0);
        previousLength.fill(0);
        recent = [1, 1, 1];
      }
      const stored = this.storedFrame(
        data.subarray(position, position + length),
        reset,
        recent,
      );
      let selected = stored;
      if (finder) {
        const tokens = finder.tokenize(position, position + LZX_FRAME_SIZE);
        const encoded = this.verbatimFrame(
          tokens,
          reset,
          previousMain,
          previousLength,
          recent,
        );
        if (encoded.data.length < stored.length) {
          selected = encoded.data;
          recent = encoded.recent;
          previousMain.set(this.mainTree.lengths);
          previousLength.set(LENGTH_TREE.lengths);
        }
      }
      chunks.push(selected);
      compressedSize += selected.length;
    }

    const resetTable = Buffer.alloc(0x28 + offsets.length * 8);
    resetTable.writeUInt32LE(2, 0);
    resetTable.writeUInt32LE(offsets.length, 4);
    resetTable.writeUInt32LE(8, 8);
    resetTable.writeUInt32LE(0x28, 12);
    resetTable.writeBigUInt64LE(BigInt(inputBuffer.length), 16);
    resetTable.writeBigUInt64LE(BigInt(compressedSize), 24);
    resetTable.writeBigUInt64LE(BigInt(LZX_FRAME_SIZE), 32);
    offsets.forEach((offset, index) =>
      resetTable.writeBigUInt64LE(BigInt(offset), 0x28 + index * 8),
    );
    return {
      compressedData: Buffer.concat(chunks, compressedSize),
      resetTable,
      uncompressedSize: inputBuffer.length,
      compressedSize,
    };
  }

  private writeTree(
    writer: WordWriter,
    previous: Uint8Array,
    lengths: Uint8Array,
    start: number,
    end: number,
  ): void {
    for (const length of PRETREE.lengths) writer.write(length, 4);
    for (let symbol = start; symbol < end; symbol++) {
      PRETREE.write(writer, (previous[symbol]! - lengths[symbol]! + 17) % 17);
    }
  }

  private verbatimFrame(
    tokens: readonly Token[],
    reset: boolean,
    previousMain: Uint8Array,
    previousLength: Uint8Array,
    recent: RecentOffsets,
  ): { data: Buffer; recent: RecentOffsets } {
    const writer = new WordWriter();
    if (reset) writer.write(0, 1); // No Intel E8 preprocessing.
    writer.write(1, 3);
    writer.write(LZX_FRAME_SIZE, 24);
    this.writeTree(writer, previousMain, this.mainTree.lengths, 0, 256);
    this.writeTree(
      writer,
      previousMain,
      this.mainTree.lengths,
      256,
      this.mainTree.lengths.length,
    );
    this.writeTree(
      writer,
      previousLength,
      LENGTH_TREE.lengths,
      0,
      LENGTH_TREE.lengths.length,
    );
    let nextRecent: RecentOffsets = [...recent];
    for (const token of tokens) {
      if (typeof token === 'number') {
        this.mainTree.write(writer, token);
        continue;
      }
      // Explicit position slots avoid cache-selection heuristics, but LZX still
      // requires all three repeat offsets to advance after every explicit match.
      let slot = this.positionBases.length - 1;
      while (slot > 3 && token.distance < this.positionBases[slot]! - 2) slot--;
      const lengthCode = token.length - 2;
      this.mainTree.write(writer, 256 + slot * 8 + Math.min(lengthCode, 7));
      if (lengthCode >= 7) LENGTH_TREE.write(writer, token.length - 9);
      writer.write(
        token.distance - (this.positionBases[slot]! - 2),
        this.extraBits[slot]!,
      );
      nextRecent = [token.distance, nextRecent[0], nextRecent[1]];
    }
    return { data: writer.finish(), recent: nextRecent };
  }

  private storedFrame(
    data: Uint8Array,
    reset: boolean,
    recent: RecentOffsets,
  ): Buffer {
    const blocks = [this.storedBlock(data, data.length, reset, recent)];
    if (data.length < LZX_FRAME_SIZE) {
      blocks.push(
        this.storedBlock(
          new Uint8Array(0),
          LZX_FRAME_SIZE - data.length,
          false,
          recent,
        ),
      );
    }
    return Buffer.concat(blocks);
  }

  private storedBlock(
    data: Uint8Array,
    length: number,
    reset: boolean,
    recent: RecentOffsets,
  ): Buffer {
    const writer = new WordWriter();
    if (reset) writer.write(0, 1);
    writer.write(3, 3);
    writer.write(length, 24);
    const block = Buffer.alloc(16 + length + (length & 1));
    writer.finish().copy(block);
    recent.forEach((distance, index) =>
      block.writeUInt32LE(distance, 4 + index * 4),
    );
    block.set(data, 16);
    // An odd stored block has a raw zero pad byte before the next block.
    return block;
  }

  getConfig(): LZXConfig {
    return {
      windowSize: this.windowSize,
      resetInterval: this.resetInterval,
      compressionLevel: this.compressionLevel,
    };
  }
}
