import { test } from 'vitest';
import { deepStrictEqual as equal, throws } from 'node:assert/strict';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { BitReader } from '../../src/utils/io/bit-reader';
import { LZXEncoder } from '../../src/encoder/lzx-encoder';
import type { LZXCHeader } from '../../src/core/types';

const FRAME = 32768;
function decoder(windowSize = FRAME, resetInterval = FRAME * 128): LZXDecoder {
  const header: LZXCHeader = {
    signature: 'LZXC',
    version: 2,
    windowSize,
    resetInterval,
    cacheSize: 0,
    unknown: 0,
  };
  return new LZXDecoder(header);
}

/** Test-only word packer, independent of production readers and encoders. */
class Words {
  private bytes: number[] = [];
  private word = 0;
  bits = 0;

  put(value: number, count: number): void {
    for (let bit = count - 1; bit >= 0; bit--) {
      this.word = this.word * 2 + (Math.floor(value / 2 ** bit) & 1);
      if (++this.bits === 16) this.flush();
    }
  }

  private flush(): void {
    this.word *= 2 ** (16 - this.bits);
    this.bytes.push(this.word & 255, this.word >>> 8);
    this.word = this.bits = 0;
  }

  alignRaw(): void {
    // Raw blocks always consume padding, even when their header ends on a word.
    this.flush();
  }

  raw(data: Uint8Array): void {
    equal(this.bits, 0);
    for (const byte of data) this.bytes.push(byte);
  }

  finish(): Buffer {
    if (this.bits !== 0) this.flush();
    return Buffer.from(this.bytes);
  }
}

function codes(lengths: readonly number[]): number[] {
  const result = new Array<number>(lengths.length).fill(0);
  let code = 0;
  for (let length = 1; length <= 16; length++) {
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      if (lengths[symbol] === length) result[symbol] = code++;
    }
    code *= 2;
  }
  return result;
}

function emit(w: Words, lengths: readonly number[], symbol: number): void {
  if (!lengths[symbol]) throw new Error(`Missing test code for ${symbol}`);
  w.put(codes(lengths)[symbol]!, lengths[symbol]!);
}

function tree(count: number, symbols: number[]): number[] {
  const active = [...new Set(symbols)].sort((a, b) => a - b);
  if (active.length === 1) active.push(active[0] === 0 ? 1 : 0);
  const lengths = new Array<number>(count).fill(0);
  const depth = Math.floor(Math.log2(active.length));
  const short = 2 ** (depth + 1) - active.length;
  active.forEach((symbol, i) => {
    lengths[symbol] = i < short ? depth : depth + 1;
  });
  return lengths;
}

// A complete 20-symbol pretree: twelve 4-bit and eight 5-bit codes.
const PRE = Array.from({ length: 20 }, (_, i) => (i < 12 ? 4 : 5));
function lengths(
  w: Words,
  next: number[],
  previous: number[],
  first: number,
  end: number,
  runs: boolean,
): void {
  for (const length of PRE) w.put(length, 4);
  for (let i = first; i < end; ) {
    let run = 1;
    while (i + run < end && next[i + run] === next[i]) run++;
    if (runs && run >= 4) {
      let count: number;
      if (next[i] === 0 && run >= 20) {
        count = Math.min(51, run);
        emit(w, PRE, 18);
        w.put(count - 20, 5);
      } else if (next[i] === 0) {
        count = Math.min(19, run);
        emit(w, PRE, 17);
        w.put(count - 4, 4);
      } else {
        count = Math.min(5, run);
        emit(w, PRE, 19);
        w.put(count - 4, 1);
        emit(w, PRE, (previous[i]! - next[i]! + 17) % 17);
      }
      i += count;
    } else {
      emit(w, PRE, (previous[i]! - next[i]! + 17) % 17);
      i++;
    }
  }
  for (let i = first; i < end; i++) previous[i] = next[i]!;
}

class Stream {
  w = new Words();
  main: number[];
  length = new Array<number>(249).fill(0);
  private previous: number[];
  private previousLength = new Array<number>(249).fill(0);

  constructor(slots = 30, intelSize = 0) {
    this.main = new Array<number>(256 + slots * 8).fill(0);
    this.previous = [...this.main];
    this.w.put(intelSize ? 1 : 0, 1);
    if (intelSize) {
      this.w.put(Math.floor(intelSize / 65536), 16);
      this.w.put(intelSize & 65535, 16);
    }
  }

  block(
    size: number,
    symbols: number[],
    options: {
      aligned?: boolean;
      lengthSymbols?: number[];
      runs?: boolean;
      mainLengths?: number[];
    } = {},
  ): void {
    this.w.put(options.aligned ? 2 : 1, 3);
    this.w.put(size, 24);
    if (options.aligned) for (let i = 0; i < 8; i++) this.w.put(3, 3);
    this.main = options.mainLengths ?? tree(this.main.length, symbols);
    lengths(this.w, this.main, this.previous, 0, 256, options.runs ?? false);
    lengths(
      this.w,
      this.main,
      this.previous,
      256,
      this.main.length,
      options.runs ?? false,
    );
    this.length = options.lengthSymbols
      ? tree(249, options.lengthSymbols)
      : new Array<number>(249).fill(0);
    lengths(
      this.w,
      this.length,
      this.previousLength,
      0,
      249,
      options.runs ?? false,
    );
  }

