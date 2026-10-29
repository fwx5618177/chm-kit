/** Portable options shared by the Node and browser packing APIs. */
export interface PackFilesOptions {
  title?: string;
  defaultTopic?: string;
  /** false: section 0; true/default: LZX LZ77/Huffman with per-frame stored fallback. */
  compression?: boolean;
}
