# 浏览器使用指南

[文档首页](../index.md) · [Worker](worker.md) · [安全策略](../../SECURITY.md)

浏览器有两种用法：直接打开**本地查看器**，或在自己的网页应用中**集成库**。

## 1. 使用本地查看器

解压发布包中的 `chmkit-<版本>-browser.tar.gz`，双击 **`dist/viewer/index.html`**。

- 不需要 Node.js、npm、构建步骤或本地服务器；查看器是 classic script，可以直接以 `file:` 方式打开。
- 请保持解压目录完整，查看器依赖同目录下的 `viewer.js`、`reader.worker.js` 和 `worker-client.js`。
- 选择的文件只在本地读取，**不会上传**。加载示例预览时没有外部网络请求。

![查看器初始界面](../images/viewer-start.png)

| 操作           | 作用                                                           |
| -------------- | -------------------------------------------------------------- |
| 打开 .chm 文件 | 选择本地 `.chm` 文件                                           |
| 加载演示文档   | 生成内置示例（包含页面、样式、SVG、二进制和空文件），便于体验  |
| 下载示例 CHM   | 把当前示例保存为 `chmkit-demo.chm`，可用于[命令行示例](cli.md) |
| 全文搜索       | 在可读文本资源中搜索关键词，结果按文件列出匹配数量             |
| 查看目录       | 显示归档的目录（TOC）                                          |
| 清空缓存       | 释放查看器的读取缓存                                           |

![加载演示文档后的预览](../images/viewer-sample.png)

![全文搜索结果](../images/viewer-search.png)

查看器的预览是受限的静态预览：它保留无脚本沙箱、CSP 和资源预算，但**不是完整的 HTML Help 浏览器**，
部分页面功能可能不会显示。

## 2. 在网页应用中集成库

将发布包中的 `dist/browser/` 与类型声明一起部署，或通过 npm 包导入 `chmkit/browser`。

```ts
import { CHMReader } from 'chmkit/browser';

async function listLocal(file: File) {
  if (file.size > 32 * 1024 * 1024) throw new Error('应用输入上限');
  const reader = await CHMReader.open(file, {
    maxFileSize: 8 * 1024 * 1024,
    maxCacheBytes: 2 * 1024 * 1024,
  });
  try {
    return { files: reader.listFiles(), toc: reader.getTOC() };
  } finally {
    reader.close();
  }
}
```

要点：

- `CHMReader.open()` 接受 `Uint8Array`、`ArrayBuffer` 或 `Blob`（包括 `<input type="file">` 选中的 `File`），**不接受**路径或 URL 字符串。
- 从网络获取归档时，应由应用自行 `fetch`、检查 HTTP 响应状态，并限制下载大小后再传入字节。
- 读取 `Blob` 时会把它完整读入 `ArrayBuffer`。大文件请设置 `maxFileSize`。
- 浏览器中的二进制读取结果是普通的 `Uint8Array`（不是 Node 的 `Buffer`）；流式读取使用 WHATWG `ReadableStream`。
- 需要在 Worker 中解析或搜索大文件时，使用 [Worker 指南](worker.md)。

### 直接以 ESM 方式使用

如果不使用打包工具，请通过 HTTP(S) 提供 `dist/browser/` 下的全部文件，并保持相对路径与 chunk 文件不变：

```html
<script type="module">
  import { CHMReader } from './dist/browser/index.mjs';
</script>
```

裸模块名（例如直接写 `chmkit/browser`）需要打包工具或 import map。ESM 与 module Worker **不能**通过 `file:` 直接运行；只有查看器可以。

## 3. 预览 CHM 中的页面

`chmkit/browser-resources` 提供 `createArchivePreview()`，用于在沙箱 iframe 中展示归档内的 HTML 页面。
它只使用归档内的资源（以 data URL 内嵌），并限制资源数量与字节数。