  symbol(symbol: number): void {
    emit(this.w, this.main, symbol);
  }
  footer(symbol: number): void {
    emit(this.w, this.length, symbol);
  }

  raw(data: Buffer, recent = [1, 1, 1], advertisedSize = data.length): void {
    this.w.put(3, 3);
    this.w.put(advertisedSize, 24);
    this.w.alignRaw();
    const offsets = Buffer.alloc(12);
    recent.forEach((offset, i) => offsets.writeUInt32LE(offset, i * 4));
    this.w.raw(offsets);
    this.w.raw(data);
    if (advertisedSize === data.length && data.length & 1)
      this.w.raw(Buffer.from([0xa5]));
  }

  frame(): Buffer {
    const result = this.w.finish();
    this.w = new Words();
    return result;
  }
}

function decode(stream: Stream, size: number, window = FRAME): Buffer {
  return decoder(window).decode(new BitReader(stream.frame()), size);
}

/** Three highly compressed frames with real new/repeated offsets and no raw blocks. */
function compressedAcrossFrames(aligned: boolean): {
  frames: Buffer[];
  expected: Buffer;
} {
  const s = new Stream();
  const expected: number[] = [];
  const frames: Buffer[] = [];
  const symbols = [
    ...Array.from({ length: 64 }, (_, i) => i),
    263,
    271,
    279,
    270,
    278,
    256 + 8 * 8 + 6,
    256 + 10 * 8 + 6,
    256 + 29 * 8 + 6,
  ];
  s.block(FRAME * 2 + 64, symbols, {
    aligned,
    lengthSymbols: [0, 248],
    runs: true,
  });
  const literal = (byte: number): void => {
    s.symbol(byte);
    expected.push(byte);
  };
  const match = (slot: number, length: number, offset: number): void => {
    s.symbol(256 + slot * 8 + (length >= 9 ? 7 : length - 2));
    if (length >= 9) s.footer(length - 9);
    if (slot >= 3) {
      const [extra, footer] =
        slot === 8 ? [3, 5] : slot === 10 ? [4, 11] : [13, 8186];
      if (aligned) {
        s.w.put(footer! >>> 3, extra! - 3);
        s.w.put(footer! & 7, 3);
      } else s.w.put(footer!, extra!);
    }
    // Golden bytes use explicitly specified distances, not another R-queue implementation.
    for (let i = 0; i < length; i++)
      expected.push(expected[expected.length - offset]!);
  };
  const fill = (target: number, offset: number): void => {
    while (target - expected.length >= 257) match(0, 257, offset);
    while (expected.length < target) literal(expected.length & 63);
  };
  for (let i = 0; i < 64; i++) literal(i);
  fill(FRAME - 24, 1);
  match(8, 8, 19);
  match(10, 8, 41);
  match(29, 8, 32760);
  frames.push(s.frame());
  // At wrap, R2=19, R1=41, R0=32760. The first match wraps the source
  // and then overlaps itself, while the R2/R1/R2 sequence tests both swaps.
  match(2, 257, 19);
  match(1, 8, 41);
  match(2, 257, 32760);
  fill(FRAME * 2 - 24, 32760);
  match(8, 8, 19);
  match(10, 8, 41);
  match(29, 8, 32760);
  frames.push(s.frame());
  match(2, 9, 19);
  match(1, 8, 41);
  match(2, 8, 32760);
  fill(FRAME * 2 + 64, 32760);
  // Change block type and main-tree lengths inside the final frame.
  s.block(33, [240, 241], { aligned: !aligned, runs: true });
  for (let i = 0; i < 33; i++) literal(240 + (i & 1));
  frames.push(s.frame());
  return { frames, expected: Buffer.from(expected) };
}

const externalLzx = Buffer.from(
  'W4CAjQAQsgsAAAAAIgAAVQ5DwFLyPoyLc0HwCF6REaaXvEeof38gLAAAAAAwAgMAeCAxjY1gXxN+v0AQAAAAAAAAhgiKIS/jc9G+75edl5rRATnYFLO8JllXPyYZBGGm4+SP3yHadtD1OVPaCo6XuQC2',
  'base64',
);

test('independent CAB sample: real aligned LZX data, Intel header and exact text', () => {
  // CFDATA body (114 compressed / 187 output, window bits 18) from:
  // https://github.com/kyz/libmspack/blob/master/libmspack/test/test_files/cabd/mszip_lzx_qtm.cab
  // This is test data only; no libmspack implementation code is used.
  const expected = Buffer.from(
    '-----------------------------------------------------------------\n' +
      'If you can read this, the LZX decompressor is working!\n' +
      '-----------------------------------------------------------------\n',
  );
  equal(decoder(262144).decodeFrames([externalLzx], expected.length), expected);
});

test('separate main-tree pretrees and an empty, unused secondary length tree', () => {
  const s = new Stream();
  s.block(8, [65, 66, 67, 68]);
  for (const symbol of Buffer.from('ABCDDCBA')) s.symbol(symbol);
  equal(decode(s, 8), Buffer.from('ABCDDCBA'));
});

