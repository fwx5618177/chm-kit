import { FileByteSource } from './file-byte-source';
import { CHMArchive } from './chm-archive';
import type {
  FileWithMetadataData,
  ReaderIOStats,
  ReaderOptions,
} from './types';

export type FileWithMetadata = FileWithMetadataData<Buffer>;

/** Node-only adapter. Import CHMArchive directly in browser builds. */
export class CHMReader extends CHMArchive {
  private filePath = '';
  private fileSource?: FileByteSource;

  static async open(
    filePath: string,
    options?: ReaderOptions,
  ): Promise<CHMReader> {
    const source = await FileByteSource.open(filePath);
    // CHMArchive owns the source and closes it if options or parsing fail.
    const reader = new CHMReader(source, options);
    reader.fileSource = source;
    reader.filePath = filePath;
    return reader;
  }

  /** Physical reads, including initialization; null for an in-memory reader. */
  getIOStats(): ReaderIOStats | null {
    return this.fileSource?.getIOStats() ?? null;
  }

  /** Original path passed to open(), or '' when constructed from memory. */
  getFilePath(): string {
    return this.filePath;
  }
}
