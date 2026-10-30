# CHMKit

在浏览器中打开本地 Microsoft HTML Help（`.chm`）文件，通过终端探索内容，
或把 TypeScript 读写库集成到应用。支持读取、搜索、预览、提取和创建归档，无需上传文件。

[English](README.md) | **中文** · [文档导航](docs/index.md) ·
[API 参考](docs/api.md) · [迁移指南](docs/guide/migration.md)

## 快速开始：选择使用方式

| 下载文件                      | 适用场景                                           | 需要的环境                                |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------- |
| `chmkit-1.1.0-browser.tar.gz` | 直接打开的本地查看器，另含浏览器模块和类型         | 现代浏览器；查看器无需 Node、npm 或服务器 |
| `chmkit-1.1.0-cli.cjs`        | 终端检查、搜索、提取、打包                         | Node.js 20.10+；无需 npm install          |
| `chmkit-1.1.0.tgz`            | Node 库、安装版 CLI、浏览器／Worker／Electron 集成 | 使用 Node.js 和 npm 安装                  |

从成功的 [CI 运行](https://github.com/fwx5618177/chm-kit/actions/workflows/ci.yml)
下载 **`chmkit-<commit-sha>`** artifact，或获取维护者提供的预编译包，然后解压。
以下示例使用当前版本 **1.1.0**；请通过 `manifest.json` 确认下载的版本和源码修订，
保留许可说明并[验证校验和](docs/guide/downloads.md#verify-the-download)。

已有的[验证通过的托管快照](docs/guide/downloads.md#verified-prebuilt-snapshot)
是较早的 1.1.0 修订，**不含独立查看器**；新修订的托管验证和上传仍待完成。
Actions 下载需要 GitHub 登录且会过期。npm 包**尚未发布**；npm 发布或公开 Release
需要另行授权。见[下载详情](docs/guide/downloads.md)。

### 直接打开本地查看器

解压 `chmkit-1.1.0-browser.tar.gz`，双击 **`dist/viewer/index.html`**。
选择自己的 `.chm` 文件，或使用内置示例，即可浏览、搜索和预览内容。
保持解压后的目录完整；无需 Node、npm、源码仓库、构建或本地服务器。
已在 Chromium、Firefox 和 WebKit 验证直接以 `file:` 打开并预览示例，
**HTTP 请求数为零**。

查看器使用受限的禁脚本预览，部分 CHM 页面功能可能被省略。
库 ESM 和 module Worker 集成仍需 HTTP(S)。见[浏览器指南](docs/guide/browser.md)。

### 直接运行独立 CLI

```sh
node chmkit-1.1.0-cli.cjs --help
node chmkit-1.1.0-cli.cjs info manual.chm --json
node chmkit-1.1.0-cli.cjs tree manual.chm --depth 2
node chmkit-1.1.0-cli.cjs search manual.chm "安装" --type html --json
node chmkit-1.1.0-cli.cjs extract manual.chm --output ./manual-new --preserve-structure
```

`manual.chm` 使用你自己的文件。读取内部页面前先列出路径，不要假设每个归档都有
`/index.html`。提取建议使用全新目录并保留目录结构。

### 安装预编译库

```sh
npm install ./chmkit-1.1.0.tgz
npx --no-install chmkit --help
```

tgz 已包含 CJS、ESM、浏览器模块、CLI 和 TypeScript 声明。安装时不构建包，
不执行仓库 hooks；但会通过 npm 获取运行时依赖。安装后 `chmkit` 和 `chm`
是同一 CLI 的两个名称。需要离线 CLI 时直接使用独立 `.cjs` 文件。

保留下载附带的 `SHA256SUMS`、`manifest.json` 和 `THIRD_PARTY_NOTICES.txt`，
运行前先[核对校验和](docs/guide/downloads.md#verify-the-download)。

## Node.js：打开一次，多次读取

```ts
import { CHMReader } from 'chmkit';

const reader = await CHMReader.open('manual.chm', {
  maxCacheBytes: 8 * 1024 * 1024,
  maxFileSize: 16 * 1024 * 1024,
});
try {
  console.log(reader.getMetadata(), reader.getTOC());
  const page = reader.listFiles('**/*.html')[0];
  if (page) {
    console.log(reader.readHTML(page));
    const end = Math.min(128, reader.getFileSize(page));
    console.log(reader.readRange(page, 0, end)); // Buffer，[0, end)
  }
  console.log(reader.search('安装', { maxResults: 10 }));
} finally {
  reader.close(); // 同时释放缓存和已打开的文件描述符
}
```

`open(path)` 是异步入口；打开后的解析、定位文件读取和解压是**同步操作**，可能阻塞
事件循环。文件在 `close()` 前必须保持不可变。file-backed 不等于自动后台 I/O 或
CPU worker。提取也使用 file-backed 输入与有界异步输出，不整档载入，也不是多核解压。
`adaptivePreload` 默认关闭，启用后使用同线程定时器，与同步窗口 `readAhead` 不同；完整生命周期、
预载和[服务端示例](docs/guide/node.md)见 Node 指南及[资源预算](docs/guide/configuration.md)。

内存输入可用 `CHMKit.from(bytes)` 或 `new CHMArchive(bytes)`。
`CHMKit.readFile()`、`listFiles()`、`searchContent()` 等一次性 API 自动关闭内部
reader；连续操作请复用显式 reader，避免重复解析。

## 浏览器、Worker 和 Electron

```ts
import { CHMReader } from 'chmkit/browser';

// <input type="file"> 选择的 File 是 Blob，不需要上传。
const reader = await CHMReader.open(file, {
  maxFileSize: 16 * 1024 * 1024,
});
try {
  console.log(reader.listFiles(), reader.getTOC());
} finally {
  reader.close();
}
```

浏览器输入为 `Uint8Array`、`ArrayBuffer` 或 `Blob`，**不是路径或 URL 字符串**。
二进制结果为普通 `Uint8Array`；Node 和浏览器的流均为 WHATWG `ReadableStream`。
浏览器持有的完整内存输入不计入缓存预算。

- **本地查看器：**直接打开浏览器包内的 `dist/viewer/index.html`。
  **不使用打包器集成库**时，保留所有 chunks，通过 HTTP(S) 导入
  `./dist/browser/index.mjs`。
- **Worker：**`chmkit/worker` 提供 client/host、有界 RPC、可选 transfer 和清理。
  见 [Worker 指南](docs/guide/worker.md)与[完整示例](examples/worker/)。
- **Electron：**`chmkit/electron/main`、`chmkit/electron/preload` 提供经过授权的
  归档 capability，而不是允许 renderer 任意访问文件系统。
  见 [Electron 指南](docs/guide/electron.md)与[示例](examples/electron/)。
- **预览资源：**见[浏览器渲染与资源指南](docs/guide/browser.md)。
  能读取 HTML 不代表已经安全清洗或安全渲染。

不要把 CHM HTML 插入宿主 DOM。预览需要禁脚本的 sandbox、限制性 CSP 和经过验证的
资源／导航处理；sandbox 本身不是网络防火墙。见[安全策略与限制](SECURITY.md)。

## 创建与更新归档

```ts
import { packFiles } from 'chmkit';
import { writeFile } from 'node:fs/promises';

const bytes = packFiles(
  new Map([['index.html', Buffer.from('<title>手册</title><h1>你好</h1>')]]),
  { title: '手册', defaultTopic: 'index.html', compressionLevel: 6 },
);
await writeFile('generated-new.chm', bytes, { flag: 'wx' });
```

打包支持 stored／固定树／自适应树／ALIGNED 的实际代价选择，window/reset/block
参数、HTML Help 元数据，以及 TOC 层级与模板。已有 `.hhc`／`.hhk` 会保留。
`packTemplate()` 是 Map 整文件模板叠加，不是字符串插值。`updateArchive()` 输出新的
重建归档，**不是原地编辑**；无法安全保留的结构会明确拒绝。
具体参数、删除语义与限制见[打包与更新指南](docs/guide/packing.md)。

## 兼容性与下一步

支持 ITSF v2/v3 结构和 LZX VERBATIM、ALIGNED、stored 解码，包括跨 frame／reset
的历史状态与 Intel E8。官方 Free Pascal 3.2.2 `fpdoc` 归档现可保持原始字节不变读取，
并与独立提取结果比对。正常 v2、GBK/UTF-16 和更多 E8／window／reset 变体仍缺真实输入
证据，不保证兼容所有生产器。搜索扫描支持的文本资源，而非所有生产器的编译搜索数据库。

集成限制见[格式与兼容性](docs/guide/format-lzx.md)、
[资源预算](docs/guide/configuration.md)、[安全策略](SECURITY.md)和
[实际验证记录](VALIDATION.md)。预编译 [TypeDoc HTML](docs/api.md) 是单独的
`chmkit-api-<commit-sha>` CI artifact。

- [CLI 指南](docs/guide/cli.md)：tree、search、read、preview、browse、batch、pack
- [配置与资源预算](docs/guide/configuration.md)
- [迁移指南](docs/guide/migration.md) · [变更记录](CHANGELOG.md)
- [贡献与源码构建](CONTRIBUTING.md) · [代理维护说明](CLAUDE.md)

## 许可

CHMKit 代码使用 [MIT](LICENSE)。第三方测试语料保留各自许可（包括 GPL／LGPL），
**不得进入 npm 或浏览器／CLI 下载产物**。下载 bundle 附带运行时依赖 notices；
见[许可与语料政策](docs/guide/licensing.md)。