test('tree length deltas persist between adjacent compressed blocks', () => {
  const s = new Stream();
  s.block(4, [65, 66]);
  for (const symbol of Buffer.from('ABBA')) s.symbol(symbol);
  s.block(6, [67, 68]);
  for (const symbol of Buffer.from('CDDCDC')) s.symbol(symbol);
  equal(decode(s, 10), Buffer.from('ABBACDDCDC'));
});

test('pretree zero runs 17/18 and repeated nonzero lengths 19', () => {
  const s = new Stream();
  // Symbols 65..68 have equal nonzero lengths, exercising opcode 19;
  // the zero spans exercise both short and long zero run encodings.
  s.block(8, [65, 66, 67, 68], { runs: true });
  for (const symbol of Buffer.from('ABCDDCBA')) s.symbol(symbol);
  equal(decode(s, 8), Buffer.from('ABCDDCBA'));
});

test('slot 3 is position_base minus 2, yielding offset 1 and overlapping copies', () => {
  const s = new Stream();
  s.block(3, [65, 256 + 3 * 8]);
  s.symbol(65);
  s.symbol(256 + 3 * 8);
  equal(decode(s, 3), Buffer.from('AAA'));
});

test('slot 4 verbatim footer and match minimum length 2', () => {
  const s = new Stream();
  s.block(5, [65, 66, 67, 256 + 4 * 8]);
  for (const symbol of Buffer.from('ABC')) s.symbol(symbol);
  s.symbol(256 + 4 * 8);
  s.w.put(1, 1); // base 4 - 2 + 1 = 3
  equal(decode(s, 5), Buffer.from('ABCAB'));
});

test('length sentinel supports the maximum standard match length of 257', () => {
  const s = new Stream();
  s.block(258, [90, 263], { lengthSymbols: [0, 248] });
  s.symbol(90);
  s.symbol(263);
  s.footer(248);
  equal(decode(s, 258), Buffer.alloc(258, 90));
});

test('stored R0/R1/R2 and slot 2 swap preserve R1 (not an LRU rotation)', () => {
  const s = new Stream();
  s.raw(Buffer.from('ABCDEFGH'), [4, 3, 2]);
  s.block(6, [264, 272]);
  s.symbol(272);
  s.symbol(264);
  s.symbol(272);
  equal(decode(s, 14), Buffer.from('ABCDEFGHGHHGGH'));
});

test('new offsets shift R0/R1/R2 and repeated offset slots select them', () => {
  const s = new Stream();
  s.raw(Buffer.from('ABCDEFGH'));
  s.block(8, [256 + 4 * 8, 256 + 5 * 8, 264, 272]);
  s.symbol(256 + 4 * 8);
  s.w.put(1, 1); // offset 3
  s.symbol(256 + 5 * 8);
  s.w.put(1, 1); // offset 5
  s.symbol(264); // offset 3, R0/R1 swap
  s.symbol(272); // original offset 1
  equal(decode(s, 16), Buffer.from('ABCDEFGHFGFGGFFF'));
});

for (const [slot, high, low, offset] of [
  [4, 1, 0, 3],
  [8, 0, 5, 19],
  [10, 1, 3, 41],
]) {
  test(`aligned offset slot ${slot}: verbatim high bits and Huffman low bits`, () => {
    const seed = Buffer.from(Array.from({ length: 64 }, (_, i) => i));
    const s = new Stream();
    s.raw(seed);
    s.block(2, [0, 256 + slot! * 8], { aligned: true });
    s.symbol(256 + slot! * 8);
    const extra = Math.floor(slot! / 2) - 1;
    if (extra < 3) s.w.put(high!, extra);
    else {
      s.w.put(high!, extra - 3);
      s.w.put(low!, 3); // all aligned symbols have canonical 3-bit codes
    }
    equal(
      decode(s, 66),
      Buffer.concat([seed, seed.subarray(64 - offset!, 66 - offset!)]),
    );
  });
}

for (const [window, slots, base] of [
  [32768, 30, 24576],
  [65536, 32, 49152],
  [131072, 34, 98304],
  [262144, 36, 196608],
  [524288, 38, 393216],
  [1048576, 42, 917504],
  [2097152, 50, 1966080],
]) {
  test(`window ${window} has ${slots} position slots, including the highest slot`, () => {
    const offset = base! - 2;
    const seed = Buffer.alloc(offset);
    for (let i = 0; i < seed.length; i++) seed[i] = (i * 37 + (i >>> 8)) & 255;
    const s = new Stream(slots!);
    s.raw(seed);
    const symbol = 256 + (slots! - 1) * 8;
    s.block(2, [0, symbol], { runs: true });
    s.symbol(symbol);
    s.w.put(0, Math.min(17, Math.floor((slots! - 1) / 2) - 1));
    equal(
      decode(s, offset + 2, window!),
      Buffer.concat([seed, seed.subarray(0, 2)]),
    );
  });
}

