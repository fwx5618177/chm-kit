import { test, describe } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  decodeEntities,
  decodeText,
  globExpression,
  mimeType,
  normalizePath,
} from '../../src/reader/reader-utils';
import { parseLinks, parseSitemap } from '../../src/reader/navigation';

describe('reader parsing helpers', () => {
  test('HTML entities and numeric Unicode scalars decode without DOM globals', () => {
    assert.equal(
      decodeEntities(
        '&amp;&lt;&gt;&quot;&apos;&nbsp;&#20013;&#x6587;&#x1f30d;',
      ),
      '&<>"\'\u00a0中文🌍',
    );
    assert.equal(
      decodeEntities('&#0;&#xD800;&#x110000; &unknown;'),
      '��� &unknown;',
    );
    assert.equal(
      decodeEntities('&Eacute;&eacute;&Auml;&auml; &constructor;'),
      'ÉéÄä &constructor;',
    );
    assert.equal(mimeType('unknown.constructor'), 'application/octet-stream');
  });
  test('TextDecoder detects BOMs and UTF-8 before language fallback', () => {
    assert.equal(decodeText(Buffer.from('中文🌍')), '中文🌍');
    assert.equal(
      decodeText(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), undefined, 'gbk'),
      '中文',
    );
    assert.equal(
      decodeText(
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from('中文', 'utf16le'),
        ]),
        'gbk',
      ),
      '中文',
    );
  });
  test('glob regex escapes literal regex syntax and supports braces/classes', () => {
    assert.equal(globExpression('**/*.html').test('index.html'), true);
    assert.equal(globExpression('**/*.html').test('nested/page.HTML'), true);
    assert.equal(globExpression('*.html').test('nested/page.html'), false);
    assert.equal(globExpression('**/*.{html,htm}').test('a/b.htm'), true);
    assert.equal(globExpression('file+[1-3].txt').test('file+2.txt'), true);
    assert.equal(globExpression('literal(a).txt').test('literal(a).txt'), true);
    assert.equal(globExpression('literal(a).txt').test('literala.txt'), false);
    assert.throws(() => globExpression('*.{html,htm'), /Unclosed brace/);
  });
  test('archive paths normalize independent of the host filesystem', () => {
    assert.equal(
      normalizePath('folder\\.\\child/../topic.htm'),
      '/folder/topic.htm',
    );
    assert.equal(
      normalizePath('::DataSpace/Storage/Content'),
      '::DataSpace/Storage/Content',
    );
    assert.equal(normalizePath('/empty/'), '/empty/');
    assert.throws(() => normalizePath('../../escape'), /escapes/);
    assert.throws(() => normalizePath('bad\0path'), /Invalid/);
  });
  test('sitemap parsing tolerates omitted LI/OBJECT closes, ignores properties and comments', () => {
    const toc = parseSitemap(
      `<object type="text/site properties"><param name="Name" value="not an entry"></object>
  <!-- <object><param name="Name" value="fake"></object> -->
  <ul><li><object type="text/sitemap"><param name="Name" value="Root &amp; group"><param name="Local" value="index.html">
  <ul><li><object type="text/sitemap"><param name="Name" value="Child"><param name="Local" value="child.htm"></object></ul>
  <li><object type="text/sitemap"><param name="Name" value="Second"></object></ul>`,
      path => `/${path}`,
    );
    assert.equal(toc.length, 2);
    assert.equal(toc[0].name, 'Root & group');
    assert.equal(toc[0].local, '/index.html');
    assert.equal(toc[0].children![0].level, 1);
    assert.equal(toc[1].level, 0);
  });
  test('link parsing decodes attributes/text and excludes script/style/comment content', () => {
    const links = parseLinks(
      '<!-- <a href="hidden">bad</a> --><script><a href="bad">bad</a></script><a href="page.htm?a=1&amp;b=2"><b>A</b> &amp; B</a><a href="javascript:evil()">bad</a>',
      local => `/${local}`,
    );
    assert.equal(links.length, 1);
    assert.equal(links[0].name, 'A & B');
    assert.equal(links[0].local, '/page.htm?a=1&b=2');
  });
});
