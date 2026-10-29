/** LZX consumes the most significant bits of little-endian 16-bit words. */
export class LZXBitReader {
  public position = 0;
  private word = 0;
  private bitsLeft = 0;

  constructor(private readonly input: Uint8Array) {}

  read(bits: number): number {
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
      throw new Error('Invalid LZX bit count');
    }
    // A failed read must not consume part of a word before discovering EOF.
    if (bits > this.bitsLeft + Math.floor(this.remainingBytes / 2) * 16) {
      throw new Error('Truncated LZX input');
    }
    let value = 0;
    while (bits > 0) {
      if (this.bitsLeft === 0) {
        this.requireBytes(2);
        this.word =
          this.input[this.position]! | (this.input[this.position + 1]! << 8);
        this.position += 2;
        this.bitsLeft = 16;
      }
      const take = Math.min(bits, this.bitsLeft);
      this.bitsLeft -= take;
      value =
        value * 2 ** take + ((this.word >>> this.bitsLeft) & (2 ** take - 1));
      bits -= take;
    }
    return value;
  }

  /** A raw block discards 1..16 bits, including a whole word if aligned. */
  alignUncompressed(): void {
    if (this.bitsLeft === 0) this.read(16);
    this.bitsLeft = 0;
  }

  /** Unlike raw block alignment, frame alignment discards only 0..15 bits. */
  alignFrame(): void {
    this.bitsLeft = 0;
  }

  readRaw(length: number): Uint8Array {
    if (this.bitsLeft !== 0) throw new Error('Unaligned LZX raw read');
    this.requireBytes(length);
    const bytes = this.input.subarray(this.position, this.position + length);
    this.position += length;
    return bytes;
  }

  readUInt32LE(): number {
    const bytes = this.readRaw(4);
    return (
      (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>>
      0
    );
  }

  get remainingBytes(): number {
    return this.input.length - this.position;
  }

  private requireBytes(length: number): void {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > this.remainingBytes
    ) {
      throw new Error('Truncated LZX input');
    }
  }
}