test('compressed blocks, code tables, delta history and bit alignment survive frame boundaries', () => {
  const s = new Stream();
  s.block(FRAME + 2, [65, 66]);
  for (let i = 0; i < FRAME; i++) s.symbol(i & 1 ? 66 : 65);
  const first = s.frame();
  s.symbol(65);
  s.symbol(66); // same block, no new header or tables
  s.block(4, [67, 68]);
  for (const symbol of Buffer.from('CDDC')) s.symbol(symbol);
  const second = s.frame();
  const expected = Buffer.concat([
    Buffer.from('AB'.repeat(FRAME / 2)),
    Buffer.from('ABCDDC'),
  ]);
  equal(
    decoder(FRAME, FRAME * 2).decodeFrames([first, second], expected.length),
    expected,
  );
  equal(
    decoder(FRAME, FRAME * 2).decode(
      new BitReader(Buffer.concat([first, second])),
      expected.length,
    ),
    expected,
  );
});

test('raw block data continues across frame buffers without another R header', () => {
  const seed = Buffer.alloc(FRAME, 0x7d);
  const s = new Stream();
  s.raw(seed, [1, 1, 1], FRAME + 3);
  const first = s.frame();
  s.w.raw(Buffer.from('XYZ'));
  s.w.raw(Buffer.from([0])); // odd block padding
  const second = s.frame();
  equal(
    decoder().decodeFrames([first, second], FRAME + 3),
    Buffer.concat([seed, Buffer.from('XYZ')]),
  );
});

test('dictionary wraps without losing data and R0 can reference the entire window', () => {
  const seed = Buffer.from(
    Array.from({ length: FRAME }, (_, i) => (i * 7) & 255),
  );
  const s = new Stream();
  s.raw(seed, [FRAME, 1, 1]);
  const first = s.frame();
  s.block(257, [0, 263], { lengthSymbols: [0, 248] });
  s.symbol(263);
  s.footer(248);
  equal(
    decoder().decodeFrames([first, s.frame()], FRAME + 257),
    Buffer.concat([seed, seed.subarray(0, 257)]),
  );
});

test('reset interval rereads Intel header and clears tree deltas', () => {
  const first = new Stream();
  first.block(FRAME, [65, 66]);
  for (let i = 0; i < FRAME; i++) first.symbol(65);
  const second = new Stream();
  second.block(11, [65, 66]);
  for (let i = 0; i < 11; i++) second.symbol(66);
  const frames = [first.frame(), second.frame()];
  const expected = Buffer.concat([
    Buffer.alloc(FRAME, 65),
    Buffer.alloc(11, 66),
  ]);
  equal(decoder(FRAME, FRAME).decodeFrames(frames, expected.length), expected);
  equal(
    decoder(FRAME, FRAME).decode(
      new BitReader(Buffer.concat(frames)),
      expected.length,
    ),
    expected,
  );
});

test('64 KiB reset retains the second frame and restarts the third frame', () => {
  const s = new Stream();
  s.block(FRAME * 2, [65, 66]);
  for (let i = 0; i < FRAME; i++) s.symbol(65);
  const first = s.frame();
  for (let i = 0; i < FRAME; i++) s.symbol(66);
  const second = s.frame();
  const restarted = new Stream();
  restarted.block(4, [67, 68]);
  for (const symbol of Buffer.from('CDDC')) restarted.symbol(symbol);
  const expected = Buffer.concat([
    Buffer.alloc(FRAME, 65),
    Buffer.alloc(FRAME, 66),
    Buffer.from('CDDC'),
  ]);
  equal(
    decoder(FRAME, FRAME * 2).decodeFrames(
      [first, second, restarted.frame()],
      expected.length,
    ),
    expected,
  );
});

test('secondary length-tree deltas persist between compressed blocks', () => {
  const s = new Stream();
  s.raw(Buffer.from('A'));
  s.block(9, [0, 263], { lengthSymbols: [0, 9] });
  s.symbol(263);
  s.footer(0);
  s.block(18, [0, 263], { lengthSymbols: [9, 248] });
  s.symbol(263);
  s.footer(9);
  equal(decode(s, 28), Buffer.alloc(28, 65));
});

test('odd raw padding precedes the next raw or compressed block', () => {
  const s = new Stream();
  s.raw(Buffer.from('ABC'));
  s.raw(Buffer.from('D'));
  s.block(2, [69, 70]);
  s.symbol(69);
  s.symbol(70);
  equal(decode(s, 6), Buffer.from('ABCDEF'));
});

test('word-aligned raw header still has one whole word of padding', () => {
  let checked = false;
  for (let count = 1; count <= 16; count++) {
    const s = new Stream();
    s.block(count, [65, 66]);
    for (let i = 0; i < count; i++) s.symbol(65);
    if ((s.w.bits + 27) % 16 !== 0) continue;
    s.raw(Buffer.from('XY'));
    equal(
      decode(s, count + 2),
      Buffer.concat([Buffer.alloc(count, 65), Buffer.from('XY')]),
    );
    checked = true;
    break;
  }
  equal(checked, true);
});

