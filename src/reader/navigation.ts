import type { NavigationEntry, NavLink } from './types';
import { attributes, decodeEntities } from './reader-utils';

const TAGS = /<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>/g;

/** HHC/HHK are often invalid HTML: LI closing tags and even OBJECT closes may be omitted. */
export function parseSitemap(
  html: string,
  resolve: (local: string) => string,
): NavigationEntry[] {
  const roots: NavigationEntry[] = [];
  const stack: NavigationEntry[][] = [roots];
  let pending: Record<string, string> | undefined;
  function commit(): void {
    if (!pending) return;
    if (pending.name || pending.local) {
      stack[stack.length - 1].push({
        name: pending.name ?? pending.local,
        local: pending.local ? resolve(pending.local) : '',
        level: 0,
      });
    }
    pending = undefined;
  }
  const source = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const match of source.matchAll(TAGS)) {
    const tag = match[0];
    if (tag.startsWith('<!--')) continue;
    const name = /^<\s*(\/?\w+)/.exec(tag)?.[1].toLowerCase();
    if (name === 'object') {
      commit();
      const type = attributes(tag).type;
      if (!type || type.toLowerCase() === 'text/sitemap')
        pending = Object.create(null);
    } else if (name === 'param' && pending) {
      const attr = attributes(tag);
      if (attr.name && attr.value !== undefined)
        pending[attr.name.toLowerCase()] = attr.value;
    } else if (name === '/object' || name === 'li' || name === '/li') commit();
    else if (name === 'ul') {
      commit();
      const current = stack[stack.length - 1];
      const parent = current[current.length - 1];
      if (parent) {
        parent.children ??= [];
        stack.push(parent.children);
      } else stack.push(current);
    } else if (name === '/ul') {
      commit();
      if (stack.length > 1) stack.pop();
    }
  }
  commit();
  // Iterative traversal avoids recursion limits on malformed/deep sitemaps.
  const queue = roots.map(node => ({ node, level: 0 }));
  for (let i = 0; i < queue.length; i++) {
    const { node, level } = queue[i];
    node.level = level;
    for (const child of node.children ?? [])
      queue.push({ node: child, level: level + 1 });
  }
  return roots;
}

/** Extracts anchors and LINK relations, never executes or renders archived HTML. */
export function parseLinks(
  html: string,
  resolve: (local: string) => string,
): NavLink[] {
  const result: NavLink[] = [];
  const source = html.replace(
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  const expression =
    /<a\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/a\s*>|<link\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  for (const match of source.matchAll(expression)) {
    const attr = attributes(match[1] ?? match[3]);
    if (!attr.href || /^(?:javascript|data|vbscript):/i.test(attr.href.trim()))
      continue;
    result.push({
      name:
        decodeEntities((match[2] ?? '').replace(/<[^>]*>/g, '')).trim() ||
        attr.title ||
        attr.rel ||
        attr.href,
      href: attr.href,
      local: resolve(attr.href),
      ...(attr.rel ? { rel: attr.rel } : {}),
    });
  }
  return result;
}
