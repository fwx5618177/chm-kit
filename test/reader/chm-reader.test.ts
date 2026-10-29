import { test, describe } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHMReader } from '../../src/reader/chm-reader';
import { CHMArchive } from '../../src/reader/chm-archive';
import { packFiles } from '../../src/encoder/archive-builder';

describe('CHMReader Node adapter', () => {
  for (const compression of [false, true]) {
    test(`open is async and preserves source path/options (compression=${compression})`, async () => {
      const directory = mkdtempSync('test/reader/node-reader-');
      const path = join(directory, '中文.chm');
      try {
        writeFileSync(
          path,
          packFiles(
            new Map([
              ['index.html', Buffer.from('中文首页')],
              ['empty', Buffer.alloc(0)],
            ]),
            { compression },
          ),
        );
        const opening = CHMReader.open(path, { maxCacheBytes: 32 });
        assert.ok(opening instanceof Promise);
        const reader = await opening;
        try {
          assert.ok(reader instanceof CHMArchive);
          assert.equal(reader.getFilePath(), path);
          assert.equal(reader.readHTML('index.html'), '中文首页');
          assert.equal(reader.getCacheStats().maxBytes, 32);
          assert.deepEqual(reader.readFile('empty'), Buffer.alloc(0));
        } finally {
          reader.close();
        }
        assert.equal(reader.getFilePath(), path);
        assert.equal(reader.isOpen(), false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  test('missing files and invalid CHMs reject rather than producing a half-open reader', async () => {
    const directory = mkdtempSync('test/reader/node-reader-');
    try {
      const path = join(directory, 'invalid.chm');
      writeFileSync(path, 'not a CHM');
      await assert.rejects(CHMReader.open(path));
      await assert.rejects(
        CHMReader.open(join(directory, 'missing.chm')),
        /ENOENT/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('independently produced pychm fixture: files, metadata, URI-encoded TOC links', async () => {
    const root = 'test/fixtures/pychm-example';
    const reader = await CHMReader.open(join(root, 'example.chm'));
    try {
      for (const name of [
        'page 1.html',
        'page 2.html',
        'Documents/Table of Contents.hhc',
      ]) {
        assert.deepEqual(
          reader.readFile(name),
          readFileSync(join(root, 'expected', name)),
          name,
        );
      }
      const toc = reader.getTOC();
      assert.equal(toc.length, 2);
      assert.equal(toc[0].local, '/page 1.html');
      assert.equal(toc[1].local, '/page 2.html');
      assert.ok(reader.getMetadata().title);
      assert.ok(reader.getDefaultPage());
    } finally {
      reader.close();
    }
  });
});