test('Intel E8 handles signed operands, validity bounds, high filesize bits and tail exclusion', () => {
  const raw = Buffer.alloc(64, 0x90);
  for (const [index, value] of [
    [1, 30],
    [8, -5],
    [15, 0x23456789],
    [22, -23],
    [54, 40],
  ]) {
    raw[index!] = 0xe8;
    raw.writeInt32LE(value!, index! + 1);
  }
  const s = new Stream(30, 0x12345678);
  s.raw(raw);
  const expected = Buffer.from(raw);
  expected.writeInt32LE(29, 2);
  expected.writeInt32LE(0x12345678 - 5, 9);
  equal(decode(s, 64), expected);
});

test('compressed literal E8 activates Intel translation, but a zero Intel flag disables it', () => {
  const raw = Buffer.alloc(32, 0x90);
  raw[1] = 0xe8;
  raw.writeInt32LE(100, 2);
  const compressed = new Stream(30, 1000);
  compressed.block(raw.length, [...raw]);
  for (const byte of raw) compressed.symbol(byte);
  const expected = Buffer.from(raw);
  expected.writeInt32LE(99, 2);
  equal(decode(compressed, raw.length), expected);
  const stored = new Stream();
  stored.raw(raw);
  equal(decode(stored, raw.length), raw);
});

test('Intel translation restarts its origin at a later CHM reset', () => {
  const raw = Buffer.alloc(32, 0x90);
  raw[1] = 0xe8;
  raw.writeInt32LE(100000, 2);
  const s = new Stream(30, 200000);
  s.raw(raw);
  const expected = Buffer.from(raw);
  expected.writeInt32LE(100000 - 1, 2);
  equal(
    decoder(FRAME, FRAME * 2).decodeFrames([s.frame()], raw.length, 2),
    expected,
  );
});

test('Intel transform excludes the last ten bytes of a physical short frame', () => {
  for (const [size, startFrame] of [
    [10, 0],
    [10, 32768],
  ]) {
    const raw = Buffer.alloc(size!, 0x90);
    raw[1] = 0xe8;
    raw.writeInt32LE(100, 2);
    const s = new Stream(30, 1000);
    s.raw(raw);
    equal(
      decoder(FRAME, FRAME).decodeFrames([s.frame()], size!, startFrame!),
      raw,
    );
  }
});

test('Intel output transform never modifies dictionary bytes used by later matches', () => {
  const raw = Buffer.alloc(FRAME, 0x90);
  raw[1] = 0xe8;
  raw.writeInt32LE(100, 2);
  const s = new Stream(30, 100000);
  s.raw(raw, [FRAME, 1, 1]);
  const first = s.frame();
  s.block(32, [0, 263], { lengthSymbols: [0, 23] });
  s.symbol(263);
  s.footer(23);
  const expected = Buffer.concat([raw, raw.subarray(0, 32)]);
  expected.writeInt32LE(99, 2);
  expected.writeInt32LE(100 - FRAME - 1, FRAME + 2);
  equal(decoder().decodeFrames([first, s.frame()], expected.length), expected);
});

test('malformed block types, zero lengths and stored offsets fail finitely', () => {
  for (const type of [0, 4, 5, 6, 7]) {
    const w = new Words();
    w.put(0, 1);
    w.put(type, 3);
    w.put(1, 24);
    throws(() => decoder().decodeFrames([w.finish()], 1), /block type/);
  }
  const w = new Words();
  w.put(0, 1);
  w.put(1, 3);
  w.put(0, 24);
  throws(() => decoder().decodeFrames([w.finish()], 1), /Zero-length/);
  for (const offset of [0, FRAME + 1, 0xffffffff]) {
    const s = new Stream();
    s.raw(Buffer.from('AB'), [offset, 1, 1]);
    throws(() => decode(s, 2), /repeated offset/);
  }
});

test('empty, oversubscribed and incomplete pretrees are rejected', () => {
  for (const pretree of [
    new Array<number>(20).fill(0),
    new Array<number>(20).fill(1),
    [1, ...new Array<number>(19).fill(0)],
  ]) {
    const w = new Words();
    w.put(0, 1);
    w.put(1, 3);
    w.put(1, 24);
    for (const length of pretree) w.put(length, 4);
    throws(() => decoder().decodeFrames([w.finish()], 1), /Huffman tree/);
  }
});

test('pretree run cannot overrun either main-tree range', () => {
  const w = new Words();
  w.put(0, 1);
  w.put(1, 3);
  w.put(1, 24);
  const pretree = new Array<number>(20).fill(0);
  pretree[0] = pretree[18] = 1;
  for (const length of pretree) w.put(length, 4);
  for (let i = 0; i < 5; i++) {
    w.put(1, 1);
    w.put(31, 5);
  } // 255 zeroes
  w.put(1, 1);
  w.put(0, 5); // another 20, over the 256-symbol range
  throws(() => decoder().decodeFrames([w.finish()], 1), /run exceeds/);
});

test('length sentinel cannot silently use an empty length tree', () => {
  const s = new Stream();
  s.raw(Buffer.from('A'));
  s.block(9, [0, 263]);
  s.symbol(263);
  throws(() => decode(s, 10), /empty LZX Huffman code/);
});

