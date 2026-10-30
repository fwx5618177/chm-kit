import type { PackTOCEntry } from './types';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function topicURL(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Folder groups are explicit, so deeply nested orphan topics cannot disappear. */
export function inferTOC(
  files: ReadonlyMap<string, Buffer>,
  folders = false,
): PackTOCEntry[] {
  const root: PackTOCEntry[] = [];
  const groups = new Map<string, PackTOCEntry[]>();
  groups.set('', root);
  for (const [path, data] of files) {
    if (!/\.html?$/i.test(path)) continue;
    const parts = path.slice(1).split('/');
    if (folders && parts.length > 128)
      throw new Error('Navigation hierarchy exceeds 128 levels');
    const filename = parts.pop()!;
    let prefix = '';
    let children = root;
    for (const directory of folders ? parts : []) {
      prefix += `/${directory}`;
      let group = groups.get(prefix);
      if (!group) {
        group = [];
        children.push({ name: directory, children: group });
        groups.set(prefix, group);
      }
      children = group;
    }
    const title = data
      .toString('utf8')
      .match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
    children.push({
      name: title || (folders ? filename : path.slice(1)),
      local: topicURL(path.slice(1)),
    });
  }
  return root;
}

export function renderSitemap(
  entries: readonly PackTOCEntry[],
  validateLocal: (local: string) => void,
  template = '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">\n<HTML><HEAD><meta charset="utf-8"></HEAD><BODY><UL>\n{{entries}}\n</UL></BODY></HTML>',
): Buffer {
  if (template.split('{{entries}}').length !== 2)
    throw new Error('tocTemplate must contain exactly one {{entries}}');
  const ancestors = new Set<PackTOCEntry>();
  let count = 0;
  const render = (items: readonly PackTOCEntry[], depth: number): string => {
    if (depth > 128) throw new Error('Navigation hierarchy exceeds 128 levels');
    return items
      .map(entry => {
        if (++count > 10000)
          throw new Error('Navigation exceeds 10000 entries');
        if (ancestors.has(entry))
          throw new Error('Cyclic navigation hierarchy');
        if (typeof entry.name !== 'string')
          throw new Error('Invalid navigation name');
        ancestors.add(entry);
        let local = '';
        if (entry.local !== undefined) {
          validateLocal(entry.local);
          local = `<param name="Local" value="${escapeHtml(entry.local.replace(/^\/+/, ''))}">`;
        }
        const children = entry.children?.length
          ? `<UL>\n${render(entry.children, depth + 1)}\n</UL>`
          : '';
        ancestors.delete(entry);
        return `<LI><OBJECT type="text/sitemap"><param name="Name" value="${escapeHtml(entry.name)}">${local}</OBJECT>${children}</LI>`;
      })
      .join('\n');
  };
  return Buffer.from(
    template.replace('{{entries}}', () => render(entries, 0)),
    'utf8',
  );
}
