# CHMKit

在浏览器、终端或 TypeScript 应用中读取、搜索、预览、提取和创建 Microsoft HTML Help（`.chm`）文件。
所有处理都在本地完成，**文件不会上传**。

**中文** | [English](README.en.md) · [使用文档](docs/index.md) · [API 参考](docs/api.md) · [更新日志](CHANGELOG.md)

## 它是什么

CHMKit 提供四种入口，共用同一套解析与解压实现：

| 入口                       | 适合做什么                                                  | 需要的环境                                |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| **浏览器查看器**           | 双击打开，选择 `.chm`，浏览目录、全文搜索、预览页面         | 现代浏览器（Chromium / Firefox / WebKit） |
| **命令行 `chmkit`**        | 查看信息、列文件树、搜索、读取、提取、批量提取、打包        | Node.js 20.10+                            |
| **TypeScript 库**          | 在 Node.js 服务或网页应用中读取、搜索、提取，或生成新的 CHM | Node.js 20.10+ 或现代浏览器               |
| **Worker / Electron 集成** | 把解析放到 Worker 线程，或在 Electron 中受控地开放归档能力  | 对应运行时                                |

需要注意的边界：

- CHMKit 是读取与生成 CHM 的库和工具，**不是** HTML Help Workshop 的替代品。
- 已用 PuTTY、7-Zip、Inno Setup、PyCHM 与官方 FPC 文档等独立来源的 CHM 做兼容性测试；
  但不保证兼容所有生成器。尚缺普通 ITSF v2、GBK/UTF-16 等真实样本，详见 [TODO.md](TODO.md)。
- 全文搜索是对可读文本资源的字面量扫描，不读取编译后的搜索数据库。
- 查看器的 HTML 预览是禁脚本、受限的静态预览，不是完整浏览器。

## 获取 CHMKit

目前 npm 包**尚未发布**，请选择下面一种方式。

### 方式 A：下载 CI 预构建产物（无需构建）

