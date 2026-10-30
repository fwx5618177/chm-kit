# CHMKit

用 TypeScript 读取、搜索、提取和创建 Microsoft HTML Help（`.chm`）归档。
可直接运行预编译 CLI、集成 Node.js 库，或在浏览器中读取本地文件，无需上传。

[English](README.md) | **中文** · [文档导航](docs/index.md) ·
[API 参考](docs/api.md) · [迁移指南](docs/guide/migration.md)

## 快速开始：无需自己构建

**公共 npm registry 当前对 `chmkit` 返回 404，目前也不计划 npm 发布。**
请使用以下预编译下载；使用者不需要源码仓库、pnpm 或编译器。
已有[验证通过的 1.1.0 预构建快照及直接下载链接](docs/guide/downloads.md#verified-prebuilt-snapshot)，
下载仍受 GitHub 登录和产物保留期限限制。

1. 打开 [GitHub Actions](https://github.com/fwx5618177/chm-kit/actions/workflows/ci.yml)，
   选择所需修订对应的成功 **CI** 运行。
2. 在 **Artifacts** 下载并解压 **`chmkit-<commit-sha>`**。
   Actions 下载通常要求 **GitHub 登录**，产物有保留期限；打包 job 未完成的运行
   不提供使用者下载，不能把任意绿色子任务当作完整交付。
3. 查看 `manifest.json` 和下载包内带版本的 `USAGE.md`。
   以下命令中的 `VERSION` 请替换为 manifest 的实际版本，不要猜测版本或标签。

本文不假设已经存在公开 GitHub Release。维护者审批发布后，可提供长期、匿名可下载的
Release 附件；见[下载说明](docs/guide/downloads.md)。

| 下载文件                        | 适用场景               | 需要的环境                         |
| ------------------------------- | ---------------------- | ---------------------------------- |
| `chmkit-VERSION-cli.cjs`        | 检查、提取、搜索、打包 | 支持的 Node.js；不需要 npm install |
| `chmkit-VERSION.tgz`            | 使用库或安装 CLI       | Node.js、npm；安装运行时依赖       |
| `chmkit-VERSION-browser.tar.gz` | 浏览器 ESM 与声明文件  | 现代浏览器、HTTP(S) 静态托管       |

开发环境使用 Node.js 22.13+ 或 24；Node 20.19 仅作运行时兼容测试，
不是安装开发依赖的环境。使用者的精确运行时要求见下载包 `engines.node`。
独立 CLI **没有内嵌 Node 或 Electron 运行时**。源码构建只面向贡献者，见
[CONTRIBUTING.md](CONTRIBUTING.md)。同次 CI 的 **`chmkit-api-<commit-sha>`**
提供可直接浏览的 [TypeDoc API 文档](docs/api.md)，无需源码构建，也不代表已公开托管。

### 直接运行独立 CLI

```sh
node chmkit-VERSION-cli.cjs --help
node chmkit-VERSION-cli.cjs info manual.chm --json
node chmkit-VERSION-cli.cjs tree manual.chm --depth 2
node chmkit-VERSION-cli.cjs search manual.chm "安装" --type html --json
node chmkit-VERSION-cli.cjs extract manual.chm --output ./manual-new --preserve-structure
```

`manual.chm` 使用你自己的文件。读取内部页面前先列出路径，不要假设每个归档都有
`/index.html`。提取建议使用全新目录并保留目录结构。

### 安装预编译库

```sh
npm install ./chmkit-VERSION.tgz
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

- **不使用打包器：**解压 browser archive，保留所有相对 chunks，使用 HTTP(S)
  提供文件并导入 `./dist/browser/index.mjs`。
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

## 能力边界与下一步

已实现标准 ITSF v2/v3 结构和 LZX VERBATIM、ALIGNED、stored 解码，包括跨 frame／
reset 的历史状态与 Intel E8。它不是完整 HTML Help Workshop 替代品，不保证读取所有
CHM，也不承诺最优压缩率。全文搜索扫描支持的文本资源，不是直接支持所有生产器的
编译搜索数据库。支持结构也不代表每种结构都有真实上游样本证明。

缓存限制是**受管缓存预算，不是总 RAM 上限**；范围读取仍可能从前置 reset 解码。
提取拒绝路径穿越、危险名字、符号链接和覆盖，但不能消除恶意本地进程的所有 TOCTOU
竞争。独立语料与有界变异测试提升置信度，不等于穷尽覆盖。
见[格式／LZX 指南](docs/guide/format-lzx.md)和[实际验证记录](VALIDATION.md)。

- [CLI 指南](docs/guide/cli.md)：tree、search、read、preview、browse、batch、pack
- [配置与资源预算](docs/guide/configuration.md)
- [迁移指南](docs/guide/migration.md) · [变更记录](CHANGELOG.md)
- [贡献与源码构建](CONTRIBUTING.md) · [代理维护说明](CLAUDE.md)

## 许可

CHMKit 代码使用 [MIT](LICENSE)。第三方测试语料保留各自许可（包括 GPL／LGPL），
**不得进入 npm 或浏览器／CLI 下载产物**。下载 bundle 附带运行时依赖 notices；
见[许可与语料政策](docs/guide/licensing.md)。
