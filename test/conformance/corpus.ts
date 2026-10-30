import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import data from '../fixtures/upstream-chm/manifest.json';
import { drainStream } from './bounded-stream';

export interface OracleFile {
  name: string;
  expectedFile: string;
  length: number;
  sha256: string;
  section: number;
  offset: number;
}

export interface CorpusArchive {
  file: string;
  kind: 'normal' | 'malformed';
  length: number;
  sha256: string;
  license: string;
  licenseFile: string;
  sourceCommitUrl: string | null;
  documentationSourceUrl?: string;
  documentationSourceArchiveUrl?: string;
  binaryBuildCommit?: string | null;
  provenanceNote?: string;
  itsfGuidPair?: string;
  producer?: { resource: string; text: string };
  downloadUrl?: string | null;
  container?: {
    sha256: string;
    member: string;
    executed: boolean;
    retained: boolean;
  };
  modified: boolean;
  gitBlobSha1?: string;
  xorInMemory?: boolean;
  observed?: {
    firstLzxBlockType: number;
    intelHeader: boolean;
    itsfVersion: number;
    languageId: number;
    directoryOffset: number;
    dataOffset: number;
    controlVersion: number;
    resetInterval: number;
    windowSize: number;
    frameCount: number;
    resetTableEntryCount: number;
    terminalResetOffset: number | null;
    resetGroups: number;
    uncompressedLength: number;
    contentOffset: number;
  };
  files: OracleFile[];
}

export const corpusRoot = resolve(__dirname, '../fixtures/upstream-chm');
export const manifest = data as {
  oracle: { chmKitUsed: boolean; tool: string };
  licenses: { file: string; sha256: string; sourceUrl: string }[];
  archives: CorpusArchive[];
};
export const normalArchives = manifest.archives.filter(
  a => a.kind === 'normal',
);
export const malformedArchives = manifest.archives.filter(
  a => a.kind === 'malformed',
);
export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
export const fixtureBytes = (name: string): Buffer =>
  readFileSync(resolve(corpusRoot, name));
export const oracleBytes = (file: OracleFile): Buffer =>
  fixtureBytes(file.expectedFile);

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

export async function consumeStream(
  stream: ReadableStream<Uint8Array>,
  expected: Uint8Array,
  maxChunk = 64 * 1024,
): Promise<void> {
  await drainStream(stream, expected.length, {
    maxChunk,
    onChunk(value, offset) {
      if (
        !Buffer.from(value).equals(
          Buffer.from(expected.subarray(offset, offset + value.length)),
        )
      )
        throw new Error(`Stream oracle mismatch at byte ${offset}`);
    },
  });
}
