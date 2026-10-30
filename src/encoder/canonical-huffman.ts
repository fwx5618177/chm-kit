/** Deterministic canonical codes, with optimal length limits via package-merge. */
export class CanonicalHuffman {
  readonly lengths: Uint8Array;
  readonly codes: Uint16Array;

  constructor(lengths: Uint8Array) {
    this.lengths = new Uint8Array(lengths);
    this.codes = new Uint16Array(lengths.length);
    const counts = new Uint32Array(17);
    for (const length of lengths) {
      if (length > 16) throw new Error('Huffman length exceeds 16 bits');
      if (length) counts[length]!++;
    }
    let free = 1;
    const next = new Uint32Array(17);
    for (let bits = 1; bits <= 16; bits++) {
      free = free * 2 - counts[bits]!;
      next[bits] = (next[bits - 1]! + counts[bits - 1]!) * 2;
      if (free < 0) throw new Error('Oversubscribed Huffman tree');
    }
    if (free !== 0) throw new Error('Incomplete Huffman tree');
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      const bits = lengths[symbol]!;
      if (bits) this.codes[symbol] = next[bits]!++;
    }
  }

  static fixed(count: number): CanonicalHuffman {
    if (!Number.isSafeInteger(count) || count < 2 || count > 0x10000)
      throw new Error('Huffman alphabet must contain 2..65536 symbols');
    const bits = Math.floor(Math.log2(count));
    const shortCount = 2 ** (bits + 1) - count;
    const lengths = new Uint8Array(count).fill(bits + 1);
    lengths.fill(bits, 0, shortCount);
    return new CanonicalHuffman(lengths);
  }

  static fromFrequencies(
    frequencies: readonly number[],
    maxBits = 16,
  ): CanonicalHuffman {
    if (!Number.isInteger(maxBits) || maxBits < 1 || maxBits > 16)
      throw new Error('Invalid Huffman length limit');
    if (frequencies.length < 2 || frequencies.length > 0x10000)
      throw new Error('Huffman alphabet must contain 2..65536 symbols');
    type Package = {
      weight: number;
      order: number;
      symbol?: number;
      children?: [Package, Package];
    };
    const leaves: Package[] = [];
    let total = 0;
    for (let symbol = 0; symbol < frequencies.length; symbol++) {
      const weight = frequencies[symbol]!;
      total += weight;
      if (
        !Number.isSafeInteger(weight) ||
        weight < 0 ||
        !Number.isSafeInteger(total)
      )
        throw new Error(
          'Invalid Huffman frequency: counts and their sum must be non-negative safe integers',
        );
      if (weight) leaves.push({ weight, order: symbol, symbol });
    }
    // LZX requires complete trees, including unused secondary/aligned trees.
    for (let symbol = 0; leaves.length < 2; symbol++) {
      if (!frequencies[symbol])
        leaves.push({ weight: 0, order: symbol, symbol });
    }
    if (leaves.length > 2 ** maxBits)
      throw new Error('Too many symbols for Huffman length limit');
    const compare = (a: Package, b: Package): number =>
      a.weight - b.weight || a.order - b.order;
    leaves.sort(compare);
    let list = leaves;
    let order = frequencies.length;
    for (let depth = 1; depth < maxBits; depth++) {
      const packages: Package[] = [];
      for (let index = 0; index + 1 < list.length; index += 2) {
        const left = list[index]!;
        const right = list[index + 1]!;
        packages.push({
          weight: left.weight + right.weight,
          order: order++,
          children: [left, right],
        });
      }
      list = [...leaves, ...packages].sort(compare);
    }
    const lengths = new Uint8Array(frequencies.length);
    const pending = list.slice(0, leaves.length * 2 - 2);
    while (pending.length) {
      const item = pending.pop()!;
      if (item.children) pending.push(...item.children);
      else lengths[item.symbol!]!++;
    }
    return new CanonicalHuffman(lengths);
  }

  write(
    writer: { write(value: number, bits: number): void },
    symbol: number,
  ): void {
    const bits = this.lengths[symbol]!;
    if (!bits) throw new Error(`Missing Huffman symbol: ${symbol}`);
    writer.write(this.codes[symbol]!, bits);
  }
}
