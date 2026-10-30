import { describe, expect, it, vi } from 'vitest';
import {
  ArchivePathResolver,
  PreviewLimitError,
  createArchivePreview,
  parseArchiveSrcset,
  rewriteArchiveCSS,
  type ArchiveResourceReader,
} from '../../src/browser-resources';

function reader(
  files: Record<string, string | Uint8Array>,
): ArchiveResourceReader {
  const data = new Map(
    Object.entries(files).map(([path, value]) => [
      path,
      typeof value === 'string' ? new TextEncoder().encode(value) : value,
    ]),
  );
  return {
    listFiles: () => [...data.keys()],
    readFile: vi.fn(path => {
      const bytes = data.get(path);
      if (!bytes) throw new Error('Missing resource');
      return bytes;
    }),
    getFileSize: path => data.get(path)!.length,
    getMimeType: path =>
      path.endsWith('.css')
        ? 'text/css'
        : path.endsWith('.woff2')
          ? 'font/woff2'
          : path.endsWith('.html')
            ? 'text/html'
            : 'image/png',
  };
}
function cssURLs(css: string): string[] {
  return [...css.matchAll(/data:text\/css;base64,([\w+/=]+)/g)].map(match =>
    new TextDecoder().decode(
      Uint8Array.from(atob(match[1]), char => char.charCodeAt(0)),
    ),
  );
}

describe('archive path/URL boundary', () => {
  const resolver = new ArchivePathResolver([
    '/index.html',
    '/docs/page.html',
    '/hash#name%.html',
    '/hash',
    '/space here.png',
    '/%2f.png',
    '/图.png',
  ]);
  it('distinguishes raw names, URL suffixes and explicit auto mode without double decoding', () => {
    expect(resolver.resolve('/hash#name%.html', '/', 'raw')).toEqual({
      path: '/hash#name%.html',
      query: '',
      fragment: '',
    });
    expect(resolver.resolve('/hash#name%.html', '/', 'url')).toEqual({
      path: '/hash',
      query: '',
      fragment: '#name%.html',
    });
    expect(
      resolver.resolve('/hash#name%.html?x=1#heading', '/', 'auto'),
    ).toEqual({
      path: '/hash#name%.html',
      query: '?x=1',
      fragment: '#heading',
    });
    expect(
      resolver.resolve('../hash%23name%25.html?x=1#heading', '/docs/page.html'),
    ).toEqual({
      path: '/hash#name%.html',
      query: '?x=1',
      fragment: '#heading',
    });
    expect(resolver.resolve('?x=1#heading', '/index.html')).toEqual({
      path: '/index.html',
      query: '?x=1',
      fragment: '#heading',
    });
    expect(resolver.resolve('#heading?not-query', '/index.html')).toEqual({
      path: '/index.html',
      query: '',
      fragment: '#heading?not-query',
    });
    expect(
      resolver.resolve('../space%20here.png', '/docs/page.html')?.path,
    ).toBe('/space here.png');
    expect(resolver.resolve('/%252f.png')?.path).toBe('/%2f.png');
    expect(resolver.resolve('/%E5%9B%BE.png')?.path).toBe('/图.png');
    expect(resolver.resolve('/INDEX.HTML')?.path).toBe('/index.html');
  });
  it.each([
    'https://evil.invalid/x',
    '//evil.invalid/x',
    '\\evil.invalid\\x',
    'javascript:alert(1)',
    'data:image/png;base64,AA==',
    'blob:https://host/x',
    'file:///index.html',
    '../../index.html',
    '/%2findex.html',
    '/%5cindex.html',
    '/%00index.html',
    '/%zz.png',
    'http:\n//evil.invalid/x',
  ])('fails closed for %s', value => {
    expect(resolver.resolve(value, '/docs/page.html')).toBeUndefined();
  });
  it('rejects ambiguous listings and very long URLs', () => {
    expect(() => new ArchivePathResolver(['/A', '/a'])).toThrow('Ambiguous');
    expect(resolver.resolve('x'.repeat(8193))).toBeUndefined();
  });
});

