import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import type { PackOptions } from '../core/types';
import { packFiles } from './archive-builder';
import { DirectoryScanner } from './directory-scanner';
import { CHMFileWriter } from './chm-file-writer';

/** Filesystem adapter around the pure in-memory CHM builder. */
export class CHMEncoder {
  async encode(options: PackOptions): Promise<void> {
    const outputPath = resolve(options.outputPath);
    const fileList = await DirectoryScanner.scanDirectory(options.inputDir, {
      includeDirectories: true,
      filter: name => resolve(options.inputDir, name) !== outputPath,
    });
    // Per-call state: reusing an encoder must not retain files from earlier packs.
    const files = new Map<string, Buffer>();
    for (const name of fileList) {
      files.set(
        name,
        name.endsWith('/')
          ? Buffer.alloc(0)
          : await fs.readFile(join(options.inputDir, name)),
      );
    }
    const archive = packFiles(files, options);
    await CHMFileWriter.writeArchiveBuffer(
      options.outputPath,
      archive,
      options,
      files,
    );
  }
}
