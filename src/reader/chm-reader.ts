import { readFile } from 'node:fs/promises';
import { CHMArchive } from './chm-archive';
import type { FileWithMetadataData, ReaderOptions } from './types';

export type FileWithMetadata = FileWithMetadataData<Buffer>;

/** Node-only adapter. Import CHMArchive directly in browser builds. */
export class CHMReader extends CHMArchive {
  private filePath = '';

  static async open(
    filePath: string,
    options?: ReaderOptions,
  ): Promise<CHMReader> {
    const reader = new CHMReader(await readFile(filePath), options);
    reader.filePath = filePath;
    return reader;
  }

  /** Original path passed to open(), or '' when constructed from memory. */
  getFilePath(): string {
    return this.filePath;
  }
}