```ts
import { CHMReader } from 'chmkit/browser';
import { createArchivePreview } from 'chmkit/browser-resources';

async function mountManual(file: File, frame: HTMLIFrameElement) {
  if (file.size > 32 * 1024 * 1024) throw new Error('应用输入上限');
  const reader = await CHMReader.open(file, {
    maxFileSize: 8 * 1024 * 1024,
    maxCacheBytes: 2 * 1024 * 1024,
  });
  let preview: ReturnType<typeof createArchivePreview> | undefined;
  try {
    const path = reader.listFiles('**/*.html')[0];
    if (!path) throw new Error('没有 HTML 页面');
    preview = createArchivePreview(reader, path, {
      limits: { maxResources: 64, maxBytes: 8 * 1024 * 1024 },
    });
    frame.setAttribute('sandbox', '');
    frame.referrerPolicy = 'no-referrer';
    frame.src = preview.createObjectURL();
  } catch (error) {
    preview?.dispose();
    reader.close();
    throw error;
  }
  return () => {
    frame.removeAttribute('src');
    preview?.dispose();
    reader.close();
  };
}
```

使用规则：

- **不要**把 `preview.html` 直接粘贴进宿主文档；iframe 必须保持空的 `sandbox`（不要添加 `allow-scripts` 或 `allow-same-origin`），并保留限制性 CSP。
- 替换页面、关闭归档或离开页面之前，调用返回的清理函数，它会释放 Blob URL 并关闭读取器。
- 预览会重写 HTML 与 CSS，移除脚本、表单、外部资源和不支持的元素。它**不是**通用的 HTML/CSS 净化器，也不是完整的浏览器渲染器；不支持的语法可能被省略。
- 跨页链接不会在 iframe 内直接跳转，而是出现在 `preview.links` 中，由宿主界面以文本按钮的形式呈现。宿主应解析用户选中的链接并重新创建预览。

### 路径与链接

`ArchivePathResolver` 用于把文件列表中的路径和 HTML/CSS 中的引用映射到归档中的真实文件：

```ts
import { ArchivePathResolver } from 'chmkit/browser-resources';

const resolver = new ArchivePathResolver([
  '/guide/index.html',
  '/guide/topic#1.html',
  '/guide/100%.html',
]);
console.log(resolver.resolve('/guide/topic#1.html', '/', 'raw'));
console.log(
  resolver.resolve('topic%231.html#section', '/guide/index.html', 'url'),
);
```

- `raw`：按原始文件名精确匹配，不解码、不切分。用于文件列表按钮。
- `url`：按 URL 规则解析相对路径，逐段解码一次，并分离查询串与片段。用于 HTML/CSS 中的引用。
- `auto`：优先匹配真实存在的原始文件名，找不到时再按 URL 解析。只有在无法确定来源语义时才使用。
- 外部协议、协议相对 URL、越过根目录的路径穿越、编码后的分隔符和非法转义都会被拒绝。
- 无法解析时返回 `undefined`，表示路径被阻止或文件不存在。

## 4. 限制与失败行为

预览的默认预算：128 个资源、2048 个引用、依赖深度 8、16 MiB 输入资源字节、24 MiB 展开输出，以及 20000 个 DOM 节点。
超出预算时抛出 `PreviewLimitError`。如果希望失败时保留旧界面，请先构造新的预览，成功后再释放旧预览。

预算只是保守的计数，**不是**严格的浏览器内存上限。DOM 解析、base64 展开、读取器缓存和调用方持有的字节都有额外开销。
请同时对读取器输入设置上限（`maxFileSize`、`maxCacheBytes`）。自定义读取适配器必须提供可靠的读取、大小和编码数据。

## 5. 安全与隐私

- 预览不会主动请求缺失的资源；但应用自身的网络请求、外部导航以及任何绕过 CSP 或沙箱的做法都会影响隐私。
- 不要把"本地解析"理解为完整的隐私隔离。
- 不要自动打开外部链接或已解压的文件。
- 不要为了让跨页导航生效而开启脚本或同源访问，这会破坏沙箱。

更多安全边界见 [SECURITY.md](../../SECURITY.md)。

## 示例与验证

- [examples/browser](../../examples/browser/README.md)：查看器源码（文件选择、示例、搜索、预览清理），以及模块 Worker 的使用方式。
- [examples/worker](../../examples/worker/README.md)：通过 HTTP(S) 远程读取的 Worker 示例。
- 测试覆盖：`pnpm exec playwright test` 在 Chromium、Firefox 和 WebKit 上运行浏览器用例，并检查 `dist/viewer/index.html` 以 `file:` 方式打开时的零外部请求。
  执行结果与平台证据记录在 [VALIDATION.md](../../VALIDATION.md)。
