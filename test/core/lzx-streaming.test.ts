import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { LZXEncoder } from '../../src/encoder/lzx-encoder';
import { LZXBitReader } from '../../src/core/lzx/lzx-bit-reader';
import { BitReader } from '../../src/utils/io/bit-reader';

const FRAME = LZXDecoder.FRAME_SIZE;
function decoder(resetInterval = FRAME * 2): LZXDecoder {
  return new LZXDecoder({
    signature: 'LZXC',
    version: 2,
    windowSize: FRAME,
    resetInterval,
    cacheSize: 0,
    unknown: 0,
  });
}

type State = {
  readFrame(
    input: LZXBitReader,
    size: number,
    frame: number,
    prefix?: boolean,
  ): Buffer;
  historySize: number;
  mainTree: unknown;
  window: { data: Buffer };
};
function state(d: LZXDecoder): State {
  return d as unknown as State;
}
function assertCleared(d: LZXDecoder): void {
  assert.equal(state(d).historySize, 0);
  assert.equal(state(d).mainTree, null);
  assert.ok(state(d).window.data.every(byte => byte === 0));
}

/** Independent stored-frame word writer, including a reset-local Intel header. */
function rawFrame(
  data: Buffer,
  reset = true,
  intelSize = 0,
  declaredSize = data.length,
): Buffer {
  const bits: number[] = [];
  const put = (value: number, count: number) => {
    for (let bit = count - 1; bit >= 0; bit--)
      bits.push(Math.floor(value / 2 ** bit) & 1);
  };
  if (reset) {
    put(intelSize ? 1 : 0, 1);
    if (intelSize) {
      put(Math.floor(intelSize / 65536), 16);
      put(intelSize & 65535, 16);
    }
  }
  put(3, 3);
  put(declaredSize, 24);
  do bits.push(0);
  while (bits.length % 16);
  const header = Buffer.alloc(bits.length / 8 + 12);
  for (let offset = 0; offset < bits.length; offset += 16) {
    let word = 0;
    for (let bit = 0; bit < 16; bit++) word = word * 2 + bits[offset + bit]!;
    header.writeUInt16LE(word, offset / 8);
  }
  for (const offset of [0, 4, 8])
    header.writeUInt32LE(1, bits.length / 8 + offset);
  return Buffer.concat([
    header,
    data,
    data.length === declaredSize && data.length & 1
      ? Buffer.from([0])
      : Buffer.alloc(0),
  ]);
}

function encodedFrames(data: Buffer, resetInterval: number): Buffer[] {
  const encoded = new LZXEncoder({ resetInterval }).compress(data);
  const count = encoded.resetTable.readUInt32LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = Number(encoded.resetTable.readBigUInt64LE(40 + index * 8));
    const end =
      index + 1 === count
        ? encoded.compressedSize
        : Number(encoded.resetTable.readBigUInt64LE(48 + index * 8));
    return encoded.compressedData.subarray(offset, end);
  });
}

test('lazy compressed frames preserve dictionary/tree deltas across frames and reset exactly once', () => {
  const source = Buffer.alloc(FRAME * 3 + 17);
  for (let i = 0; i < source.length; i++)
    source[i] = (i * 13 + (i >>> 8)) & 255;
  for (const reset of [FRAME * 2, FRAME * 3]) {
    const frames = encodedFrames(source, reset);
    const d = decoder(reset);
    const calls: number[] = [];
    const original = state(d).readFrame;
    state(d).readFrame = function (input, size, frame, prefix) {
      calls.push(frame);
      return original.call(this, input, size, frame, prefix);
    };
    let requested = 0;
    let closed = 0;
    const input = function* (): Generator<Uint8Array> {
      try {
        for (const frame of frames) {
          requested++;
          yield frame;
        }
      } finally {
        closed++;
      }
    };
    const iterator = d.iterateFrames(input(), source.length, 0, FRAME);
    assert.equal(requested, 0);
    assert.deepEqual(calls, []);
    const first = iterator.next().value!;
    assert.equal(requested, 1);
    assert.deepEqual(calls, [0]);
    assert.deepEqual(first, source.subarray(0, FRAME));
    first.fill(0); // Output mutations must not change raw dictionary history.
    const rest = [...iterator];
    assert.deepEqual(Buffer.concat(rest), source.subarray(FRAME));
    assert.deepEqual(calls, [0, 1, 2, 3]);
    assert.equal(requested, 4);
    assert.equal(closed, 1);
    assertCleared(d);
    assert.deepEqual(d.decodeFrames(frames, source.length, 0, FRAME), source);
  }
});

