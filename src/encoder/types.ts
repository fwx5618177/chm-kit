/** A heading may omit local. Local is an archive-relative URL (encode #/% in filenames). */
export interface PackTOCEntry {
  name: string;
  local?: string;
  children?: readonly PackTOCEntry[];
}

/** Actual #SYSTEM records, not an uncompiled .hhp pretending to be runtime metadata. */
export interface HTMLHelpMetadata {
  compiler?: string;
  defaultWindow?: string;
  compiledFile?: string;
  defaultFont?: string;
  /** Additional records; cannot override the named fields or language record. */
  extraRecords?: ReadonlyMap<number, Uint8Array>;
}

/** Portable options shared by the Node and browser packing APIs. */
export interface PackFilesOptions {
  title?: string;
  defaultTopic?: string;
  /** false: section 0; true/default: cost-selected LZX with stored fallback. */
  compression?: boolean;
  /** 0: stored; 1: fixed; 2–3: adaptive; 4–9: also aligned. Higher levels search deeper. */
  compressionLevel?: number;
  /** LZX dictionary exponent, 15..21 (32 KiB..2 MiB). */
  windowBits?: number;
  /** Bytes; power-of-two multiple of 32768, at most the reader's 256 MiB reset budget. */
  resetInterval?: number;
  /** Power of two, 256..32768. Frame size is always 32768 as required by CHM. */
  blockSize?: number;
  /** LCID written to ITSF, ITSP and #SYSTEM; strings emitted by this writer are UTF-8. */
  languageId?: number;
  htmlHelp?: HTMLHelpMetadata;
  /** Select existing navigation explicitly; absent navigation is generated. */
  contentsFile?: string;
  indexFile?: string;
  /** flat preserves legacy order; folders infers explicit groups, including orphan subfolders. */
  tocHierarchy?: 'flat' | 'folders';
  /** Explicit hierarchy for generated contents. Existing authored navigation is not replaced. */
  tocEntries?: readonly PackTOCEntry[];
  /** Complete HTML wrapper containing exactly one {{entries}} insertion point. */
  tocTemplate?: string;
}

/** Updates preserve metadata/navigation verbatim; compression may be changed explicitly. */
export type UpdateArchiveOptions = Pick<
  PackFilesOptions,
  | 'compression'
  | 'compressionLevel'
  | 'windowBits'
  | 'resetInterval'
  | 'blockSize'
>;