describe('bounded archive CSS and srcset rewriting', () => {
  it('recursively rewrites nested imports relative to each CSS file, including cycles/media and query/fragment', () => {
    const source = reader({
      '/styles/a.css':
        '@import "nested/b.css?version=1" screen; body{background:url("../space%20here.png?cache=2#icon")}',
      '/styles/nested/b.css':
        '@import "../a.css"; .nested{background:url("../../space%20here.png")}',
      '/space here.png': new Uint8Array([1, 2, 3]),
    });
    const result = rewriteArchiveCSS(
      source,
      '@import "styles/a.css";',
      '/index.html',
    );
    const [a] = cssURLs(result.css),
      [b] = cssURLs(a);
    expect(a).toContain(' screen;');
    expect(a).toContain('data:image/png;base64,AQID#icon');
    expect(b).toContain('@import url("data:text/css,")');
    expect(b).toContain('data:image/png;base64,AQID');
    expect(result.stats.resources).toBe(3);
    expect(result.stats.blocked).toBe(1);
    expect(source.readFile).toHaveBeenCalledTimes(3);
  });
  it('recognizes escaped CSS URL/import identifiers, comments and string-based image-set, blocking network/active types', () => {
    const source = reader({
      '/good.png': new Uint8Array([1]),
      '/script.html': '<script>bad()</script>',
      '/font.woff2': new Uint8Array([2]),
    });
    const result = rewriteArchiveCSS(
      source,
      String.raw`@\69mport "\68ttps://evil.invalid/a.css"; .x{a:u\72l(\68ttps://evil.invalid/x);b:image-set("https://evil.invalid/a" 1x, "good.png" 2x);c:url(script.html);d:url(font.woff2);e:expression(alert(1))}`,
      '/index.html',
    );
    expect(result.css).not.toContain('evil.invalid');
    expect(result.css).not.toContain('script.html');
    expect(result.css).not.toContain('expression');
    expect(result.css).toContain('data:image/png;base64,AQ==');
    expect(result.css).toContain('data:font/woff2;base64,Ag==');
    expect(result.stats.blocked).toBe(4);
  });
  it('encodes hostile resource fragments before embedding into CSS or srcset URLs', () => {
    const source = reader({ '/a.png': new Uint8Array([1]) });
    const result = rewriteArchiveCSS(
      source,
      `a{background:url('a.png#");x:url(https://evil.invalid/)')}`,
      '/index.html',
    );
    expect(result.css).toContain(
      '#%22)%3Bx%3Aurl(https%3A%2F%2Fevil.invalid%2F)',
    );
    expect(result.css).not.toContain('url(https://');
  });
  it('accepts density/width descriptors and commas in URLs without naive comma splitting', () => {
    expect(
      parseArchiveSrcset(
        'a,b.png 1x, b.png 2x, c.png 320w, bad.png 0x, bad.png 1x 2x',
      ),
    ).toEqual([
      { url: 'a,b.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
      { url: 'c.png', descriptor: '320w' },
    ]);
    expect(parseArchiveSrcset('a.png, b.png')).toEqual([
      { url: 'a.png', descriptor: '' },
      { url: 'b.png', descriptor: '' },
    ]);
    expect(
      parseArchiveSrcset('data:image/png;base64,AA== 1x, good.png 2x'),
    ).toHaveLength(2);
    expect(() => parseArchiveSrcset('a 1x,b 2x', 1)).toThrow(PreviewLimitError);
  });
  it('bounds resources, references, bytes, expansion, recursion and srcset input', () => {
    const source = reader({
      '/a.css': '@import "a.css";',
      '/x.png': new Uint8Array(20),
    });
    expect(() =>
      rewriteArchiveCSS(source, 'a{a:url(x.png);b:url(x.png)}', '/index.html', {
        limits: { maxReferences: 1 },
      }),
    ).toThrow(/reference count/);
    expect(() =>
      rewriteArchiveCSS(
        source,
        '@import "a.css";a{a:url(x.png)}',
        '/index.html',
        { limits: { maxResources: 1 } },
      ),
    ).toThrow(/resource count/);
    const small = reader({ '/x.png': new Uint8Array(20) });
    expect(() =>
      rewriteArchiveCSS(small, 'a{a:url(x.png)}', '/index.html', {
        limits: { maxBytes: 19 },
      }),
    ).toThrow(/input bytes/);
    expect(small.readFile).not.toHaveBeenCalled();
    expect(() =>
      rewriteArchiveCSS(source, 'a{a:url(x.png)}', '/index.html', {
        limits: { maxOutputBytes: 10 },
      }),
    ).toThrow(/expanded resources/);
    expect(() =>
      rewriteArchiveCSS(source, '('.repeat(40), '/index.html'),
    ).toThrow(/nesting/);
    expect(() =>
      rewriteArchiveCSS(source, '', '/index.html', {
        limits: { maxDepth: 33 },
      }),
    ).toThrow(RangeError);
    expect(() => parseArchiveSrcset('a'.repeat(65537))).toThrow(
      PreviewLimitError,
    );
    expect(() => createArchivePreview(source, '/index.html')).toThrow(
      /browser DOM/,
    );
  });
});
