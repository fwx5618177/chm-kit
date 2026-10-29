const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  laquo: '«',
  raquo: '»',
  ensp: '\u2002',
  emsp: '\u2003',
};

const LATIN_ENTITIES = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr ' +
  'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml ' +
  'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ');
LATIN_ENTITIES.forEach((name, index) => {
  ENTITIES[name] = String.fromCharCode(0xa0 + index);
});

function lookup(map: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** Decodes numeric references and common HTML named entities without a DOM. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi,
    (original, entity: string) => {
      if (!entity.startsWith('#'))
        return (
          lookup(ENTITIES, entity) ??
          lookup(ENTITIES, entity.toLowerCase()) ??
          original
        );
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '\ufffd';
    },
  );
}

export function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const expression = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(expression)) {
    result[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4],
    );
  }
  return result;
}

export function normalizePath(path: string): string {
  if (typeof path !== 'string' || path.includes('\0'))
    throw new Error('Invalid CHM path');
  const source = path.replace(/\\/g, '/');
  const internal = source.replace(/^\/+/, '').startsWith('::');
  const parts: string[] = [];
  for (const part of source.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length)
        throw new Error(`CHM path escapes archive root: ${path}`);
      parts.pop();
    } else parts.push(part);
  }
  const normalized = `${internal ? '' : '/'}${parts.join('/')}`;
  return source.endsWith('/') && parts.length ? `${normalized}/` : normalized;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Glob supports *, **, ?, character classes and brace alternatives. */
export function globExpression(pattern: string): RegExp {
  const source = pattern.replace(/\\/g, '/').replace(/^\/+/, '');
  let regex = '';
  let braceDepth = 0;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (character === '*') {
      if (source[i + 1] === '*') {
        i++;
        if (source[i + 1] === '/') {
          regex += '(?:.*/)?';
          i++;
        } else regex += '.*';
      } else regex += '[^/]*';
    } else if (character === '?') regex += '[^/]';
    else if (character === '[') {
      const end = source.indexOf(']', i + 1);
      const content = source.slice(i + 1, end);
      if (end > i + 1 && !/[\\[]/.test(content)) {
        const body = content.startsWith('!') ? `^${content.slice(1)}` : content;
        regex += `(?!/)[${body}]`;
        i = end;
      } else regex += '\\[';
    } else if (character === '{') {
      regex += '(?:';
      braceDepth++;
    } else if (character === '}' && braceDepth) {
      regex += ')';
      braceDepth--;
    } else if (character === ',' && braceDepth) regex += '|';
    else regex += escapeRegExp(character);
  }
  if (braceDepth) throw new Error(`Unclosed brace in glob: ${pattern}`);
  try {
    return new RegExp(`^${regex}$`, 'i');
  } catch {
    throw new Error(`Invalid glob: ${pattern}`);
  }
}

function encodingLabel(encoding: string): string {
  const lower = encoding.toLowerCase().replace(/[_-]/g, '');
  const aliases: Record<string, string> = {
    utf8: 'utf-8',
    utf16le: 'utf-16le',
    ucs2: 'utf-16le',
    utf16be: 'utf-16be',
    binary: 'windows-1252',
    latin1: 'windows-1252',
  };
  return lookup(aliases, lower) ?? encoding;
}

export function languageEncoding(languageId: number): string {
  if ((languageId & 0x3ff) === 4)
    return [0x404, 0xc04, 0x1404].includes(languageId & 0xffff)
      ? 'big5'
      : 'gbk';
  if ((languageId & 0x3ff) === 0x11) return 'shift_jis';
  if ((languageId & 0x3ff) === 0x12) return 'euc-kr';
  if ((languageId & 0x3ff) === 0x19) return 'windows-1251';
  return 'windows-1252';
}

export function decodeText(
  data: Uint8Array,
  encoding?: string,
  fallback = 'windows-1252',
): string {
  let label = encoding;
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) label = 'utf-8';
  else if (data[0] === 0xff && data[1] === 0xfe) label = 'utf-16le';
  else if (data[0] === 0xfe && data[1] === 0xff) label = 'utf-16be';
  if (!label) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      label = fallback;
    }
  }
  return new TextDecoder(encodingLabel(label))
    .decode(data)
    .replace(/^\ufeff/, '');
}

export function htmlEncoding(data: Buffer): string | undefined {
  const head = data.subarray(0, 4096).toString('latin1');
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = attributes(tag);
    if (attr.charset) return attr.charset.trim();
    const charset = attr.content?.match(/charset\s*=\s*([^\s;"']+)/i)?.[1];
    if (charset) return charset;
  }
  return undefined;
}

const MIME: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  hhc: 'text/html',
  hhk: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  zip: 'application/zip',
};
export function mimeType(path: string): string {
  return (
    lookup(MIME, /\.([^./]+)$/.exec(path)?.[1].toLowerCase() ?? '') ??
    'application/octet-stream'
  );
}