test('matches cannot reference nonexistent history or overrun a block/frame', () => {
  const early = new Stream();
  early.block(2, [0, 256]);
  early.symbol(256);
  throws(() => decode(early, 2), /history/);
  const block = new Stream();
  block.raw(Buffer.from('A'));
  block.block(1, [0, 256]);
  block.symbol(256);
  throws(() => decode(block, 2), /boundary/);
  const frame = new Stream();
  frame.raw(Buffer.alloc(FRAME - 1, 65));
  frame.block(2, [0, 256]);
  frame.symbol(256);
  throws(() => decode(frame, FRAME + 1), /boundary/);
});

test('a reset cannot interrupt a declared block', () => {
  const s = new Stream();
  s.raw(Buffer.alloc(FRAME, 65), [1, 1, 1], FRAME + 1);
  const next = new Stream();
  next.raw(Buffer.from('B'));
  throws(
    () =>
      decoder(FRAME, FRAME).decodeFrames([s.frame(), next.frame()], FRAME + 1),
    /reset boundary/,
  );
});

test('a truncated frame cannot borrow bytes from the next frame buffer', () => {
  const s = new Stream();
  s.raw(Buffer.alloc(FRAME, 65));
  const first = s.frame();
  throws(
    () => decoder().decodeFrames([first.subarray(0, 15), first], FRAME * 2),
    /Truncated/,
  );
});

test('truncated independent compressed samples fail without partial success', () => {
  for (let length = 0; length < 60; length++) {
    throws(() =>
      decoder(262144).decodeFrames([externalLzx.subarray(0, length)], 187),
    );
  }
});

test('independent empty main tree and premature match regression fixtures are rejected', () => {
  // The corresponding libmspack test CABs; CFDATA starts at byte 69, body at 77.
  const empty = Buffer.from(
    'TVNDRgAAAABdAAAAAAAAACwAAAAAAAAAAwEBAAEAAADSBAAARQAAAAEAAw8QAAAAAAAAAAAAbCK6WSAAZmlsZS50eHQAAAAAABAAEAAAEAABAAAAAAAAAAAAAAAA',
    'base64',
  );
  const early = Buffer.from(
    'TVNDRgAAAAB9AAAAAAAAACwAAAAAAAAAAwEBAAEAAADSBAAARQAAAAEAAw8CAAAAAAAAAAAAbCK6WSAAZmlsZS50eHQAAAAAADAAEAAAECAAAAAAAAAAAQAPAf////8AAAAAAAAAABAQ/7D//wD8AAAAAAAAQAD/Q///APA=',
    'base64',
  );
  for (const cab of [empty, early]) {
    throws(() =>
      decoder().decodeFrames([cab.subarray(77)], cab.readUInt16LE(75)),
    );
  }
});

for (const aligned of [false, true]) {
  const mode = aligned ? 'ALIGNED' : 'VERBATIM';
  test(`${mode} matches preserve tables and recent offsets across two window wraps`, () => {
    const { frames, expected } = compressedAcrossFrames(aligned);
    equal(
      frames.every(frame => frame.length < FRAME / 4),
      true,
    );
    const d = decoder();
    equal(d.decodeFrames(frames, expected.length, 0, 97), expected);
    equal(
      d.decode(new BitReader(Buffer.concat(frames)), expected.length),
      expected,
    );
    // End inside each of the R2/R1/R2 matches, including an operand-free
    // match immediately after a source/window wrap.
    for (const size of [
      FRAME - 23,
      FRAME + 1,
      FRAME + 258,
      FRAME + 266,
      FRAME * 2 + 1,
      FRAME * 2 + 10,
      FRAME * 2 + 18,
    ]) {
      const count = Math.ceil(size / FRAME);
      const selected = frames.slice(0, count);
      const physical = count === 3 ? 97 : FRAME;
      equal(
        d.decodeFrames(selected, size, 0, physical),
        expected.subarray(0, size),
      );
      // The compatibility prefix path must also permit ending inside a match.
      equal(d.decodeFrames(selected, size), expected.subarray(0, size));
      equal(
        d.decode(new BitReader(Buffer.concat(selected)), size),
        expected.subarray(0, size),
      );
    }
  });
}

test('every prefix of the independent CAB sample returns the exact requested bytes', () => {
  const expected = Buffer.from(
    '-----------------------------------------------------------------\n' +
      'If you can read this, the LZX decompressor is working!\n' +
      '-----------------------------------------------------------------\n',
  );
  const d = decoder(262144);
  for (let size = 1; size <= expected.length; size++) {
    equal(
      d.decodeFrames([externalLzx], size, 0, expected.length),
      expected.subarray(0, size),
    );
    equal(d.decodeFrames([externalLzx], size), expected.subarray(0, size));
  }
});

test('Intel-filtered prefixes use the physical frame tail and may end inside operands', () => {
  const raw = Buffer.alloc(64, 0x90);
  raw[1] = 0xe8;
  raw.writeInt32LE(100, 2);
  raw[24] = 0xe8;
  raw.writeInt32LE(-24, 25);
  raw[54] = 0xe8;
  raw.writeInt32LE(100, 55); // physical tail, must not change
  const s = new Stream(30, 1000);
  s.block(raw.length, [...raw], { aligned: true });
  for (const byte of raw) s.symbol(byte);
  const frame = s.frame();
  const expected = Buffer.from(raw);
  expected.writeInt32LE(99, 2);
  expected.writeInt32LE(976, 25);
  const d = decoder();
  for (const size of [1, 2, 3, 5, 6, 25, 26, 28, 29, 32, 54, 57, 64]) {
    equal(
      d.decodeFrames([frame], size, 0, raw.length),
      expected.subarray(0, size),
    );
  }
});

