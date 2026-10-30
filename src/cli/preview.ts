import { constants, promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import type { CHMReader } from '../reader/chm-reader';

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A read-only snapshot, not an archive web server or a resource/link rewriter. */
export function renderPreview(
  reader: CHMReader,
  path: string,
  encoding?: string,
): string {
  const info = reader.getFileInfo(path);
  if (
    !info.mimeType.startsWith('text/') &&
    !['application/json', 'application/xml'].includes(info.mimeType)
  )
    throw new Error(
      'preview 仅支持 HTML/文本文件；二进制请使用 read --format raw',
    );
  const source = reader.readText(info.path, encoding);
  const csp =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
  const document = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${info.mimeType === 'text/html' ? source : `<pre>${escapeHTML(source)}</pre>`}`;
  // Two independent boundaries: escaped srcdoc + sandbox without capabilities.
  // inert and pointer-events prevent links/forms navigating the preview frame.
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src 'self' about:; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(info.path)}</title><style>body{font-family:system-ui}iframe{width:100%;height:85vh;border:1px solid;pointer-events:none}</style></head><body><h1>${escapeHTML(info.path)}</h1><p>只读预览：脚本、交互和外部资源已禁用；不捆绑归档资源。</p><iframe title="Archive preview" sandbox="" inert tabindex="-1" referrerpolicy="no-referrer" srcdoc="${escapeHTML(document)}"></iframe></body></html>\n`;
}

export async function writePreview(
  output: string,
  html: string,
): Promise<void> {
  const path = resolve(output);
  async function check(directory: string): Promise<void> {
    const parent = dirname(directory);
    if (parent !== directory) await check(parent);
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(`不安全的输出目录: ${directory}`);
  }
  await check(dirname(path));
  if ((await fs.realpath(dirname(path))) !== dirname(path))
    throw new Error('输出目录 realpath 不一致');
  const handle = await fs.open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o666,
  );
  try {
    await handle.writeFile(html);
  } finally {
    await handle.close();
  }
}
