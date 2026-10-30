import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { packTemplate } from '../../src/encoder/archive-builder';
import { readArchiveForVerification } from '../../src/encoder/archive-validation';
import { CHMArchive } from '../../src/reader/chm-archive';
import { sevenZip } from '../support/sevenzip';

const literal = Buffer.from(
  '<title>{{title}}</title><script>throw new Error("must not execute")</script>${notAnExpression}',
);

for (const compression of [false, true]) {
  test(`content templates copy assets, replace/add/delete whole files and remain reusable (compression=${compression})`, () => {
    const navigation = Buffer.from(
      '<ul><li><object type="text/sitemap"><param name="Name" value="Authored"><param name="Local" value="Index.HTML"></object></ul>',
    );
    const asset = Uint8Array.of(0, 17, 128, 255);
    const template = new Map<string, Uint8Array>([
      ['Index.HTML', literal],
      ['literal.html', literal],
      ['obsolete.html', Buffer.from('remove me')],
      ['assets/style.bin', asset],
      ['authored.hhc', navigation],
    ]);
    const overrides = new Map<string, Uint8Array | null>([
      ['index.html', Buffer.from('<title>Product A</title>New page')],
      ['obsolete.html', null],
      ['chapter/topic.htm', Buffer.from('<title>Added</title>New chapter')],
    ]);
    const first = packTemplate(template, overrides, {
      compression,
      title: 'Product A',
    });
    const files = readArchiveForVerification(first);
    assert.equal(
      files.get('/Index.HTML')!.toString(),
      '<title>Product A</title>New page',
    );
    assert.equal(files.has('/index.html'), false);
    assert.equal(files.has('/obsolete.html'), false);
    assert.equal(
      files.get('/chapter/topic.htm')!.toString(),
      '<title>Added</title>New chapter',
    );
    assert.deepEqual(files.get('/assets/style.bin'), Buffer.from(asset));
    assert.deepEqual(files.get('/literal.html'), literal);
    assert.deepEqual(files.get('/authored.hhc'), navigation);
    assert.strictEqual(template.get('Index.HTML'), literal);
    assert.equal(template.has('obsolete.html'), true);
    assert.equal(template.has('chapter/topic.htm'), false);
    assert.equal(overrides.size, 3);
    const second = new CHMArchive(
      packTemplate(template, new Map(), { compression }),
    );
    assert.deepEqual(second.readFile('Index.HTML'), literal);
    assert.equal(second.exists('obsolete.html'), true);
    assert.equal(second.getTOC()[0]!.name, 'Authored');
    second.close();
  });
}

test('template aliases, unsafe paths and ambiguous or nonempty deletions fail transactionally', () => {
  const template = new Map([
    ['index.html', literal],
    ['directory/data.bin', Buffer.from('keep')],
  ]);
  for (const overrides of [
    new Map([['missing.html', null]]),
    new Map([['../escape', Buffer.from('bad')]]),
    new Map([['#SYSTEM', Buffer.from('bad')]]),
    new Map([['CON.txt', Buffer.from('bad')]]),
    new Map([['directory/', null]]),
    new Map([['directory', Buffer.from('conflict')]]),
    new Map([
      ['new.html', Buffer.from('one')],
      ['/NEW.HTML', Buffer.from('two')],
    ]),
  ])
    assert.throws(() => packTemplate(template, overrides));
  const removed = readArchiveForVerification(
    packTemplate(
      template,
      new Map([
        ['directory/', null],
        ['directory/data.bin', null],
      ]),
    ),
  );
  assert.equal(removed.has('/directory/'), false);
  assert.deepEqual(template.get('directory/data.bin'), Buffer.from('keep'));
  assert.throws(
    () =>
      packTemplate(
        new Map([
          ['café.html', literal],
          ['cafe\u0301.html', literal],
        ]),
        new Map(),
      ),
    /Duplicate/,
  );
  const composed = packTemplate(
    new Map([['cafe\u0301.html', literal]]),
    new Map([['café.html', Buffer.from('replacement')]]),
  );
  assert.equal(
    readArchiveForVerification(composed).get('/cafe\u0301.html')!.toString(),
    'replacement',
  );
});

(sevenZip ? test : test.skip)(
  '7-Zip restores composed content templates and independent navigation templates byte-for-byte',
  () => {
    mkdirSync('dist/test-tmp', { recursive: true });
    const directory = mkdtempSync('dist/test-tmp/template-');
    try {
      for (const compression of [false, true]) {
        const archive = packTemplate(
          new Map([
            ['index.html', literal],
            ['assets/raw.bin', Buffer.from([255, 0, 128])],
          ]),
          new Map([
            [
              'index.html',
              Buffer.from('<title>产品帮助</title>Composed content'),
            ],
            ['chapter/page.html', literal],
          ]),
          {
            compression,
            blockSize: 512,
            compressionLevel: 9,
            tocEntries: [
              {
                name: 'Book',
                children: [
                  { name: 'Start', local: 'index.html' },
                  { name: 'Literal template', local: 'chapter/page.html' },
                ],
              },
            ],
            tocTemplate:
              '<html><body data-navigation-template="yes"><ul>{{entries}}</ul></body></html>',
          },
        );
        const input = join(directory, `${compression}.chm`);
        const output = join(directory, `out-${compression}`);
        writeFileSync(input, archive);
        execFileSync(sevenZip!, ['x', '-y', `-o${output}`, input], {
          timeout: 20000,
        });
        for (const [name, data] of readArchiveForVerification(archive)) {
          if (name.startsWith('/') && !name.endsWith('/'))
            assert.deepEqual(
              readFileSync(join(output, name.slice(1))),
              data,
              name,
            );
        }
        assert.deepEqual(
          readFileSync(join(output, 'chapter/page.html')),
          literal,
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