test('CHM prefixes decode the full padded frame when lastFrameSize is 32768', () => {
  const raw = Buffer.alloc(FRAME, 0x90);
  raw[24] = 0xe8;
  raw.writeInt32LE(100, 25);
  const s = new Stream(30, 1000);
  s.raw(raw);
  const frame = s.frame();
  const expected = Buffer.from(raw.subarray(0, 32));
  expected.writeInt32LE(76, 25);
  equal(decoder().decodeFrames([frame], 32, 0, FRAME), expected);
  // Declaring the physical extent validates its suffix, not merely the prefix.
  throws(
    () => decoder().decodeFrames([frame.subarray(0, 64)], 32, 0, FRAME),
    /Truncated/,
  );
});

test('explicit physical frame boundaries still reject overlong matches', () => {
  const s = new Stream();
  s.block(258, [65, 263], { lengthSymbols: [0, 248] });
  s.symbol(65);
  s.symbol(263);
  s.footer(248);
  const frame = s.frame();
  equal(decoder().decodeFrames([frame], 2), Buffer.from('AA'));
  equal(decoder().decodeFrames([frame], 2, 0, 258), Buffer.from('AA'));
  throws(() => decoder().decodeFrames([frame], 2, 0, 257), /boundary/);
});

test('complete main trees can use 16-bit codes; incomplete, empty and oversubscribed ones fail', () => {
  const complete = new Array<number>(496).fill(0);
  for (let i = 0; i < 15; i++) complete[65 + i] = i + 1;
  complete[80] = complete[81] = 16;
  const valid = new Stream();
  valid.block(4, [], { mainLengths: complete });
  for (const byte of Buffer.from('PQAP')) valid.symbol(byte);
  equal(decode(valid, 4), Buffer.from('PQAP'));
  for (const active of [[], [1], [2, 2], [1, 1, 1]]) {
    const invalid = new Array<number>(496).fill(0);
    active.forEach((length, i) => {
      invalid[65 + i] = length;
    });
    const s = new Stream();
    s.block(1, [], { mainLengths: invalid });
    throws(() => decode(s, 1), /Huffman tree/);
  }
});

test('compressed Intel negative operands survive window wrap without filtering the dictionary', () => {
  const seed = Buffer.alloc(64, 0x90);
  seed[8] = 0xe8;
  seed.writeInt32LE(-100, 9);
  const s = new Stream(30, 100000);
  s.block(FRAME + 32, [...seed, 263, 359], {
    aligned: true,
    lengthSymbols: [0, 23, 56, 248],
    runs: true,
  });
  for (const byte of seed) s.symbol(byte);
  const match = (slot: number, length: number): void => {
    s.symbol(256 + slot * 8 + 7);
    s.footer(length - 9);
    if (slot === 12) {
      s.w.put(0, 2);
      s.w.put(2, 3);
    } // base 64 - 2 + 2 = 64
  };
  match(12, 257);
  let position = 64 + 257;
  while (FRAME - position >= 257) {
    match(0, 257);
    position += 257;
  }
  match(0, FRAME - position);
  const first = s.frame();
  match(0, 32);
  const second = s.frame();
  const expected = Buffer.alloc(FRAME + 32);
  for (let i = 0; i < expected.length; i++)
    expected[i] = seed[i % seed.length]!;
  // Negative -100 is invalid at positions 8/72, but valid from position 136
  // onwards and immediately after the next frame's window/source wrap.
  for (const [start, size] of [
    [0, FRAME],
    [FRAME, 32],
  ]) {
    for (let i = 8; i < size! - 10; i += 64) {
      if (start! + i >= 100) expected.writeInt32LE(99900, start! + i + 1);
    }
  }
  equal(
    decoder().decodeFrames([first, second], expected.length, 0, 32),
    expected,
  );
  for (const size of [FRAME + 9, FRAME + 10, FRAME + 12]) {
    equal(
      decoder().decodeFrames([first, second], size, 0, 32),
      expected.subarray(0, size),
    );
  }
});

test('CHM Intel reset rereads filesize and uses reset-local signed operand bounds', () => {
  const first = Buffer.alloc(FRAME, 0x90);
  first[1] = 0xe8;
  first.writeInt32LE(-1, 2);
  first[8] = 0xe8;
  first.writeInt32LE(-9, 9); // below -curpos
  const second = Buffer.alloc(FRAME, 0x90);
  second[1] = 0xe8;
  second.writeInt32LE(-FRAME - 1, 2);
  second[8] = 0xe8;
  second.writeInt32LE(-FRAME - 9, 9);
  const third = Buffer.alloc(64, 0x90);
  third[0] = 0xe8;
  third.writeInt32LE(-1, 1); // invalid after reset
  third[8] = 0xe8;
  third.writeInt32LE(-8, 9); // inclusive valid lower bound
  third[20] = 0xe8;
  third.writeInt32LE(500, 21);
  const s = new Stream(30, 100000);
  s.raw(first);
  const frames = [s.frame()];
  s.raw(second);
  frames.push(s.frame());
  const restarted = new Stream(30, 200000);
  restarted.raw(third);
  frames.push(restarted.frame());
  const expected = Buffer.concat([first, second, third]);
  expected.writeInt32LE(99999, 2);
  expected.writeInt32LE(100000 - FRAME - 1, FRAME + 2);
  expected.writeInt32LE(199992, FRAME * 2 + 9);
  expected.writeInt32LE(480, FRAME * 2 + 21);
  const d = decoder(FRAME, FRAME * 2);
  equal(d.decodeFrames(frames, expected.length, 0, 64), expected);
  equal(
    d.decodeFrames([frames[2]!], third.length, 2, 64),
    expected.subarray(FRAME * 2),
  );
});

