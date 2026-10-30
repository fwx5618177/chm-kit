/** Browser-only, filesystem-free archive preview construction. No host DOM insertion or fetch. */
export interface ArchiveResourceReader {
  listFiles(): string[];
  readFile(path: string): Uint8Array;
  getMimeType(path: string): string;
  getFileSize?(path: string): number;
  readText?(path: string): string;
  readHTML?(path: string): string;
}
export interface ArchiveTarget {
  /** Canonical raw archive path, never a URL or operating-system path. */
  path: string;
  query: string;
  fragment: string;
}
export type ArchiveTargetKind = 'raw' | 'url' | 'auto';
export class PreviewLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewLimitError';
  }
}

function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** URL references decode exactly once, per segment; raw filenames never decode or split. */
export class ArchivePathResolver {
  private readonly paths = new Map<string, string>();
  constructor(
    files: readonly string[],
    private readonly maxReferenceLength = 8192,
  ) {
    if (files.length > 100000)
      throw new PreviewLimitError('Too many archive paths');
    let characters = 0;
    for (const file of files) {
      characters += file.length;
      if (characters > 8 * 1024 * 1024)
        throw new PreviewLimitError('Archive path characters exceed limit');
      const normalized = this.normalize(file, '/', false);
      if (normalized) {
        const key = normalized.toLowerCase();
        if (this.paths.has(key))
          throw new Error('Ambiguous archive preview path');
        this.paths.set(key, file);
      }
    }
  }
  private normalize(
    path: string,
    base: string,
    decode: boolean,
  ): string | undefined {
    if (hasControl(path) || path.includes('\\') || path.startsWith('//'))
      return;
    const parts = path.startsWith('/')
      ? []
      : base.split('/').slice(0, -1).filter(Boolean);
    try {
      for (const encoded of path.split('/')) {
        const part = decode ? decodeURIComponent(encoded) : encoded;
        if (hasControl(part) || part.includes('/') || part.includes('\\'))
          return;
        if (!part || part === '.') continue;
        if (part === '..') {
          if (!parts.length) return;
          parts.pop();
        } else parts.push(part);
      }
    } catch {
      return;
    }
    return `/${parts.join('/')}`;
  }
  resolve(
    value: string,
    base = '/',
    kind: ArchiveTargetKind = 'url',
  ): ArchiveTarget | undefined {
    if (typeof value !== 'string' || value.length > this.maxReferenceLength)
      return;
    const input = kind === 'raw' ? value : value.trim();
    if (
      /^[a-z][a-z\d+.-]*:|^\/\//i.test(input) ||
      hasControl(input) ||
      input.includes('\\')
    )
      return;
    const find = (path: string, decode: boolean): string | undefined => {
      const normalized = this.normalize(path, base, decode);
      return normalized ? this.paths.get(normalized.toLowerCase()) : undefined;
    };
    if (kind !== 'url') {
      // Longest real raw filename wins only in explicit raw/auto mode.
      const boundaries = [input.length];
      if (kind === 'auto')
        for (let i = input.length - 1; i >= 0; i--)
          if (/[?#]/.test(input[i])) boundaries.push(i);
      for (const boundary of boundaries) {
        const path = find(input.slice(0, boundary), false);
        if (path) return { path, ...this.suffix(input.slice(boundary)) };
      }
      if (kind === 'raw') return;
    }
    const boundary = input.search(/[?#]/);
    const pathname = boundary < 0 ? input : input.slice(0, boundary);
    const path = pathname ? find(pathname, true) : find(base, false);
    if (path)
      return {
        path,
        ...this.suffix(boundary < 0 ? '' : input.slice(boundary)),
      };
    return;
  }
  private suffix(value: string): Pick<ArchiveTarget, 'query' | 'fragment'> {
    const hash = value.indexOf('#');
    return {
      query: value.startsWith('?')
        ? value.slice(0, hash < 0 ? undefined : hash)
        : '',
      fragment: hash < 0 ? '' : value.slice(hash),
    };
  }
}

export interface PreviewLimits {
  maxResources: number;
  maxReferences: number;
  maxDepth: number;
  maxBytes: number;
  maxOutputBytes: number;
  maxNodes: number;
}
export const DEFAULT_PREVIEW_LIMITS: Readonly<PreviewLimits> = Object.freeze({
  maxResources: 128,
  maxReferences: 2048,
  maxDepth: 8,
  maxBytes: 16 * 1024 * 1024,
  maxOutputBytes: 24 * 1024 * 1024,
  maxNodes: 20000,
});
export interface PreviewOptions {
  limits?: Partial<PreviewLimits>;
  objectURLs?: {
    createObjectURL(blob: Blob): string;
    revokeObjectURL(url: string): void;
  };
}
export interface PreviewStats {
  resources: number;
  references: number;
  bytes: number;
  expandedBytes: number;
  blocked: number;
}
export interface PreviewLink extends ArchiveTarget {
  label: string;
}
export interface ArchivePreview {
  html: string;
  links: PreviewLink[];
  stats: Readonly<PreviewStats>;
  /** A single owned HTML blob URL. Resources use data URLs for opaque sandbox compatibility. */
  createObjectURL(): string;
  dispose(): void;
}
export const ARCHIVE_PREVIEW_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; base-uri 'none'; form-action 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'";
const encoder = new TextEncoder();
const emptyURL = 'data:,';
function safeFragment(fragment: string): string {
  if (!fragment) return '';
  try {
    return `#${encodeURIComponent(decodeURIComponent(fragment.slice(1)))}`;
  } catch {
    return '';
  }
}
function limits(options: PreviewOptions): PreviewLimits {
  const result = { ...DEFAULT_PREVIEW_LIMITS, ...options.limits };
  for (const value of Object.values(result))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError('Preview limits must be positive safe integers');
  // Recursion is independently bounded even when supplied options are untrusted.
  if (result.maxDepth > 32)
    throw new RangeError('Preview maximum depth cannot exceed 32');
  return result;
}
function cssDecode(value: string): string {
  return value.replace(
    /\\(?:([0-9a-f]{1,6})[\t\n\f\r ]?|\r\n|[\n\r\f]|([^0-9a-f\n\r\f]))/gi,
    (_, hex: string, char: string) => {
      if (!hex) return char ?? '';
      const code = parseInt(hex, 16);
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(code);
    },
  );
}
function quoted(
  css: string,
  start: number,
): { value: string; end: number } | undefined {
  const quote = css[start];
  let i = start + 1;
  for (; i < css.length; i++) {
    if (css[i] === '\\') {
      i++;
      if (css[i] === '\r' && css[i + 1] === '\n') i++;
    } else if (css[i] === quote)
      return { value: cssDecode(css.slice(start + 1, i)), end: i + 1 };
    else if (/[\n\r\f]/.test(css[i])) return;
  }
  return;
}
function identifier(
  css: string,
  start: number,
): { value: string; end: number } {
  let i = start;
  while (i < css.length) {
    if (/[\w-]/.test(css[i]) || css.charCodeAt(i) >= 128) i++;
    else if (css[i] === '\\') {
      i++;
      const hex = /^[0-9a-f]{1,6}[\t\n\f\r ]?/i.exec(css.slice(i));
      i += hex ? hex[0].length : 1;
    } else break;
  }
  return { value: cssDecode(css.slice(start, i)).toLowerCase(), end: i };
}
function trivia(css: string, start: number): number {
  let i = start;
  for (;;) {
    while (/\s/.test(css[i] ?? '') && i < css.length) i++;
    if (css.slice(i, i + 2) !== '/*') return i;
    const end = css.indexOf('*/', i + 2);
    i = end < 0 ? css.length : end + 2;
  }
}
function urlToken(
  css: string,
  open: number,
): { value: string; end: number } | undefined {
  let i = trivia(css, open + 1);
  if (css[i] === '"' || css[i] === "'") {
    const value = quoted(css, i);
    if (!value) return;
    i = trivia(css, value.end);
    return css[i] === ')' ? { value: value.value, end: i + 1 } : undefined;
  }
  const start = i;
  for (; i < css.length; i++) {
    if (css[i] === '\\') i++;
    else if (css[i] === ')') {
      const value = css.slice(start, i).trim();
      if (/["'(]/.test(value)) return;
      return { value: cssDecode(value), end: i + 1 };
    }
  }
  return;
}

/** Small bounded CSS lexer, not a standards-complete CSS parser. Unknown syntax remains subject to CSP. */
function rewriteCSS(
  css: string,
  resource: (url: string, cssImport: boolean) => string,
  maxLength: number,
): string {
  let steps = 0;
  const scan = (
    start: number,
    stop: boolean,
    stringURLs: boolean,
    depth: number,
  ): { text: string; end: number } => {
    if (depth > 32)
      throw new PreviewLimitError('CSS function nesting exceeds limit');
    const output: string[] = [];
    let length = 0;
    const append = (value: string): void => {
      length += value.length;
      if (length > maxLength)
        throw new PreviewLimitError('Expanded CSS exceeds output limit');
      output.push(value);
    };
    let i = start;
    while (i < css.length) {
      if (++steps > css.length * 3 + 1)
        throw new PreviewLimitError('CSS scan exceeds work limit');
      if (css[i] === ')' && stop) return { text: output.join(''), end: i + 1 };
      if (css.slice(i, i + 2) === '/*') {
        const end = css.indexOf('*/', i + 2);
        i = end < 0 ? css.length : end + 2;
        append(' ');
        continue;
      }
      if (css[i] === '"' || css[i] === "'") {
        const token = quoted(css, i);
        if (!token) break;
        append(
          stringURLs
            ? `"${resource(token.value, false)}"`
            : css.slice(i, token.end),
        );
        i = token.end;
        continue;
      }
      if (css[i] === '@') {
        const token = identifier(css, i + 1);
        if (token.value === 'import') {
          const at = trivia(css, token.end);
          let reference = quoted(css, at);
          if (css[at] !== '"' && css[at] !== "'") {
            const name = identifier(css, at);
            reference =
              name.value === 'url' && css[name.end] === '('
                ? urlToken(css, name.end)
                : undefined;
          }
          if (!reference) {
            i = css.length;
            break;
          } // malformed import: discard the unsafe remainder
          const replacement = resource(reference.value, true);
          append(
            replacement
              ? `@import url("${replacement}")`
              : '@import url("data:text/css,")',
          );
          i = reference.end;
          continue;
        }
      }
      if (/[a-z_\\-]/i.test(css[i]) || css.charCodeAt(i) >= 128) {
        const token = identifier(css, i);
        if (token.end === i) {
          append(' ');
          i++;
          continue;
        }
        if (css[token.end] === '(') {
          if (token.value === 'url') {
            const value = urlToken(css, token.end);
            if (!value) {
              append(`url("${emptyURL}")`);
              break;
            }
            append(`url("${resource(value.value, false) || emptyURL}")`);
            i = value.end;
            continue;
          }
          const nested = scan(
            token.end + 1,
            true,
            ['image-set', '-webkit-image-set', 'image', 'src'].includes(
              token.value,
            ),
            depth + 1,
          );
          if (
            ['expression', 'paint', 'element', '-moz-element'].includes(
              token.value,
            )
          )
            append('none');
          else append(`${css.slice(i, token.end)}(${nested.text})`);
          i = nested.end;
          continue;
        }
        append(css.slice(i, token.end));
        i = token.end;
        continue;
      }
      if (css[i] === '(') {
        const nested = scan(i + 1, true, false, depth + 1);
        append(`(${nested.text})`);
        i = nested.end;
        continue;
      }
      append(css[i++]);
    }
    return { text: output.join(''), end: i };
  };
  return scan(0, false, false, 0).text;
}

/** WHATWG-style URL collection: commas inside a URL are not naive split points. */
export function parseArchiveSrcset(
  value: string,
  maxCandidates = 128,
): { url: string; descriptor: string }[] {
  if (value.length > 65536)
    throw new PreviewLimitError('srcset exceeds input limit');
  const result: { url: string; descriptor: string }[] = [];
  let i = 0,
    candidates = 0;
  while (i < value.length) {
    while (/[\s,]/.test(value[i] ?? '') && i < value.length) i++;
    if (i === value.length) break;
    if (++candidates > maxCandidates)
      throw new PreviewLimitError('Too many srcset candidates');
    const start = i;
    while (i < value.length && !/\s/.test(value[i])) i++;
    let url = value.slice(start, i);
    let descriptor = '';
    if (/,$/.test(url)) url = url.replace(/,+$/, '');
    else {
      const from = i;
      let depth = 0;
      while (i < value.length) {
        if (value[i] === '(') depth++;
        if (value[i] === ')') depth--;
        if (value[i] === ',' && depth <= 0) break;
        i++;
      }
      descriptor = value.slice(from, i).trim();
    }
    i++;
    if (!url) continue;
    if (
      descriptor &&
      !/^(?:[1-9]\d*w|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?x)$/i.test(
        descriptor,
      )
    )
      continue;
    if (descriptor.endsWith('x') && !(Number(descriptor.slice(0, -1)) > 0))
      continue;
    result.push({ url, descriptor });
  }
  return result;
}

class PreviewContext {
  readonly limits: PreviewLimits;
  readonly resolver: ArchivePathResolver;
  readonly stats: PreviewStats = {
    resources: 0,
    references: 0,
    bytes: 0,
    expandedBytes: 0,
    blocked: 0,
  };
  private readonly cache = new Map<string, string>();
  private readonly active = new Set<string>();
  constructor(
    readonly reader: ArchiveResourceReader,
    options: PreviewOptions,
  ) {
    this.limits = limits(options);
    this.resolver = new ArchivePathResolver(reader.listFiles());
  }
  block(): string {
    this.stats.blocked++;
    return '';
  }
  read(path: string): Uint8Array {
    if (++this.stats.resources > this.limits.maxResources)
      throw new PreviewLimitError('Preview resource count exceeds limit');
    const size = this.reader.getFileSize?.(path);
    if (
      size !== undefined &&
      (!Number.isSafeInteger(size) ||
        size < 0 ||
        size > this.limits.maxBytes - this.stats.bytes)
    )
      throw new PreviewLimitError('Preview input bytes exceed limit');
    const bytes = this.reader.readFile(path);
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('Preview reader must return Uint8Array');
    this.stats.bytes += bytes.byteLength;
    if (this.stats.bytes > this.limits.maxBytes)
      throw new PreviewLimitError('Preview input bytes exceed limit');
    return bytes;
  }
  expand(value: string): string {
    this.stats.expandedBytes += value.length;
    if (this.stats.expandedBytes > this.limits.maxOutputBytes)
      throw new PreviewLimitError('Preview expanded resources exceed limit');
    return value;
  }
  text(path: string, bytes: Uint8Array, html = false): string {
    return html && this.reader.readHTML
      ? this.reader.readHTML(path)
      : this.reader.readText
        ? this.reader.readText(path)
        : new TextDecoder().decode(bytes);
  }
  css(value: string, base: string, depth: number): string {
    if (value.length > this.limits.maxBytes)
      throw new PreviewLimitError('CSS source exceeds limit');
    return rewriteCSS(
      value,
      (url, cssImport) => {
        if (!cssImport && /^#[^\s"'<>\\]*$/.test(url)) {
          if (++this.stats.references > this.limits.maxReferences)
            throw new PreviewLimitError(
              'Preview reference count exceeds limit',
            );
          return this.expand(safeFragment(url));
        }
        return this.resource(url, base, cssImport ? 'css' : 'asset', depth + 1);
      },
      this.limits.maxOutputBytes,
    );
  }
  resource(
    value: string,
    base: string,
    kind: 'css' | 'image' | 'asset',
    depth = 0,
  ): string {
    if (++this.stats.references > this.limits.maxReferences)
      throw new PreviewLimitError('Preview reference count exceeds limit');
    if (depth > this.limits.maxDepth) return this.block();
    const target = this.resolver.resolve(value, base);
    if (!target) return this.block();
    const type = this.reader.getMimeType(target.path).toLowerCase();
    const image =
      /^image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(
        type,
      );
    const font =
      /^(?:font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|vnd\.ms-fontobject|x-font-ttf))$/.test(
        type,
      );
    if (
      !(kind === 'css'
        ? type === 'text/css'
        : kind === 'image'
          ? image
          : image || font)
    )
      return this.block();
    const key = target.path.toLowerCase();
    if (this.active.has(key)) return this.block();
    let uri = this.cache.get(key);
    if (uri === undefined) {
      this.active.add(key);
      try {
        const bytes = this.read(target.path);
        const data =
          type === 'text/css'
            ? encoder.encode(
                this.css(this.text(target.path, bytes), target.path, depth),
              )
            : type === 'image/svg+xml'
              ? encoder.encode(
                  this.svg(new TextDecoder().decode(bytes), target.path, depth),
                )
              : bytes;
        const chunks: string[] = [];
        for (let offset = 0; offset < data.length; offset += 32768)
          chunks.push(
            String.fromCharCode(...data.subarray(offset, offset + 32768)),
          );
        uri = `data:${type};base64,${btoa(chunks.join(''))}`;
        this.cache.set(key, uri);
      } finally {
        this.active.delete(key);
      }
    }
    // Query identifies no different archive bytes. Fragment remains significant for SVG/CSS targets.
    return this.expand(uri + safeFragment(target.fragment));
  }
  svg(source: string, path: string, depth: number): string {
    if (/<!DOCTYPE|<!ENTITY/i.test(source))
      return '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (
      doc.querySelector('parsererror') ||
      doc.documentElement.localName !== 'svg'
    )
      return '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const tags = new Set([
      'svg',
      'g',
      'defs',
      'path',
      'rect',
      'circle',
      'ellipse',
      'line',
      'polyline',
      'polygon',
      'text',
      'tspan',
      'title',
      'desc',
      'linearGradient',
      'radialGradient',
      'stop',
      'clipPath',
      'mask',
      'pattern',
      'use',
    ]);
    const attrs = new Set([
      'xmlns',
      'id',
      'class',
      'viewBox',
      'width',
      'height',
      'x',
      'y',
      'x1',
      'y1',
      'x2',
      'y2',
      'cx',
      'cy',
      'r',
      'rx',
      'ry',
      'd',
      'points',
      'transform',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'opacity',
      'fill-opacity',
      'stroke-opacity',
      'fill-rule',
      'clip-rule',
      'clip-path',
      'mask',
      'offset',
      'stop-color',
      'stop-opacity',
      'gradientUnits',
      'gradientTransform',
      'text-anchor',
      'font-size',
      'font-family',
      'style',
      'href',
    ]);
    const walker = doc.createTreeWalker(doc);
    let nodes = 0;
    while (walker.nextNode()) {
      if (++nodes > this.limits.maxNodes)
        throw new PreviewLimitError('SVG node count exceeds limit');
    }
    const elements = [...doc.querySelectorAll('*')];
    for (const element of elements) {
      if (
        !tags.has(element.localName) ||
        element.namespaceURI !== 'http://www.w3.org/2000/svg'
      ) {
        element.remove();
        continue;
      }
      for (const attr of [...element.attributes]) {
        if (
          !attrs.has(attr.name) ||
          (attr.name === 'href' && !/^#[\w:.-]+$/.test(attr.value))
        )
          element.removeAttributeNode(attr);
        else if (
          ['style', 'fill', 'stroke', 'clip-path', 'mask'].includes(attr.name)
        )
          element.setAttribute(attr.name, this.css(attr.value, path, depth));
      }
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  }
}

/** Useful independently of the DOM preview; also exercises recursive resource budgets. */
export function rewriteArchiveCSS(
  reader: ArchiveResourceReader,
  css: string,
  path: string,
  options: PreviewOptions = {},
): { css: string; stats: Readonly<PreviewStats> } {
  const context = new PreviewContext(reader, options);
  return { css: context.css(css, path, 0), stats: { ...context.stats } };
}

const htmlTags = new Set(
  'a abbr address article aside b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd label li link main mark nav ol p picture pre q rp rt ruby s samp section small source span strike strong style sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr title'.split(
    ' ',
  ),
);
const globalAttributes = new Set(
  'id class title lang dir role aria-label aria-hidden'.split(' '),
);
const tagAttributes: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set([
    'src',
    'srcset',
    'alt',
    'width',
    'height',
    'sizes',
    'loading',
    'decoding',
  ]),
  source: new Set(['srcset', 'sizes', 'type', 'media']),
  link: new Set(['rel', 'href', 'media']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  col: new Set(['span']),
  ol: new Set(['start', 'reversed', 'type']),
  li: new Set(['value']),
  time: new Set(['datetime']),
  font: new Set(['color', 'face', 'size']),
  details: new Set(['open']),
};

/** Never relax sandbox to use the result. Attach only to sandbox="" via the owned blob URL. */
export function createArchivePreview(
  reader: ArchiveResourceReader,
  rawPath: string,
  options: PreviewOptions = {},
): ArchivePreview {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined')
    throw new Error('Archive previews require browser DOM APIs');
  const context = new PreviewContext(reader, options);
  const target = context.resolver.resolve(rawPath, '/', 'raw');
  if (!target) throw new Error('Preview requires a raw archive file path');
  const source = context.text(target.path, context.read(target.path), true);
  if (
    source.length > context.limits.maxBytes ||
    encoder.encode(source).length > context.limits.maxBytes
  )
    throw new PreviewLimitError('HTML source exceeds limit');
  const template = document.createElement('template');
  // Template documents are inert. DOMParser(text/html) can start image requests before sanitization.
  template.innerHTML = source;
  const walker = document.createTreeWalker(template.content);
  let nodes = 0;
  while (walker.nextNode()) {
    if (++nodes > context.limits.maxNodes)
      throw new PreviewLimitError('HTML node count exceeds limit');
  }
  const elements = template.content.querySelectorAll('*');
  const links: PreviewLink[] = [];
  for (const element of elements) {
    if (!template.content.contains(element)) continue;
    const tag = element.localName;
    if (
      !htmlTags.has(tag) ||
      element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      (tag === 'source' && element.parentElement?.localName !== 'picture')
    ) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'style')
        element.setAttribute(
          'style',
          context.css(attribute.value, target.path, 0),
        );
      else if (
        !globalAttributes.has(attribute.name) &&
        !tagAttributes[tag]?.has(attribute.name)
      )
        element.removeAttributeNode(attribute);
    }
    if (tag === 'style')
      element.textContent = context.css(
        element.textContent ?? '',
        target.path,
        0,
      );
    if (tag === 'link') {
      if (element.getAttribute('rel')?.toLowerCase() !== 'stylesheet') {
        element.remove();
        continue;
      }
      const uri = context.resource(
        element.getAttribute('href') ?? '',
        target.path,
        'css',
      );
      if (uri) element.setAttribute('href', uri);
      else element.remove();
    }
    if (tag === 'img' && element.hasAttribute('src')) {
      const uri = context.resource(
        element.getAttribute('src') ?? '',
        target.path,
        'image',
      );
      if (uri) element.setAttribute('src', uri);
      else element.removeAttribute('src');
    }
    if (element.hasAttribute('srcset')) {
      const candidates = parseArchiveSrcset(
        element.getAttribute('srcset') ?? '',
      ).flatMap(candidate => {
        const uri = context.resource(candidate.url, target.path, 'image');
        return uri
          ? [`${uri}${candidate.descriptor ? ` ${candidate.descriptor}` : ''}`]
          : [];
      });
      if (candidates.length)
        element.setAttribute('srcset', candidates.join(', '));
      else element.removeAttribute('srcset');
    }
    if (tag === 'a' && element.hasAttribute('href')) {
      const resolved = context.resolver.resolve(
        element.getAttribute('href') ?? '',
        target.path,
      );
      element.removeAttribute('href');
      if (resolved) {
        if (links.length >= context.limits.maxReferences)
          throw new PreviewLimitError('Preview link count exceeds limit');
        links.push({
          ...resolved,
          label:
            (element.textContent ?? '').trim().slice(0, 512) || resolved.path,
        });
        if (resolved.path === target.path && resolved.fragment)
          element.setAttribute('href', resolved.fragment);
      } else context.block();
    }
  }
  const preview = document.implementation.createHTMLDocument('Archive preview');
  const policy = preview.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = ARCHIVE_PREVIEW_CSP;
  const charset = preview.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  preview.head.prepend(charset, policy);
  preview.body.append(template.content);
  const html = `<!doctype html>${preview.documentElement.outerHTML}`;
  if (encoder.encode(html).length > context.limits.maxOutputBytes)
    throw new PreviewLimitError('Preview HTML exceeds output limit');
  let ownedURL: string | undefined,
    disposed = false;
  const objectURLs = options.objectURLs ?? URL;
  return {
    html,
    links,
    stats: Object.freeze({ ...context.stats }),
    createObjectURL() {
      if (disposed) throw new Error('Archive preview has been disposed');
      ownedURL ??= objectURLs.createObjectURL(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
      );
      return ownedURL;
    },
    dispose() {
      if (ownedURL) objectURLs.revokeObjectURL(ownedURL);
      ownedURL = undefined;
      disposed = true;
    },
  };
}