test('large logical output has no eager aggregate allocation and return closes the source', () => {
  const d = decoder(LZXDecoder.MAX_OUTPUT_SIZE * 2);
  const first = rawFrame(Buffer.alloc(FRAME, 65));
  let requested = 0;
  let closed = 0;
  function* input(): Generator<Uint8Array> {
    try {
      requested++;
      yield first;
      throw new Error('must not fetch a second frame');
    } finally {
      closed++;
    }
  }
  const iterator = d.iterateFrames(
    input(),
    LZXDecoder.MAX_OUTPUT_SIZE + FRAME,
    0,
    FRAME,
  );
  const originalAlloc = Buffer.alloc;
  const allocations: number[] = [];
  Buffer.alloc = (size, ...rest) => {
    allocations.push(size);
    assert.ok(size <= FRAME, `unexpected aggregate allocation: ${size}`);
    return originalAlloc(size, ...rest);
  };
  try {
    assert.deepEqual(
      iterator.next().value,
      Buffer.from(new Uint8Array(FRAME).fill(65)),
    );
    assert.equal(requested, 1);
    assert.ok(state(d).historySize > 0);
    assert.equal(iterator.return(undefined).done, true);
    assert.equal(closed, 1);
    assert.equal(requested, 1);
    assert.equal(iterator.next().done, true);
    assert.deepEqual(allocations, [FRAME]);
    assertCleared(d);
  } finally {
    Buffer.alloc = originalAlloc;
    iterator.return(undefined);
  }
});

test('return before first next never opens a source or initializes decoding', () => {
  const d = decoder();
  let opened = 0;
  const input = {
    *[Symbol.iterator]() {
      opened++;
      yield rawFrame(Buffer.from('AB'));
    },
  };
  const iterator = d.iterateFrames(input, 2);
  iterator.return(undefined);
  assert.equal(iterator.next().done, true);
  assert.equal(opened, 0);
  assertCleared(d);
});

