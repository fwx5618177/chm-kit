import type { LZXConfig } from '../core/types';
import { CanonicalHuffman } from './canonical-huffman';

export interface LZXEncoderOptions extends LZXConfig {
  /** Power-of-two block size from 256 to 32768; CHM frames stay 32768 bytes. */
  blockSize?: number;
}

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

  get bitLength(): number {
    return this.bytes.length * 8 + this.used;
  }

  clone(): WordWriter {
    const copy = new WordWriter();
    copy.bytes.push(...this.bytes);
    copy.word = this.word;
    copy.used = this.used;
    return copy;
  }

  raw(data: Uint8Array): void {
    // Raw blocks discard 1..16 bits, unlike frame alignment (0..15).
    this.write(0, 16 - this.used);
    for (const byte of data) this.bytes.push(byte);
  }

  finish(): Buffer {
    if (this.used) this.write(0, 16 - this.used);
    return Buffer.from(this.bytes);
  }
}

const LENGTH_TREE = CanonicalHuffman.fixed(249);

/** Bounded hash chains retain dictionary history even when a frame is stored. */
class MatchFinder {
  private readonly heads = new Float64Array(0x10000).fill(-1);
  private readonly previous: Float64Array;
  private resetStart = 0;

  constructor(
    private readonly data: Uint8Array,
    private readonly windowSize: number,
    private readonly searchDepth: number,
    private readonly paddedLength: number,
  ) {
    this.previous = new Float64Array(windowSize);
  }

  reset(position: number): void {
    this.heads.fill(-1);
    this.resetStart = position;
  }

  private byte(position: number): number {
    return this.data[position] ?? 0;
  }

  private hash(position: number): number {
    const value =
      (this.byte(position) << 16) |
      (this.byte(position + 1) << 8) |
      this.byte(position + 2);
    return (Math.imul(value, 0x1e35a7bd) >>> 16) & 0xffff;
  }

  private insert(position: number): void {
    if (position + 2 >= this.paddedLength) return;
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
            this.byte(candidate + bestLength) ===
            this.byte(position + bestLength)
          ) {
            let length = 0;
            while (
              length < maximum &&
              this.byte(candidate + length) === this.byte(position + length)
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
        tokens.push(this.byte(position));
        this.insert(position++);
      }
    }
    return tokens;
  }
}

/**
 * Lossless LZX with length-limited canonical trees and actual bit-cost selection.
 * 0: stored; 1: fixed VERBATIM; 2–3: also adaptive VERBATIM; 4–9: also ALIGNED.
 * Levels 1–9 search 2**level hash-chain candidates. Blocks never cross frames.
 */
export class LZXEncoder {
  private readonly windowSize: number;
  private readonly resetInterval: number;
  private readonly compressionLevel: number;
  private readonly mainTree: CanonicalHuffman;
  private readonly blockSize: number;
  private readonly positionBases: number[] = [];
  private readonly extraBits: number[] = [];