1. 打开 [GitHub Actions](https://github.com/fwx5618177/chm-kit/actions)，选择 `main` 上最近一次成功的 **CI** 运行。
2. 在 Artifacts 中下载 `chmkit-<commit>`（需要 GitHub 登录，产物会过期）。`chmkit-api-<commit>` 是 TypeDoc 生成的 API 文档。
3. 解压后包含：

| 文件                                                     | 用途                                                    |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `chmkit-<版本>-browser.tar.gz`                           | 浏览器查看器（`dist/viewer/`）以及浏览器 ESM 模块与类型 |
| `chmkit-<版本>-cli.cjs`                                  | 独立命令行工具，无需 `npm install`                      |
| `chmkit-<版本>.tgz`                                      | npm 安装包，包含库、命令行工具和类型声明                |
| `SHA256SUMS`、`manifest.json`、`THIRD_PARTY_NOTICES.txt` | 校验文件、来源信息和第三方许可                          |

使用前先校验文件完整性：

```sh
shasum -a 256 -c SHA256SUMS      # Linux 可用 sha256sum -c SHA256SUMS
```

### 方式 B：从源码构建（贡献者）

需要 Node.js 22.13+ 或 24，以及 pnpm 10.34.9（与 `package.json` 一致）。

```sh
git clone https://github.com/fwx5618177/chm-kit.git
cd chm-kit
pnpm install --frozen-lockfile --ignore-scripts
pnpm build                       # 生成 dist/cjs、dist/esm、dist/browser、dist/viewer
node dist/cjs/cli/index.js --help
```

需要 npm 安装包或独立 CLI 时，运行 `pnpm package:artifacts`，产物位于 `dist/package/`。

## 快速上手

### 1. 在浏览器中打开 CHM

解压浏览器包后，直接双击 **`dist/viewer/index.html`**。不需要 Node.js、npm、构建步骤或本地服务器。

1. 点击 **「打开 .chm 文件」**，选择本地文件；没有文件时，点击 **「加载演示文档」**。
2. 左侧列出归档中的文件，点击即可预览；顶部的 **「查看目录」** 显示 CHM 目录。
3. 在搜索框输入关键词，点击 **「全文搜索」**，结果会按文件列出匹配数量。
4. 点击 **「下载示例 CHM」** 可保存演示文件 `chmkit-demo.chm`，下面的命令行示例使用它。

![查看器初始界面](docs/images/viewer-start.png)

![加载演示文档后的预览](docs/images/viewer-sample.png)

![全文搜索结果](docs/images/viewer-search.png)

查看器加载示例预览时没有任何外部网络请求（已在 Chromium、Firefox、WebKit 中验证）。

### 2. 在终端中使用 `chmkit`

示例使用独立 CLI `chmkit-<版本>-cli.cjs`；安装了 npm 包后，可以直接运行 `chmkit`（别名 `chm`）。

```sh
node chmkit-1.1.0-cli.cjs --help
```

![chmkit 命令一览](docs/images/cli-help.png)

| 命令      | 作用                                                                              | 示例                                                    |
| --------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `info`    | 显示头部信息和统计（`--json` 输出 JSON）                                          | `chmkit info manual.chm`                                |
| `tree`    | 显示文件树，支持 `--depth`、`--filter`、`--type`、`--json`                        | `chmkit tree manual.chm --depth 2`                      |
| `search`  | 全文搜索或 `--names` 文件名搜索，默认跳过二进制文件                               | `chmkit search manual.chm "安装" --json`                |
| `read`    | 读取文件、`--list` 列表、`--toc` 目录、`--index` 索引，支持 `--range`、`--stream` | `chmkit read manual.chm /index.html`                    |
| `extract` | 提取到新目录，`-p` 保留目录结构                                                   | `chmkit extract manual.chm -o ./out -p`                 |
| `batch`   | 批量提取多个 CHM 到编号子目录                                                     | `chmkit batch a.chm b.chm -o ./out -p`                  |
| `preview` | 生成无脚本、无外部资源的静态 HTML 预览                                            | `chmkit preview manual.chm /index.html -o preview.html` |
| `browse`  | 在交互式终端中浏览（需要 TTY）                                                    | `chmkit browse manual.chm`                              |
| `pack`    | 把目录打包为新的 CHM 文件                                                         | `chmkit pack ./site -o new.chm -t "手册" -d index.html` |

以下示例都使用上面下载的 `chmkit-demo.chm`：

```sh
node chmkit-1.1.0-cli.cjs tree chmkit-demo.chm --depth 2
node chmkit-1.1.0-cli.cjs search chmkit-demo.chm "边界条件"
```

![文件树与搜索](docs/images/cli-tree-search.png)

```sh
node chmkit-1.1.0-cli.cjs read chmkit-demo.chm /index.html --range 0:12 --format raw
node chmkit-1.1.0-cli.cjs read chmkit-demo.chm --toc --format json
node chmkit-1.1.0-cli.cjs extract chmkit-demo.chm -o ./extracted -p --json
```

![读取、目录与提取](docs/images/cli-read-extract.png)

使用约定：

- 机器可读结果输出到 stdout（`--json`、`--format raw`），诊断与进度输出到 stderr。
- 退出码：成功为 `0`，失败为 `1`，`extract` 被 Ctrl-C 取消为 `130`。
- `extract` 与 `batch` 拒绝覆盖已有文件，并拒绝符号链接输出目录。请使用新目录。
- `read --output` 写入你指定的普通文件，**会覆盖已有文件**。
- 路径需要先用 `read <file> --list` 或 `tree` 确认，不要假设归档中一定有 `/index.html`。
- 当前目录下的 `chmkit.config.json` 会被自动读取；命令行参数优先。字段说明见 [配置与资源预算](docs/guide/configuration.md)。

完整命令说明见 [命令行使用指南](docs/guide/cli.md)。

### 3. 在 Node.js 中读取

```ts
import { CHMReader } from 'chmkit';

const reader = await CHMReader.open('chmkit-demo.chm', {
  maxCacheBytes: 8 * 1024 * 1024,
  maxFileSize: 16 * 1024 * 1024,
});
try {
  console.log(reader.getMetadata(), reader.getTOC());
  const page = reader.listFiles('**/*.html')[0];
  if (page) {
    console.log(reader.readHTML(page));
    console.log(reader.readRange(page, 0, 12)); // Buffer，对应字节 [0, 12)
  }
  console.log(reader.search('边界条件', { maxResults: 10 }));
} finally {
  reader.close(); // 释放缓存和文件描述符
}
```

- `CHMReader.open()` 是异步的；打开后，解析和解压是同步操作，会阻塞事件循环。
- 归档在 `close()` 之前必须保持不变。
- 只需要读取一次时，可以使用 `CHMKit.readFile()`、`CHMKit.listFiles()`、`CHMKit.searchContent()`，它们会自动关闭内部读取器。
- 如果已在内存中有字节，使用 `CHMKit.from(bytes)` 或 `new CHMArchive(bytes)`。

### 4. 在浏览器应用中读取

```ts
import { CHMReader } from 'chmkit/browser';

// <input type="file"> 选中的 File 就是 Blob，不需要上传。
const reader = await CHMReader.open(file, { maxFileSize: 16 * 1024 * 1024 });
try {
  console.log(reader.listFiles(), reader.getTOC());
  console.log(reader.readHTML('/index.html')); // 返回的是文本，不要直接插入页面 DOM
} finally {
  reader.close();
}
```

- 浏览器中的输入是 `Uint8Array`、`ArrayBuffer` 或 `Blob`，不是文件路径。
- 直接以 ESM 模块方式使用时，需要通过 HTTP(S) 提供 `dist/browser/` 下的全部文件。
- 不要把 CHM 中的 HTML 直接插入应用 DOM。查看器使用沙箱 iframe、CSP 和资源限制；集成方法见 [浏览器指南](docs/guide/browser.md) 与 [examples/browser](examples/browser/README.md)。

### 5. 创建新的 CHM

```ts
import { packFiles } from 'chmkit';
import { writeFile } from 'node:fs/promises';

const bytes = packFiles(
  new Map([['index.html', Buffer.from('<title>手册</title><h1>你好</h1>')]]),
  { title: '手册', defaultTopic: 'index.html', compressionLevel: 6 },
);
await writeFile('new.chm', bytes, { flag: 'wx' }); // wx：文件已存在时失败，不覆盖
```

`packFiles()` 返回新的字节；`updateArchive()` 会基于已有归档生成新的 CHM，**不是原地修改**。
详见 [打包与更新指南](docs/guide/packing.md)。

### 6. Worker 与 Electron

- **Worker**：`chmkit/worker` 提供客户端与宿主端，支持超时、取消和资源清理。见 [Worker 指南](docs/guide/worker.md) 与 [examples/worker](examples/worker/README.md)。
- **Electron**：`chmkit/electron/main` 与 `chmkit/electron/preload` 只开放经批准的归档能力，渲染进程不能任意访问文件系统。见 [Electron 指南](docs/guide/electron.md) 与 [examples/electron](examples/electron/README.md)。

## 安全与隐私

- 所有解析都在本地完成；查看器和命令行不会上传文件。
- 解压与预览会拒绝路径穿越、符号链接、不安全的输出路径和超出预算的输入。
- 预览保持无脚本、严格 CSP 与沙箱；**沙箱不是网络防火墙**。
- 不要在处理未知来源的 CHM 时直接放开资源预算：请设置 `maxFileSize` 等限制，并在需要时把解析放入独立进程或 Worker 中运行。安全报告请遵循 [SECURITY.md](SECURITY.md)。

## 兼容性与验证

- 支持 ITSF v2/v3 结构，以及 LZX 的 VERBATIM、ALIGNED 和 stored 块（含 E8 变换与重置表）。
- 已用 6 个独立来源的普通 CHM 归档（共 859 个资源期望）、官方 FPC `fpdoc` 等语料验证读取结果。
- 当前测试：`pnpm test`（Vitest）、`pnpm exec playwright test`（Chromium / Firefox / WebKit / Electron）、`pnpm test:package`（已安装的 tgz 消费者测试）。
- 已记录的 CI 结果与缺口见 [VALIDATION.md](VALIDATION.md)。

## 文档

| 主题              | 链接                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| 文档首页与导航    | [docs/index.md](docs/index.md)                                                                  |
| 命令行            | [docs/guide/cli.md](docs/guide/cli.md)                                                          |
| 浏览器            | [docs/guide/browser.md](docs/guide/browser.md)                                                  |
| Node.js           | [docs/guide/node.md](docs/guide/node.md)                                                        |
| Worker / Electron | [docs/guide/worker.md](docs/guide/worker.md) · [docs/guide/electron.md](docs/guide/electron.md) |
| 打包与更新        | [docs/guide/packing.md](docs/guide/packing.md)                                                  |
| 配置与资源预算    | [docs/guide/configuration.md](docs/guide/configuration.md)                                      |
| 从旧版本迁移      | [docs/guide/migration.md](docs/guide/migration.md)                                              |
| API 参考          | [docs/api.md](docs/api.md)                                                                      |

## 参与贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。常用命令：

```sh
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test                     # Vitest（Node 与原生用例）
pnpm exec playwright test     # 浏览器与 Electron
pnpm test:package             # 安装 tgz 后的消费者测试（先执行 pnpm package:artifacts）
```

## 许可证

CHMKit 代码使用 [MIT 许可证](LICENSE)。测试语料保留各自的许可证（包括 GPL/LGPL），**不会**进入 npm 包或预构建下载。
详见 [许可与语料政策](docs/guide/licensing.md)。
