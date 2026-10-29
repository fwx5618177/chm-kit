import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import type { PackOptions } from '../core/types';
import {
  readArchiveForVerification,
  compareArchiveFiles,
} from './archive-validation';

interface ArchiveSections {
  headers: Buffer[];
  resetTable: Buffer;
  directory: Buffer;
  content: Buffer;
}

/** Filesystem output and independent parse/extract/byte-compare verification. */
export class CHMFileWriter {
  static async writeArchiveBuffer(
    outputPath: string,
    data: Buffer,
    options: Partial<PackOptions> = {},
    expectedFiles?: ReadonlyMap<string, Uint8Array>,
    onProgress?: (written: number, total: number) => void,
  ): Promise<void> {
    let original: Map<string, Buffer> | undefined;
    if (
      options.validateBeforeWrite !== false ||
      options.verifyAfterWrite !== false
    ) {
      original = readArchiveForVerification(data);
      if (expectedFiles) compareArchiveFiles(original, expectedFiles);
    }
    await fs.mkdir(dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, data);
    onProgress?.(data.length, data.length);
    if (options.verifyAfterWrite !== false) {
      const written = await fs.readFile(outputPath);
      const extracted = readArchiveForVerification(written);
      if (!written.equals(data))
        throw new Error('CHM file bytes changed during disk write');
      if (original) compareArchiveFiles(extracted, original, true);
      if (expectedFiles) compareArchiveFiles(extracted, expectedFiles);
    }
  }

  /** Compatibility adapter for callers already supplying serialized sections. */
  static async writeCHMFile(
    outputPath: string,
    sections: ArchiveSections,
    options: Partial<PackOptions> = {},
  ): Promise<void> {
    await this.writeArchiveBuffer(outputPath, this.combine(sections), options);
  }

  static async writeCHMFileWithProgress(
    outputPath: string,
    sections: ArchiveSections,
    onProgress?: (written: number, total: number) => void,
    options: Partial<PackOptions> = {},
  ): Promise<void> {
    await this.writeArchiveBuffer(
      outputPath,
      this.combine(sections),
      options,
      undefined,
      onProgress,
    );
  }

  static estimateFileSize(sections: ArchiveSections): number {
    return (
      sections.headers.reduce((sum, buffer) => sum + buffer.length, 0) +
      sections.resetTable.length +
      sections.directory.length +
      sections.content.length
    );
  }

  static async createTempCHMFile(
    sections: ArchiveSections,
    tempDir = 'dist/test-tmp',
  ): Promise<string> {
    await fs.mkdir(tempDir, { recursive: true });
    const directory = await fs.mkdtemp(join(tempDir, 'chm-'));
    const output = join(directory, 'archive.chm');
    try {
      await this.writeCHMFile(output, sections);
      return output;
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private static combine(sections: ArchiveSections): Buffer {
    return Buffer.concat([
      ...sections.headers,
      sections.resetTable,
      sections.directory,
      sections.content,
    ]);
  }
}
