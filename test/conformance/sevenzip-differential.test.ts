import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { packFiles } from '../../src/encoder/archive-builder';
import { CHMArchive } from '../../src/reader/chm-archive';
import { sevenZip } from '../support/sevenzip';
import { temporaryDirectory } from './artifacts';
import {
  corpusRoot,
  fixtureBytes,
  normalArchives,
  oracleBytes,
  seededRandom,
  sha256,
} from './corpus';

function run7z(args: string[]): void {
  const child = spawnSync(sevenZip!, args, {
    timeout: 15_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
}

function extractedNames(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    expect(entry.isSymbolicLink()).toBe(false);
    const path = `${prefix}${entry.name}`;
    return entry.isDirectory()
      ? extractedNames(join(directory, entry.name), `${path}/`)
      : [`/${path}`];
  });
}

for (const archive of normalArchives) {
  (sevenZip ? test : test.skip)(
    `fresh independent t/x checks every resource of ${archive.file}`,
    () => {
      const directory = temporaryDirectory('sevenzip');
      try {
        run7z(['t', join(corpusRoot, archive.file)]);
        run7z(['x', '-y', `-o${directory}`, join(corpusRoot, archive.file)]);
        expect(extractedNames(directory).sort()).toEqual(
          archive.files.map(file => file.name).sort(),
        );
        const reader = new CHMArchive(fixtureBytes(archive.file));
        try {
          for (const file of archive.files) {
            const fresh = readFileSync(join(directory, file.name.slice(1)));
            expect(sha256(fresh), file.name).toBe(file.sha256);
            expect(fresh, file.name).toEqual(oracleBytes(file));
            expect(reader.readFile(file.name), file.name).toEqual(fresh);
          }
        } finally {
          reader.close();
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
}

for (const seed of [0x10203040, 0xdecafbad, 0xc41f2026]) {
  for (const compression of [false, true]) {
    (sevenZip ? test : test.skip)(
      `seeded writer differential seed=${seed.toString(16)} compression=${compression}`,
      () => {
        const random = seededRandom(seed);
        const binary = Buffer.alloc(32771);
        for (let i = 0; i < binary.length; i++) binary[i] = random() & 255;
        const files = new Map<string, Uint8Array>([
          [
            'index.html',
            Buffer.from('<meta charset="utf-8"><title>独立互通</title>CHM'),
          ],
          [
            'chapter/repeat.txt',
            Buffer.from('多帧 history reset\n'.repeat(7000)),
          ],
          ['binary/payload.bin', binary],
          [
            'spaces/space # 100%.txt',
            Buffer.from('literal # and % are path bytes'),
          ],
          ['encoded/gbk.txt', Buffer.from('d6d0cec4b2e2cad4', 'hex')],
          ['empty.bin', Buffer.alloc(0)],
        ]);
        const directory = temporaryDirectory('writer-oracle');
        try {
          const path = join(directory, 'generated.chm');
          const output = join(directory, 'extracted');
          writeFileSync(
            path,
            packFiles(files, {
              compression,
              title: 'independent 7-Zip differential',
              defaultTopic: 'index.html',
            }),
          );
          run7z(['t', path]);
          run7z(['x', '-y', `-o${output}`, path]);
          // Expectations are source bytes created BEFORE invoking the writer;
          // 7-Zip is the independent decoder, never chm-kit's own read output.
          for (const [name, expected] of files) {
            const actual = readFileSync(join(output, name));
            expect(actual, name).toEqual(Buffer.from(expected));
          }
          expect(extractedNames(output)).toContain('/encoded/gbk.txt');
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
    );
  }
}
