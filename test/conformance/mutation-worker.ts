import { readFileSync } from 'node:fs';
import { CHMArchive, CacheStrategy } from '../../src/reader/chm-archive';
import { sha256 } from './corpus';

interface Case {
  id: string;
  bytes: string;
  paths: string[];
}

const input = JSON.parse(readFileSync(0, 'utf8')) as Case[];
if (input.length > 96) throw new Error('Harness case budget exceeded');
for (const item of input) {
  const bytes = Buffer.from(item.bytes, 'base64');
  if (bytes.length > 32 * 1024 || item.paths.length > 32)
    throw new Error('Harness input budget exceeded');
  let reader: CHMArchive | undefined;
  let phase = 'open';
  try {
    reader = new CHMArchive(bytes, {
      cacheStrategy: CacheStrategy.None,
      maxFileSize: 512 * 1024,
      maxCacheBytes: 0,
    });
    phase = 'read';
    const names = reader.listFiles();
    if (names.length > 128) throw new Error('Harness entry budget exceeded');
    let total = 0;
    const hashes: Record<string, { length: number; sha256: string }> = {};
    for (const path of item.paths) {
      const content = reader.readFile(path);
      total += content.length;
      if (total > 256 * 1024) throw new Error('Harness output budget exceeded');
      hashes[path] = { length: content.length, sha256: sha256(content) };
    }
    if (reader.getCacheStats().bytes !== 0)
      throw new Error('Harness cache budget exceeded');
    process.stdout.write(
      `${JSON.stringify({ id: item.id, outcome: 'decoded', hashes, total })}\n`,
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.trim()) throw error;
    if (/Harness|allocation failed|out of memory/i.test(error.message))
      throw error;
    process.stdout.write(
      `${JSON.stringify({
        id: item.id,
        outcome: `${phase}Rejected`,
        error: error.message,
        errorType: error.name,
      })}\n`,
    );
  } finally {
    reader?.close();
  }
}