  constructor(config: LZXEncoderOptions = {}) {
    for (const key of [
      'windowSize',
      'resetInterval',
      'compressionLevel',
      'blockSize',
    ] as const) {
      if (config[key] !== undefined && typeof config[key] !== 'number')
        throw new Error(`LZX ${key} must be a number`);
    }
    this.windowSize = config.windowSize ?? LZX_FRAME_SIZE;
    this.resetInterval = config.resetInterval ?? LZX_FRAME_SIZE;
    this.compressionLevel = config.compressionLevel ?? 6;
    this.blockSize = config.blockSize ?? LZX_FRAME_SIZE;
    if (
      !Number.isInteger(this.blockSize) ||
      this.blockSize < 256 ||
      this.blockSize > LZX_FRAME_SIZE ||
      (this.blockSize & (this.blockSize - 1)) !== 0
    )
      throw new Error('LZX blockSize must be a power of two from 256 to 32768');
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
    this.mainTree = CanonicalHuffman.fixed(256 + slots * 8);
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
    // MatchFinder reads the final zero fill virtually. A long reset does not
    // require a reset-sized buffer, nor a padded copy of the complete input.
    const data = inputBuffer;
    const finder =
      this.compressionLevel === 0 || paddedSize === 0
        ? undefined
        : new MatchFinder(
            data,
            this.windowSize,
            2 ** this.compressionLevel,
            paddedSize,
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
      let writer = new WordWriter();
      if (reset) writer.write(0, 1); // No Intel E8 preprocessing.
      for (let offset = 0; offset < LZX_FRAME_SIZE; offset += this.blockSize) {
        const start = position + offset;
        const logicalLength = Math.max(
          0,
          Math.min(this.blockSize, length - offset),
        );
        let selected = writer.clone();
        if (logicalLength > 0) {
          this.storedBlock(
            selected,
            data.subarray(start, start + logicalLength),
            recent,
          );
        }
        if (logicalLength < this.blockSize) {
          this.storedBlock(
            selected,
            Buffer.alloc(this.blockSize - logicalLength),
            recent,
          );
        }
        let selectedMain: CanonicalHuffman | undefined;
        let selectedLength: CanonicalHuffman | undefined;
        if (finder) {
          const tokens = finder.tokenize(start, start + this.blockSize);
          const mainFrequencies = new Array<number>(
            this.mainTree.lengths.length,
          ).fill(0);
          const lengthFrequencies = new Array<number>(249).fill(0);
          const alignedFrequencies = new Array<number>(8).fill(0);
          for (const token of tokens) {
            if (typeof token === 'number') mainFrequencies[token]!++;
            else {
              const slot = this.slot(token.distance);
              mainFrequencies[
                256 + slot * 8 + Math.min(token.length - 2, 7)
              ]!++;
              if (token.length >= 9) lengthFrequencies[token.length - 9]!++;
              if (this.extraBits[slot]! >= 3)
                alignedFrequencies[
                  (token.distance - (this.positionBases[slot]! - 2)) & 7
                ]!++;
            }
          }
          const trees: [CanonicalHuffman, CanonicalHuffman][] = [
            [this.mainTree, LENGTH_TREE],
          ];
          if (this.compressionLevel >= 2)
            trees.push([
              CanonicalHuffman.fromFrequencies(mainFrequencies),
              CanonicalHuffman.fromFrequencies(lengthFrequencies),
            ]);
          const aligned =
            this.compressionLevel >= 4
              ? CanonicalHuffman.fromFrequencies(alignedFrequencies, 7)
              : undefined;
          for (const [main, secondary] of trees) {
            for (const alignment of aligned
              ? [undefined, aligned]
              : [undefined]) {
              const candidate = writer.clone();
              this.compressedBlock(
                candidate,
                tokens,
                main,
                secondary,
                alignment,
                previousMain,
                previousLength,
              );
              // Only the final block pays frame word padding. Rounding each
              // inner block separately discards sub-word ALIGNED savings.
              const last = offset + this.blockSize === LZX_FRAME_SIZE;
              const cost = (bits: number): number =>
                last ? Math.ceil(bits / 16) : bits;
              if (cost(candidate.bitLength) < cost(selected.bitLength)) {
                selected = candidate;
                selectedMain = main;
                selectedLength = secondary;
              }
            }
          }
          if (selectedMain) {
            previousMain.set(selectedMain.lengths);
            previousLength.set(selectedLength!.lengths);
            for (const token of tokens) {
              if (typeof token !== 'number')
                recent = [token.distance, recent[0], recent[1]];
            }
          }
        }
        writer = selected;
      }
      const frame = writer.finish();
      chunks.push(frame);
      compressedSize += frame.length;
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
    const operations: { symbol: number; extra?: number; bits?: number }[] = [];
    for (let symbol = start; symbol < end;) {
      let run = 0;
      if (lengths[symbol] === 0) {
        while (symbol + run < end && lengths[symbol + run] === 0 && run < 51)
          run++;
      }
      if (run >= 4) {
        const long = run >= 20;
        operations.push({
          symbol: long ? 18 : 17,
          extra: run - (long ? 20 : 4),
          bits: long ? 5 : 4,
        });
        symbol += run;
      } else {
        operations.push({
          symbol: (previous[symbol]! - lengths[symbol]! + 17) % 17,
        });
        symbol++;
      }
    }
    const frequencies = new Array<number>(20).fill(0);
    for (const operation of operations) frequencies[operation.symbol]!++;
    const pretree = CanonicalHuffman.fromFrequencies(frequencies, 15);
    for (const length of pretree.lengths) writer.write(length, 4);
    for (const operation of operations) {
      pretree.write(writer, operation.symbol);
      if (operation.bits) writer.write(operation.extra!, operation.bits);
    }
  }

  private slot(distance: number): number {
    let slot = this.positionBases.length - 1;
    while (slot > 3 && distance < this.positionBases[slot]! - 2) slot--;
    return slot;
  }

  private compressedBlock(
    writer: WordWriter,
    tokens: readonly Token[],
    main: CanonicalHuffman,
    secondary: CanonicalHuffman,
    aligned: CanonicalHuffman | undefined,
    previousMain: Uint8Array,
    previousLength: Uint8Array,
  ): void {
    writer.write(aligned ? 2 : 1, 3);
    writer.write(this.blockSize, 24);
    if (aligned) for (const length of aligned.lengths) writer.write(length, 3);
    this.writeTree(writer, previousMain, main.lengths, 0, 256);
    this.writeTree(
      writer,
      previousMain,
      main.lengths,
      256,
      main.lengths.length,
    );
    this.writeTree(
      writer,
      previousLength,
      secondary.lengths,
      0,
      secondary.lengths.length,
    );
    for (const token of tokens) {
      if (typeof token === 'number') {
        main.write(writer, token);
        continue;
      }
      // Explicit offsets keep tokenization independent of the selected trees.
      const slot = this.slot(token.distance);
      const lengthCode = token.length - 2;
      main.write(writer, 256 + slot * 8 + Math.min(lengthCode, 7));
      if (lengthCode >= 7) secondary.write(writer, token.length - 9);
      const suffix = token.distance - (this.positionBases[slot]! - 2);
      const extra = this.extraBits[slot]!;
      if (aligned && extra >= 3) {
        writer.write(suffix >>> 3, extra - 3);
        aligned.write(writer, suffix & 7);
      } else writer.write(suffix, extra);
    }
  }

  private storedBlock(
    writer: WordWriter,
    data: Uint8Array,
    recent: RecentOffsets,
  ): void {
    writer.write(3, 3);
    writer.write(data.length, 24);
    const block = Buffer.alloc(12 + data.length + (data.length & 1));
    recent.forEach((distance, index) =>
      block.writeUInt32LE(distance, index * 4),
    );
    block.set(data, 12);
    writer.raw(block);
  }

  getConfig(): LZXEncoderOptions {
    return {
      windowSize: this.windowSize,
      resetInterval: this.resetInterval,
      compressionLevel: this.compressionLevel,
      ...(this.blockSize === LZX_FRAME_SIZE
        ? {}
        : { blockSize: this.blockSize }),
    };
  }
}