test('a zero Intel header disables the previous reset filter; absolute 1 GiB is not a local cutoff', () => {
  const raw = Buffer.alloc(FRAME, 0x90);
  raw[1] = 0xe8;
  raw.writeInt32LE(100, 2);
  const first = new Stream(30, 1000);
  first.raw(raw);
  const short = Buffer.from(raw.subarray(0, 32));
  const next = new Stream();
  next.raw(short);
  const expected = Buffer.concat([raw, short]);
  expected.writeInt32LE(99, 2);
  equal(
    decoder(FRAME, FRAME).decodeFrames(
      [first.frame(), next.frame()],
      expected.length,
    ),
    expected,
  );
  const later = new Stream(30, 1000);
  later.raw(short);
  const transformed = Buffer.from(short);
  transformed.writeInt32LE(99, 2);
  equal(
    decoder(FRAME, FRAME).decodeFrames([later.frame()], short.length, 32768),
    transformed,
  );
});

test('compressed table/body errors and successful prefix calls never poison later calls', () => {
  const { frames, expected } = compressedAcrossFrames(true);
  const d = decoder();
  const inputs = frames.map(frame => Buffer.from(frame));
  equal(d.decodeFrames([frames[0]!], 70, 0, FRAME), expected.subarray(0, 70));
  for (const bad of [
    frames[0]!.subarray(0, 14),
    frames[0]!.subarray(0, frames[0]!.length - 2),
  ]) {
    const reader = new BitReader(bad);
    for (let attempt = 0; attempt < 2; attempt++) {
      throws(() => d.decode(reader, FRAME), /Truncated/);
      equal(reader.position, 0);
      equal(reader.bitPosition, 0);
      throws(() => d.decodeFrames([bad], FRAME), /Truncated/);
    }
    equal(d.decodeFrames(frames, expected.length, 0, 97), expected);
  }
  equal(frames, inputs);
});

for (const windowSize of [FRAME, FRAME * 2, 0x100000, 0x200000]) {
  for (const compressionLevel of [0, 6]) {
    test(`production encoder roundtrip: window ${windowSize}, level ${compressionLevel}, reset 64 KiB`, () => {
      const noise = Buffer.alloc(FRAME);
      let state = 0x12345678;
      for (let i = 0; i < noise.length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        noise[i] = state & 255;
      }
      const text = Buffer.from(
        'real VERBATIM matches across CHM frames; E8 stays literal. '.repeat(
          700,
        ),
      );
      const source = Buffer.concat([
        noise,
        noise.subarray(4),
        noise.subarray(0, 4),
        text.subarray(0, FRAME + 239),
      ]);
      const original = Buffer.from(source);
      const config = { windowSize, resetInterval: FRAME * 2, compressionLevel };
      const result = new LZXEncoder(config).compress(source);
      const count = result.resetTable.readUInt32LE(4);
      const offset = result.resetTable.readUInt32LE(12);
      const frames = Array.from({ length: count }, (_, i) => {
        const start = Number(result.resetTable.readBigUInt64LE(offset + i * 8));
        const end =
          i + 1 < count
            ? Number(result.resetTable.readBigUInt64LE(offset + (i + 1) * 8))
            : result.compressedData.length;
        return result.compressedData.subarray(start, end);
      });
      const d = decoder(windowSize, config.resetInterval);
      equal(d.decodeFrames(frames, source.length, 0, FRAME), source);
      equal(
        d.decode(new BitReader(result.compressedData), source.length),
        source,
      );
      for (const size of [
        1,
        FRAME - 7,
        FRAME + 13,
        FRAME * 2 + 19,
        FRAME * 3 + 7,
        source.length,
      ]) {
        equal(
          d.decodeFrames(
            frames.slice(0, Math.ceil(size / FRAME)),
            size,
            0,
            FRAME,
          ),
          source.subarray(0, size),
        );
      }
      equal(
        d.decodeFrames(frames.slice(2), source.length - FRAME * 2, 2, FRAME),
        source.subarray(FRAME * 2),
      );
      if (compressionLevel !== 0) {
        equal((frames[0]!.readUInt16LE(0) >>> 12) & 7, 3); // incompressible stored fallback
        equal((frames[1]!.readUInt16LE(0) >>> 13) & 7, 1); // real Huffman/match frame, no reset flag
        equal(frames[1]!.length < FRAME / 2, true);
      }
      equal(source, original);
    });
  }
}