test('invalid sizes, absolute reset indices and physical tails fail before source consumption', () => {
  const d = decoder();
  let opened = 0;
  const input = {
    *[Symbol.iterator]() {
      opened++;
      yield Buffer.alloc(0);
    },
  };
  for (const size of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => d.iterateFrames(input, size).next(), /output size/);
  for (const start of [-1, 1, 0.5, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => d.iterateFrames(input, 4, start).next(), /startFrame/);
  for (const physical of [-1, 0, 2, 32769, 3.5, NaN, Infinity])
    assert.throws(
      () => d.iterateFrames(input, 3, 0, physical).next(),
      /lastFrameSize/,
    );
  assert.throws(() => d.iterateFrames(input, 0, 0, 1).next(), /lastFrameSize/);
  assert.equal(opened, 0);
  assert.deepEqual([...d.iterateFrames([], 0)], []);
  assert.deepEqual([...d.iterateFrames([], 0, 0, 0)], []);
  assertCleared(d);
});

test('frame count and late truncation errors are lazy, close their sources and clear state', () => {
  const first = rawFrame(Buffer.alloc(FRAME, 65));
  const second = rawFrame(Buffer.alloc(FRAME, 66), false);
  for (const [frames, size, error] of [
    [[first], FRAME * 2, /frame count/],
    [[first, second], FRAME, /frame count/],
    [[first, second.subarray(0, -1)], FRAME * 2, /Truncated/],
  ] as const) {
    const d = decoder();
    let closed = 0;
    const input = function* (): Generator<Uint8Array> {
      try {
        for (const frame of frames) yield frame;
      } finally {
        closed++;
      }
    };
    const iterator = d.iterateFrames(input(), size, 0, FRAME);
    assert.deepEqual(iterator.next().value, Buffer.alloc(FRAME, 65));
    assert.equal(closed, 0);
    assert.throws(() => iterator.next(), error);
    assert.equal(closed, 1);
    assertCleared(d);
    assert.deepEqual(
      d.decode(new BitReader(rawFrame(Buffer.from('AB'))), 2),
      Buffer.from('AB'),
    );
  }
});

test('throw and consumer break clear decoder state without pulling a later frame', () => {
  for (const mode of ['throw', 'break']) {
    const d = decoder();
    let closed = 0;
    let requested = 0;
    const input = function* (): Generator<Uint8Array> {
      try {
        requested++;
        yield rawFrame(Buffer.alloc(FRAME, 65));
        throw new Error('unexpected pull');
      } finally {
        closed++;
      }
    };
    const iterator = d.iterateFrames(input(), FRAME * 2, 0, FRAME);
    if (mode === 'throw') {
      iterator.next();
      assert.throws(
        () => iterator.throw(new Error('consumer failed')),
        /consumer failed/,
      );
    } else {
      for (const frame of iterator) {
        assert.equal(frame.length, FRAME);
        break;
      }
    }
    assert.equal(closed, 1);
    assert.equal(requested, 1);
    assertCleared(d);
  }
});

test('raw block continuation and deferred odd padding survive frame buffers', () => {
  const seed = Buffer.alloc(FRAME, 65);
  const first = rawFrame(seed, true, 0, FRAME + 3);
  const second = Buffer.concat([
    Buffer.from('XYZ\0'),
    rawFrame(Buffer.from('D'), false),
  ]);
  const d = decoder();
  assert.deepEqual(
    Buffer.concat([...d.iterateFrames([first, second], FRAME + 4, 0, 4)]),
    Buffer.concat([seed, Buffer.from('XYZD')]),
  );
  assertCleared(d);
});

test('a declared block cannot cross a reset in lazy decoding', () => {
  const d = decoder(FRAME);
  const first = rawFrame(Buffer.alloc(FRAME, 65), true, 0, FRAME + 1);
  const iterator = d.iterateFrames(
    [first, rawFrame(Buffer.alloc(FRAME, 66))],
    FRAME * 2,
  );
  assert.equal(iterator.next().value!.length, FRAME);
  assert.throws(() => iterator.next(), /reset boundary/);
  assertCleared(d);
});

test('physical E8 tails and reset-local origins survive lazy frame boundaries', () => {
  const data = Buffer.alloc(FRAME, 0x90);
  data[1] = 0xe8;
  data.writeInt32LE(100000, 2);
  data[FRAME - 10] = 0xe8;
  data.writeInt32LE(100000, FRAME - 9);
  const thirdData = Buffer.from(data);
  thirdData.writeInt32LE(-1, 2);
  const frames = [
    rawFrame(data, true, 200000),
    rawFrame(data, false),
    rawFrame(thirdData, true, 300000),
  ];
  const d = decoder();
  const expected = Buffer.concat([data, data, data.subarray(0, 4)]);
  expected.writeInt32LE(99999, 2);
  expected.writeInt32LE(100000 - FRAME - 1, FRAME + 2);
  const third = Buffer.from(thirdData);
  third.writeInt32LE(299999, 2);
  third.copy(expected, FRAME * 2, 0, 4);
  assert.deepEqual(
    Buffer.concat([...d.iterateFrames(frames, FRAME * 2 + 4, 0, FRAME)]),
    expected,
  );
  assert.deepEqual(
    Buffer.concat([...d.iterateFrames([frames[2]!], 4, 2, FRAME)]),
    third.subarray(0, 4),
  );
  assert.deepEqual(
    [
      ...d.iterateFrames([rawFrame(Buffer.alloc(FRAME, 65))], FRAME, 2, FRAME),
    ][0],
    Buffer.alloc(FRAME, 65),
  );
});

test('independent aligned CAB fixture retains decodeFrames prefix semantics', () => {
  const compressed = Buffer.from(
    'W4CAjQAQsgsAAAAAIgAAVQ5DwFLyPoyLc0HwCF6REaaXvEeof38gLAAAAAAwAgMAeCAxjY1gXxN+v0AQAAAAAAAAhgiKIS/jc9G+75edl5rRATnYFLO8JllXPyYZBGGm4+SP3yHadtD1OVPaCo6XuQC2',
    'base64',
  );
  const d = new LZXDecoder({
    signature: 'LZXC',
    version: 2,
    windowSize: 262144,
    resetInterval: FRAME * 2,
    cacheSize: 0,
    unknown: 0,
  });
  for (const size of [1, 2, 15, 186, 187]) {
    for (const physical of [undefined, 187]) {
      const expected = d.decodeFrames([compressed], size, 0, physical);
      assert.deepEqual(
        Buffer.concat([...d.iterateFrames([compressed], size, 0, physical)]),
        expected,
      );
    }
  }
});
