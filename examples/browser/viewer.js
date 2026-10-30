import { CHMReader, packFiles } from '../../dist/browser/index.mjs';
import {
  ArchivePathResolver,
  createArchivePreview,
} from '../../dist/browser/resources.mjs';

const $ = selector => document.querySelector(selector);
let reader, source, preview, resolver;
const downloads = new Set();
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
  $('#preview').removeAttribute('src');
  preview?.dispose();
  preview = undefined;
}
function select(value, kind = 'auto') {
  try {
    // File-list buttons use raw paths. TOC/default topics and HTML links have URL semantics.
    const target =
      typeof value === 'string' ? resolver.resolve(value, '/', kind) : value;
    if (!target) throw new Error('归档中不存在此导航目标，或链接不安全');
    const { path, query, fragment } = target;
    revokeResources();
    $('#document-links').replaceChildren();
    $('#selected').textContent = path + query + fragment;
    $('#empty').hidden = true;
    $('#preview').hidden = true;
    $('#binary').hidden = true;
    const type = reader.getMimeType(path);
    if (type === 'text/html') {
      preview = createArchivePreview(reader, path);
      $('#preview').src = preview.createObjectURL() + fragment;
      $('#preview').hidden = false;
      // Opaque sandbox documents cannot call into the host. Cross-page links are
      // deliberately surfaced here instead of enabling scripts/same-origin.
      for (const link of preview.links) {
        const button = document.createElement('button');
        button.textContent = link.label;
        button.title = link.path + link.query + link.fragment;
        button.addEventListener('click', () => select(link));
        $('#document-links').append(button);
      }
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
  resolver = new ArchivePathResolver(files);
  $('#files').replaceChildren();
  $('#results').replaceChildren();
  $('#document-links').replaceChildren();
  for (const path of files) {
    const button = document.createElement('button');
    button.className = 'file';
    button.dataset.path = path;
    const label = document.createElement('span');
    label.textContent = path.slice(1);
    const size = document.createElement('small');
    size.textContent = bytes(reader.getFileSize(path));
    button.append(label, size);
    button.addEventListener('click', () => select(path, 'raw'));
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
  downloads.add(url);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'chmkit-demo.chm';
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    downloads.delete(url);
  }, 1000);
});
$('#search-button').addEventListener('click', () => {
  if (!reader) return status('请先打开文档', true);
  try {
    const results = reader.search($('#search').value, { pattern: '**/*.html' });
    $('#results').replaceChildren();
    for (const result of results) {
      const button = document.createElement('button');
      button.textContent = `${result.path} · ${result.matches.length} 处匹配`;
      button.addEventListener('click', () => select(result.path, 'raw'));
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
      const target = entry.local && resolver.resolve(entry.local, '/', 'auto');
      if (target) {
        const button = document.createElement('button');
        button.textContent = entry.name;
        button.addEventListener('click', () => select(target));
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
  for (const url of downloads) URL.revokeObjectURL(url);
  downloads.clear();
});
