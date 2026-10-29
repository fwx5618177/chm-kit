import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { TOCBuilder } from '../../src/encoder/builders/toc-builder';

async function withFiles(
  files: Record<string, string>,
  check: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'chmkit-toc-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const file = join(directory, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('a single deep HTML file without a parent remains a TOC root and is rendered', async () => {
  const file = 'guides/advanced/topic.html';
  await withFiles({ [file]: '<title>Deep topic</title>' }, async directory => {
    const builder = new TOCBuilder();
    const entries = await builder.buildFromFiles([file], directory);
    assert.deepEqual(entries, [{ name: 'Deep topic', local: file, level: 2 }]);
    assert.equal(builder.getTOCEntries(), entries);
    assert.ok(builder.generateHHC().includes(`name="Local" value="${file}"`));
  });
});

test('nested siblings without any shallower document are retained as separate roots', async () => {
  const files = {
    'guide/intro.html': '<title>Introduction</title>',
    'guide/second.html': '<h1>Second topic</h1>',
  };
  await withFiles(files, async directory => {
    const builder = new TOCBuilder();
    const entries = await builder.buildFromFiles(Object.keys(files), directory);
    assert.deepEqual(
      entries.map(entry => entry.local),
      Object.keys(files),
    );
    assert.deepEqual(
      entries.map(entry => entry.name),
      ['Introduction', 'Second topic'],
    );
    assert.ok(entries.every(entry => entry.children === undefined));
  });
});

test('out-of-order files retain the nearest shallower directory parent at every depth', async () => {
  const files = {
    'manual/chapter/deep/page.html': '<title>Page</title>',
    'index.html': '<title>Home</title>',
    'manual/overview.html': '<title>Manual</title>',
    'manual/chapter/intro.html': '<title>Chapter</title>',
  };
  await withFiles(files, async directory => {
    const builder = new TOCBuilder();
    const entries = await builder.buildFromFiles(Object.keys(files), directory);
    assert.deepEqual(entries, [
      {
        name: 'Home',
        local: 'index.html',
        level: 0,
        children: [
          {
            name: 'Manual',
            local: 'manual/overview.html',
            level: 1,
            children: [
              {
                name: 'Chapter',
                local: 'manual/chapter/intro.html',
                level: 2,
                children: [
                  {
                    name: 'Page',
                    local: 'manual/chapter/deep/page.html',
                    level: 3,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const hhc = builder.generateHHC();
    for (const file of Object.keys(files)) {
      assert.equal(
        hhc.split(`name="Local" value="${file}"`).length - 1,
        1,
        file,
      );
    }
  });
});

test('an orphan root can still own deeper descendants without a level-zero document', async () => {
  const files = {
    'manual/overview.html': '<title>Manual</title>',
    'manual/chapter/topic.html': '<title>Topic</title>',
  };
  await withFiles(files, async directory => {
    const entries = await new TOCBuilder().buildFromFiles(
      Object.keys(files),
      directory,
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].local, 'manual/overview.html');
    assert.equal(entries[0].children?.[0].local, 'manual/chapter/topic.html');
  });
});

test('directory-name prefixes do not make unrelated documents parent and child', async () => {
  const files = {
    'docs/index.html': '<title>Docs</title>',
    'docset/deep/topic.html': '<title>Other docs</title>',
    'docs/part/chapter.html': '<title>Chapter</title>',
  };
  await withFiles(files, async directory => {
    const entries = await new TOCBuilder().buildFromFiles(
      Object.keys(files),
      directory,
    );
    assert.deepEqual(
      entries.map(entry => entry.local),
      ['docs/index.html', 'docset/deep/topic.html'],
    );
    assert.deepEqual(
      entries[0].children?.map(entry => entry.local),
      ['docs/part/chapter.html'],
    );
    assert.equal(entries[1].children, undefined);
  });
});

test('multiple root documents retain the existing last-matching-parent grouping', async () => {
  const files = {
    'first.html': '<title>First</title>',
    'last.html': '<title>Last</title>',
    'nested/topic.html': '<title>Nested</title>',
  };
  await withFiles(files, async directory => {
    const entries = await new TOCBuilder().buildFromFiles(
      Object.keys(files),
      directory,
    );
    assert.deepEqual(
      entries.map(entry => entry.local),
      ['first.html', 'last.html'],
    );
    assert.equal(entries[0].children, undefined);
    assert.deepEqual(
      entries[1].children?.map(entry => entry.local),
      ['nested/topic.html'],
    );
  });
});

test('reusing a builder does not keep old parents or lose a new orphan', async () => {
  const files = {
    'index.html': '<title>Home</title>',
    'nested/first.html': '<title>First</title>',
    'other/deep/second.html': '<title>Second</title>',
    'notes.txt': 'not HTML',
  };
  await withFiles(files, async directory => {
    const builder = new TOCBuilder();
    await builder.buildFromFiles(
      ['index.html', 'nested/first.html'],
      directory,
    );
    const entries = await builder.buildFromFiles(
      ['other/deep/second.html'],
      directory,
    );
    assert.deepEqual(entries, [
      { name: 'Second', local: 'other/deep/second.html', level: 2 },
    ]);
    assert.ok(!builder.generateHHC().includes('first.html'));
    assert.deepEqual(
      await builder.buildFromFiles(['notes.txt'], directory),
      [],
    );
    assert.deepEqual(await builder.buildFromFiles([], directory), []);
  });
});
