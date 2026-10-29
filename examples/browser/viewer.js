import { CHMReader, packFiles } from '../../dist/browser/index.mjs';

const $ = selector => document.querySelector(selector);
let reader, source, previewUrl;

const encoder = new TextEncoder();
const status = (message, error = false) => {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
};
const bytes = size =>
  size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
const cache = () => {
  $('#cache-size').textContent = bytes(reader?.getCacheStats().bytes ?? 0);
};
function revokeResources() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
}
function internalPath(value, base) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return null;
  try {
    const url = new URL(value, `https://archive.invalid${base}`);
    if (url.origin !== 'https://archive.invalid') return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}
function resource(value, base, depth = 0) {
  const path = internalPath(value, base);
  if (!path || !reader.exists(path) || depth > 8) return '';
  const type = reader.getMimeType(path);
  // Never create navigable HTML/script blobs from resource URLs.
  if (!/^(?:image\/|font\/|text\/css)/.test(type)) return '';
  const data =
    type === 'text/css'
      ? reader
          .readText(path)
          .replace(/@import\s+[^;]+;?/gi, '')
          .replace(
            /url\(\s*['"]?([^'"()]+)['"]?\s*\)/gi,
            (_, url) => `url("${resource(url.trim(), path, depth + 1)}")`,
          )
      : reader.readFile(path);
  // Opaque sandbox origins cannot dereference parent-origin blob resources.
  // Embed bytes instead of weakening the sandbox with allow-same-origin.
  const buffer = typeof data === 'string' ? encoder.encode(data) : data;
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += 32768)
    chunks.push(
      String.fromCharCode(...buffer.subarray(offset, offset + 32768)),
    );
  return `data:${type};base64,${btoa(chunks.join(''))}`;
}
function renderHTML(html, path) {
  // Template contents are inert: even same-origin image/event-handler probes
  // must not run while untrusted markup is being parsed and rewritten.
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  content
    .querySelectorAll(
      'script,iframe,frame,frameset,object,embed,form,base,meta[http-equiv]',
    )
    .forEach(node => node.remove());
  for (const element of content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (
        /^on/i.test(attribute.name) ||
        ['srcdoc', 'srcset', 'ping', 'action', 'formaction'].includes(
          attribute.name,
        )
      )
        element.removeAttribute(attribute.name);
    }
  }
  for (const element of content.querySelectorAll('[src]'))
    element.setAttribute('src', resource(element.getAttribute('src'), path));
  for (const element of content.querySelectorAll('link')) {
    if (element.getAttribute('rel')?.toLowerCase() !== 'stylesheet')
      element.remove();
    else
      element.setAttribute(
        'href',
        resource(element.getAttribute('href') ?? '', path),
      );
  }
  for (const anchor of content.querySelectorAll('a[href]')) {
    anchor.setAttribute('href', '#');
    anchor.removeAttribute('target');
  }
  const preview = document.implementation.createHTMLDocument('');
  preview.body.append(content);
  const policy = preview.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content =
    "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; base-uri 'none'; form-action 'none'; script-src 'none'; connect-src 'none'";
  preview.head.prepend(policy);
  return '<!doctype html>' + preview.documentElement.outerHTML;
}
function archiveTarget(target) {
  // Prefer the longest real filename: '#' and '%' may be literal filename bytes.
  const boundaries = [target.length];
  for (let index = target.length - 1; index >= 0; index--)
    if (target[index] === '#' || target[index] === '?') boundaries.push(index);
  for (const boundary of boundaries) {
    const path = target.slice(0, boundary);
    if (!reader.exists(path)) continue;
    const suffix = target.slice(boundary);
    const fragment = suffix.indexOf('#');
    return { path, hash: fragment < 0 ? '' : suffix.slice(fragment) };
  }
  const suffix = target.search(/[?#]/);
  const fragment = target.indexOf('#');
  return {
    path: suffix < 0 ? target : target.slice(0, suffix),
    hash: fragment < 0 ? '' : target.slice(fragment),
  };
}
function select(target) {
  try {
    const { path, hash } = archiveTarget(target);
    revokeResources();
    $('#selected').textContent = target;
    $('#empty').hidden = true;
    $('#preview').hidden = true;
    $('#binary').hidden = true;
    const type = reader.getMimeType(path);
    if (type === 'text/html') {
      previewUrl = URL.createObjectURL(
        new Blob([renderHTML(reader.readHTML(path), path)], {
          type: 'text/html',
        }),
      );
      $('#preview').src = previewUrl + hash;
      $('#preview').hidden = false;
    } else {
      $('#binary').textContent =
        type.startsWith('text/') ||
        ['application/json', 'application/javascript'].includes(type)
          ? reader.readText(path)
          : [
              ...reader.readRange(
                path,
                0,
                Math.min(256, reader.getFileSize(path)),
              ),
            ]
              .map(value => value.toString(16).padStart(2, '0'))
              .join(' ');
      $('#binary').hidden = false;
    }
    for (const button of $('#files').children)
      button.classList.toggle('active', button.dataset.path === path);
    cache();
    status(
      `已读取 ${path} · ${bytes(reader.getFileSize(path))} · HTML 脚本执行已禁用`,
    );
  } catch (error) {
    status(error.message, true);
  }
}
function open(data) {
  const next = new CHMReader(data);
  reader?.close();
  reader = next;
  source = data;
  revokeResources();
  const files = reader.listFiles();
  $('#files').replaceChildren();
  $('#results').replaceChildren();
  for (const path of files) {
    const button = document.createElement('button');
    button.className = 'file';
    button.dataset.path = path;
    const label = document.createElement('span');
    label.textContent = path.slice(1);
    const size = document.createElement('small');
    size.textContent = bytes(reader.getFileSize(path));
    button.append(label, size);
    button.addEventListener('click', () => select(path));
    $('#files').append(button);
  }
  $('#archive-title').textContent = reader.getMetadata().title ?? '未命名 CHM';
  $('#file-count').textContent = String(files.length);
  $('#download').disabled = false;
  const first = reader.getDefaultPage() ?? files[0];
  if (first) select(first);
  else status('归档中没有可预览文件');
}
$('#sample').addEventListener('click', () => {
  const files = new Map([
    [
      'index.html',
      encoder.encode(
        '<!doctype html><meta charset="utf-8"><title>CHMKit 演示</title><link rel="stylesheet" href="assets/style.css"><main><span class="badge">CHM → Browser · Live demo</span><h1>你好，CHMKit。</h1><p>这是从标准 CHM 文件中解压的真实 HTML，不是静态占位页面。</p><img src="assets/diagram.svg" width="440" alt="CHM 数据流"><h2>边界条件，也有答案。</h2><p>中文、多层目录、空文件、全部 256 种字节和跨帧读取，均有测试。</p><p>点击左侧的文档与二进制文件，或搜索「边界条件」。</p></main>',
      ),
    ],
    [
      'docs/boundaries.html',
      encoder.encode(
        '<meta charset="utf-8"><title>边界条件</title><link rel="stylesheet" href="../assets/style.css"><main><span class="badge">Regression cases</span><h1>边界条件检查</h1><ul><li>空文件与空目录</li><li>中文 / UTF-8 / GBK 文本</li><li>32 KiB 帧边界与多重置区间</li><li>损坏输入与路径穿越拒绝</li></ul></main>',
      ),
    ],
    [
      'assets/style.css',
      encoder.encode(
        'body{margin:0;background:#f5f9f8;color:#183c36;font:16px/1.8 system-ui,sans-serif}main{max-width:760px;padding:48px;margin:auto}h1{font-size:42px;letter-spacing:-1px;margin:12px 0 20px}h2{font-size:23px;margin-top:30px}.badge{color:#13785c;font-size:12px;text-transform:uppercase;letter-spacing:2px}p,li{color:#476760}img{max-width:100%;margin:16px 0}',
      ),
    ],
    [
      'assets/diagram.svg',
      encoder.encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="84"><rect width="440" height="84" rx="14" fill="#d9efe5"/><g fill="#25634e" font-family="sans-serif" font-size="16" text-anchor="middle"><text x="70" y="48">CHM 文件</text><text x="148" y="48">→</text><text x="220" y="48">LZX 解压</text><text x="292" y="48">→</text><text x="365" y="48">安全预览</text></g></svg>',
      ),
    ],
    [
      'data/all-bytes.bin',
      Uint8Array.from({ length: 256 }, (_, index) => index),
    ],
    ['data/empty.txt', new Uint8Array()],
  ]);
  try {
    open(
      packFiles(files, {
        title: 'CHMKit · 跨平台阅读器',
        defaultTopic: 'index.html',
      }),
    );
  } catch (error) {
    status(error.message, true);
  }
});
$('#open').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    open(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    status(error.message, true);
  }
});
$('#download').addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([source], { type: 'application/vnd.ms-htmlhelp' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'chmkit-demo.chm';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#search-button').addEventListener('click', () => {
  if (!reader) return status('请先打开文档', true);
  try {
    const results = reader.search($('#search').value, { pattern: '**/*.html' });
    $('#results').replaceChildren();
    for (const result of results) {
      const button = document.createElement('button');
      button.textContent = `${result.path} · ${result.matches.length} 处匹配`;
      button.addEventListener('click', () => select(result.path));
      $('#results').append(button);
    }
    status(`搜索完成 · ${results.length} 个匹配文件`);
    cache();
  } catch (error) {
    status(error.message, true);
  }
});
$('#search').addEventListener('keydown', event => {
  if (event.key === 'Enter') $('#search-button').click();
});
$('#toc-button').addEventListener('click', () => {
  if (!reader) return status('请先打开文档', true);
  $('#results').replaceChildren();
  const add = entries => {
    for (const entry of entries) {
      if (entry.local && reader.exists(archiveTarget(entry.local).path)) {
        const button = document.createElement('button');
        button.textContent = entry.name;
        button.addEventListener('click', () => select(entry.local));
        $('#results').append(button);
      }
      if (entry.children) add(entry.children);
    }
  };
  try {
    add(reader.getTOC());
    cache();
  } catch (error) {
    status(error.message, true);
  }
});
$('#clear-cache').addEventListener('click', () => {
  reader?.clearCache();
  cache();
  status('缓存已清空');
});
window.addEventListener('pagehide', () => {
  reader?.close();
  revokeResources();
});
