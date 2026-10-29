# CHMKit

用 TypeScript 读取、检查、提取和创建 Microsoft HTML Help（`.chm`）文件。提供 Node.js CLI、CommonJS/ESM API 和独立浏览器入口。

[English](README.md) | **中文**

[验证记录与演示证据](VALIDATION.md)（源码仓库内查看，不包含在 npm 产物中）。当前结果须重新运行下述命令获得；历史结果不能作为当前 runner 的通过证据。

## 当前状态与支持边界

项目仍在开发中，**本次修订未发布到 npm**；registry 版本不一定包含这些变更。请使用源码构建或本地 tarball 体验当前代码。

已实现：

- 标准 ITSF v2/v3、ITSP/PMGL 目录、section 0 资源、section 1 Content 流、LZXC ControlData 和 reset table。
- 真实 LZX VERBATIM、ALIGNED 和未压缩/stored 块解码，以及滑动窗口匹配、跨帧/reset 处理和 Intel E8 转换。
- CHM 写入：VERBATIM LZ77 + 固定 Huffman 树压缩；不可有效压缩的帧使用 stored 回退；`compression: false` 将用户内容写为非 LZX 压缩数据。
- 文件树、TOC（`.hhc`）、索引（`.hhk`）、`#SYSTEM` 元数据、文本/全文搜索、字节范围读取、WHATWG 流和有界 LRU 缓存。
- 显式编码、BOM/HTML charset 检测和语言信息回退，包含 GBK 解码。
- 无文件系统依赖的浏览器 API：字节/Blob 输入、`Uint8Array` 输出和 `ReadableStream<Uint8Array>`。

这**不表示兼容所有 CHM**，也不等同于 HTML Help Workshop 全功能或最优压缩率实现。自适应 Huffman 树选择和 ALIGNED **编码**属于后续增强；ALIGNED **解码**已实现。遇到不支持或损坏的结构应报错，而不是返回伪造内容。[TODO.md](TODO.md) 区分了已修复的审计问题与完整路线图。

### 本轮行为变化

- 旧的伪 LZX Huffman 辅助 API（`Huffman.createLZXDecoder`、`readCodeLengths`、`buildPredefinedTree` 及 `LZXHuffmanDecoder` 各操作）已 deprecated，调用会明确抛出不支持（unsupported / not supported）错误，不再伪装成 LZX 解码。请改用真正的 `LZXDecoder`；通用 Huffman 树 API 仍保留。
- `TOCBuilder` 修复了没有匹配父节点的孤立子页被丢弃的问题；生成的导航可能因此变化。
- 根路径 `chmkit` 的 browser condition 默认导出修复为 `CHMKit`；显式 `chmkit/browser` 默认仍为 `CHMReader`。

这些是有意的行为变化，不能宣称完全向后兼容。升级时需迁移旧辅助 API 调用，并检查默认导入和生成的 TOC。

## 本地构建与快速体验

Node 运行时要求为 **Node.js >= 20.10.0**。开发建议使用 Node 20.19+ 或 Node 22/24、pnpm 9.0.0；CI 的构建工具基线与最低运行时要求分开。

在 `chm-kit` 仓库根目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/cjs/cli/index.js --help
pnpm demo
```

`pnpm build` 仅执行 `node scripts/build.mjs`，完整构建 Node CJS/ESM、CLI、浏览器 bundle 和声明，不接受部分构建参数。它只清理 `dist/{cjs,esm,browser,types,declarations}`，保留 `dist/demo/` 及其它证据目录。

`pnpm demo` 会构建项目并运行 `scripts/demo.mjs` 的真实样例流程，在 `dist/demo/` 生成可检查的结果，包括 `sample.chm`、`extracted/` 和 `report.json`。可实际比较提取结果与生成的原始内容，并查看报告，而不是只看退出码。维护的两个脚本仅为完整构建和此 demo；测试直接使用原生 runner。

验证本地可安装包：

```sh
pnpm test:package
```

该测试通过 package project 的 `globalSetup` 构建一次，打包 tarball，并在系统临时目录的真实路径下建立消费项目，隔离仓库祖先的依赖查找链。检查入口、类型声明、CLI 和包内容，不使用依赖 overrides，也不借用仓库依赖。`@types/node` 是用于 Node 声明的正式包依赖，不是消费项目的临时补丁。依赖未缓存时，安装可能访问包 registry。

安装本地 tarball 后，`chmkit` 与 `chm` 是同一个 CLI 的两个名称。以下示例直接调用构建产物，不依赖全局安装或 registry 版本。

## CLI 使用

```sh
# 查看信息；JSON 以机器可读形式输出到 stdout
node dist/cjs/cli/index.js info dist/demo/sample.chm --json

# 文件列表、结构化目录和索引
node dist/cjs/cli/index.js read dist/demo/sample.chm --list --format json
node dist/cjs/cli/index.js read dist/demo/sample.chm --toc --format json
node dist/cjs/cli/index.js read dist/demo/sample.chm --index --format json

# 其它归档请先 --list，再用列表中的路径替换 /index.html
node dist/cjs/cli/index.js read dist/demo/sample.chm /index.html

node dist/cjs/cli/index.js read dist/demo/sample.chm /index.html --range 0:16 --format raw --output first-16.bin
node dist/cjs/cli/index.js read dist/demo/sample.chm /index.html --stream --output page.html

# 使用全新的输出目录；不会覆盖已有文件
node dist/cjs/cli/index.js extract dist/demo/sample.chm --output ./extracted-new --preserve-structure
node dist/cjs/cli/index.js extract dist/demo/sample.chm --output ./html-new --filter "**/*.html" --preserve-structure

# 将你准备的目录打包
node dist/cjs/cli/index.js pack ./docs --output help.chm --title "用户手册" --default-topic index.html
node dist/cjs/cli/index.js pack ./docs --output help-stored.chm --no-compression
```

行为说明：

- `read` 必须且只能选择内部文件路径、`--list`、`--toc`、`--index` 之一。以 `read --help` 为准；规划中的交互式浏览、搜索、批处理等 CLI 参数尚未实现。
- `--range start:end` 是**字节范围 `[start, end)`**，末尾不包含，必须在文件范围内；不是字符索引。范围可能截断多字节字符，需要原始字节时用 `--format raw`。
- `--format text` 输出解码文本；文件的 `--format json` 输出包含内容及元数据的对象。`--toc/--index --format json` 输出结构化导航；text/raw 输出对应 `.hhc`/`.hhk` 源内容。
- `--stream` 始终输出**原始字节**，即使保留默认 text 格式。`--stream --range` 直接共用 reader 的逐帧流状态，不为每个 chunk 从 reset 重新解码；可与 `--output` 组合，不能与 JSON 组合。`--list` 不支持 raw/range/stream。
- CLI 文本/JSON 默认按 UTF-8 解码；可用 `--encoding GBK` 等指定编码。阅读器 API 另有自动编码检测能力。
- 错误写入 stderr，并以非零状态退出，**部分提取失败也不例外**。已成功提取的文件会保留；提取不是事务操作。
- CLI 不带 `--preserve-structure` 时平铺文件名；重名会失败，不会覆盖。阅读完整手册通常应保留目录结构。

## Node.js API

安装本地 tarball 后从 `chmkit` 导入；在源码目录内可改为 `./dist/esm/index.mjs`。CommonJS 可使用 `require('chmkit')`。

### 打开一次，多次读取

```ts
import { CHMReader, CacheStrategy } from 'chmkit';

const reader = await CHMReader.open('help.chm', {
  maxCacheBytes: 8 * 1024 * 1024,
  maxFileSize: 64 * 1024 * 1024,
  cacheStrategy: CacheStrategy.LRU,
  // defaultEncoding: 'GBK', // 元数据/charset 不足时的回退编码
});

try {
  console.log(reader.listFiles('**/*.html'));
  console.log(reader.getFileTree());
  console.log(reader.getMetadata(), reader.getTOC(), reader.getIndex());

  const page = reader.listFiles('**/*.html')[0]; // 原始归档路径，不是导航 URL
  if (page) {
    console.log(reader.readHTML(page));
    const size = reader.getFileSize(page);
    const bytes = reader.readRange(page, 0, Math.min(128, size)); // Buffer
    console.log(bytes, reader.getFileInfo(page));

    const stream = reader.createReadStream(page, 0, Math.min(128, size)); // WHATWG 流
    for await (const chunk of stream) console.log(chunk.byteLength);
  }

  console.log(reader.search('手册', { pattern: '**/*.html', maxResults: 10 }));
  console.log(reader.getCacheStats());
} finally {
  reader.close(); // 必须等流消费完成再关闭
}
```

打开文件系统路径是异步操作；打开后，归档操作为同步方法，流的消费仍是异步。Node 二进制读取返回 `Buffer`；`readMultiple()` 返回 `Map`，`readWithMetadata()` 同时返回字节和文件信息，Node 公共 `FileWithMetadata` 的 data 类型为 `Buffer`。路径会规范化并按大小写不敏感方式查找；有歧义的重复路径被拒绝。常规列表排除 CHM 内部资源，但可显式读取内部路径。`exists` 仅在归档内部路径缺失时返回 `false`；坏档案等错误会抛出，不会被吞掉并转成 `false`。

Node/浏览器 reader 的 `createReadStream(path, start = 0, end?)` 支持严格半开字节范围 `[start, end)`，省略 `end` 表示文件末尾。`getDefaultPage()` 与导航 `local` 保留 query/hash；读文件 API 接收原始归档路径（如 `listFiles()` 返回值），不是完整 URL。查看器须先解析导航目标，浏览器 demo 已处理。

Node 内存输入可从 `chmkit` 导入并使用 `new CHMArchive(bytes, options)`，或 `CHMKit.from(bytes, options)`；`CHMKit.open(path, options)` 打开 Node 阅读器。Node 阅读器子入口为 `chmkit/reader`。

### 一次性操作与打包

```ts
import { CHMKit, packFiles } from 'chmkit';
import { writeFile } from 'node:fs/promises';

const files = await CHMKit.listFiles('help.chm');
if (files.length) console.log(await CHMKit.readFile('help.chm', files[0]));
console.log(await CHMKit.getTOC('help.chm'));
console.log(await CHMKit.searchContent('help.chm', '手册'));

// Node 目录操作
await CHMKit.pack('./docs', 'help.chm', { title: '用户手册' });
const result = await CHMKit.extract('help.chm', './fresh-output', {
  preserveStructure: true,
});
if (result.errors.length) throw new Error(result.errors.join('\n'));

// 纯内存打包，无需输入目录
const archive = packFiles(
  new Map([
    ['index.html', Buffer.from('<title>手册</title><h1>你好</h1>')],
    ['assets/style.css', Buffer.from('body { font-family: sans-serif; }')],
  ]),
  { title: '手册', defaultTopic: 'index.html', compression: true },
);
await writeFile('generated.chm', archive);
```

Node 门面还提供 `parse`、`getInfo`、`readText`、`readHTML`、`exists`、`getIndex`、`readRange`、`readMultiple`、`exportFiles`，以及兼容名称 `list`、`get`、`search`、`extractAll`。同一归档的连续操作应复用 reader，避免一次性 API 反复解析。

打包会保留用户提供的 `.hhc`/`.hhk`；缺失时按 HTML 文件和 `<title>` 生成基础导航，逐段 URL 编码路径（包括字面量 `#`/`%`），不会自动推断完整章节层级。`packFiles` 拒绝非 portable 路径（Windows device 名、控制/禁用字符、CHM 保留路径、UNC）、NFC 规范化后大小写不敏感的重名及文件/目录冲突；非空 `defaultTopic` 的目标必须是归档中已存在的文件。

## 浏览器 API 与可操作演示

使用打包器时推荐显式导入 `chmkit/browser`，其默认导出为 `CHMReader`。支持 `browser` 导出条件的打包器会将根路径 `chmkit` 解析到浏览器门面，默认导出为 `CHMKit`，与 Node 根入口的门面名称一致。两者都提供具名浏览器 API，但默认导出有意不同。不要在浏览器中导入 Node 配置、CLI 或文件系统适配层。

```ts
import { CHMReader, packFiles } from 'chmkit/browser';

// <input type="file"> 选出的 File 本身是 Blob，可直接传给 open。
const response = await fetch('/manual.chm');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const reader = await CHMReader.open(await response.arrayBuffer());
try {
  console.log(reader.listFiles(), reader.getTOC());
  const page = reader.listFiles('**/*.html')[0]; // 原始归档路径，不是导航 URL
  if (page) {
    const bytes: Uint8Array = reader.readFile(page);
    const stream: ReadableStream<Uint8Array> = reader.createReadStream(page);
    console.log(bytes, await new Response(stream).arrayBuffer());

    // 仅在 sandbox 中预览，不能将归档 HTML 注入宿主 DOM。
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', ''); // 不加 allow-scripts / allow-same-origin
    frame.referrerPolicy = 'no-referrer';
    frame.srcdoc = reader.readHTML(page);
    document.body.append(frame);
  }
} finally {
  reader.close();
}

const packed: Uint8Array = packFiles(
  new Map([
    ['index.html', new TextEncoder().encode('<title>浏览器手册</title>你好')],
  ]),
  { title: '浏览器手册' },
);
console.log(packed);
```

浏览器 `CHMReader.open()` 只接受 **`Uint8Array`、`ArrayBuffer`、`Blob`**，不接受文件系统路径或 URL 字符串；URL 请自行 `fetch`。二进制读取和打包返回普通 `Uint8Array`，流为 WHATWG 流。浏览器公共 `FileWithMetadata` 的 data 类型为 `Uint8Array`，与 Node 类型在源码层分离，不靠构建后字符串 patch 修改声明。公开 API 不要求 Node `Buffer`，也不提供浏览器目录提取。内部 `src/browser-buffer.ts` 是正式构建依赖注入，不是全局 `Buffer` shim，也不修改 `globalThis`。

在仓库根目录手动启动静态演示：

```sh
pnpm build
python3 -m http.server 8080 --bind 127.0.0.1
```

打开 **http://127.0.0.1:8080/examples/browser/**，选择本地 CHM，浏览文件树/TOC 并预览页面。Ctrl+C 停止服务器。要体验生成的样例，先运行 `pnpm demo`，再启动服务器并选择 `dist/demo/sample.chm`。此服务器仅用于本地开发，不是部署方案。

**预览安全：** CHM HTML 应视为不可信内容。必须放在禁用脚本的 sandbox iframe 中，不添加 `allow-scripts` 或 `allow-same-origin`，不要写入宿主页面的 `innerHTML`。sandbox 本身不能阻断所有外部资源请求，真正的阅读器还需限制性 CSP，并校验/重写链接及资源。上面的最小 API 示例不包含资源解析器或网络隔离实现。

## 配置与资源限制

Node 专用的 `chmkit/config` API 可在当前工作目录查找 `chmkit.config.json`，校验并合并默认值。**它目前并非 CLI、编码器或 `CHMReader` 的自动设置层。** 加载配置不会自动启用这些操作中的并发、进度条、内存或校验和控制。

```ts
import { getConfig, loadConfig, resetConfigCache } from 'chmkit/config';

console.log(getConfig());
console.log(loadConfig({ searchPaths: ['./settings'] }));
resetConfigCache();
```

实际控制行为应传入方法选项：`ReaderOptions` 的 `maxCacheBytes`、`maxFileSize`、`cacheStrategy`、`defaultEncoding`；打包的 `title`、`defaultTopic`、`compression`；提取的 `filter`、`preserveStructure`、`verbose`。未知配置键会警告并忽略，非法文件会输出诊断并回退默认值；配置对象能成功加载不代表具体操作消费了其中的字段。

资源和正确性边界：

- reader 会把整个输入归档载入内存并复制。范围/流 API 避免一次性物化整个**输出文件**，不表示输入归档也采用文件系统流式读取。范围流从最近的前置 reset 解码必要 history 前缀，并非零前缀开销。顺序 LZX 流工作内存为 dictionary + 物理 frame + chunk，不随 reset 组大小增长；输入、缓存和调用方保留的输出另计。
- `maxCacheBytes` 约束 reader 自持的文件和重建块缓存，不约束进程总内存或调用方已持有的输出。`maxFileSize` 限制单次物化读取；更大的输出应使用范围/流。搜索可能完整读取候选文本文件。
- `listDirectories()` / `getFileTree()` 的目录展开上限为深度 1024、100000 个推断目录、累计目录路径字符数 8 × 1024 × 1024（不是 UTF-8 字节数）；超限抛错。原始 `listFiles()` 不展开父目录，仍可查询极深文件。
- 共享 LZX 流中的 `CHMFile.compressedSize` 及 reader 单文件压缩大小/压缩比为 `null`：精确的 per-file 物理大小**不可知**，不根据相邻偏移伪造数值。
- 提取拒绝路径穿越、不安全的可移植文件名、冲突、已有输出文件和符号链接组件，包括输出根目录的祖先。macOS `/tmp` 等别名本身是符号链接，应使用确认后的真实路径（例如 `/private/tmp`）或仓库下的新真实目录。不要向被不可信进程并发修改的目录提取；文件系统检查不是完整的操作系统安全边界。

## 测试、cases 与实际效果证据

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test                         # vitest run：node + package 两个 project
pnpm test:unit                    # vitest run --project node；无需预构建
pnpm test:package                 # vitest run --project package；globalSetup 构建一次
pnpm exec playwright install chromium firefox webkit
pnpm test:browser                 # playwright test：默认三个引擎
pnpm test:browser --project=chromium # 也可 --project=firefox / --project=webkit
pnpm test:all                     # pnpm test && pnpm test:browser
pnpm demo                        # 重新生成可检查的 CHM/提取结果
```

`vitest.config.mts` 是唯一 Vitest 配置，定义 `node` 和 `package` 两个 project。Node CLI 单元测试通过 `tsx` 子进程运行 TypeScript 源码，不需要预先构建 CLI；交互监听使用 `pnpm test:watch`，即 `vitest --project node`。`playwright.config.ts` 是唯一真实浏览器配置，其 `globalSetup` 为整轮浏览器测试构建一次，与 package project 的 setup 各自独立。Node 测试不能代替真实浏览器执行。

lint 覆盖源码、测试及 runner 配置文件；格式检查通过 `.prettierignore` 排除 fixture，不应格式化 golden/oracle 文件。`test/support/`、独立测试 helper、真实 fixture 与 golden/oracle 期望值是持续维护的测试基础设施，不是临时补丁，必须保留且不进入发布包。

Linux 可能需要 `pnpm exec playwright install --with-deps chromium firefox webkit`。独立互通检查需要另行安装 `7zz` 或 `7z`；缺失时仅外部工具检查跳过，离线 fixture/hash/解码检查仍运行。不能把跳过的 oracle 当作互通测试通过。

| Case                            | 验证的实际效果                                                  | 证据与局限                                                                                            |
| ------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 生成样例                        | 真正打包、检查/读取并提取内容                                   | `dist/demo/sample.chm`、`dist/demo/extracted/`、`dist/demo/report.json`；自我往返不等于独立兼容性证明 |
| 未修改 PyCHM fixture            | 真实 ALIGNED-Huffman CHM、嵌套 TOC、混合 section、逐字节读取    | [来源、许可证、oracle](test/fixtures/pychm-example/README.md)，固定哈希与 7-Zip 独立提取结果          |
| LZX conformance / encoder cases | VERBATIM/ALIGNED/stored、匹配、跨帧/reset、E8 和生成产物        | 合成案例补充真实样例，不能证明所有生产工具/边界都兼容                                                 |
| 独立 7-Zip 检查                 | 外部工具验证/提取 CHM 并比较内容                                | 需要 `7zz`/`7z`；CI 的 Ubuntu 安装该工具                                                              |
| 真实浏览器执行                  | Chromium、Firefox、WebKit 中的 API/打包、Worker、预览与安全检查 | `pnpm test:browser`；JSON：`test-results/browser/results.json`；HTML：`test-results/browser/html/`    |
| 本地安装包消费                  | CJS/ESM、类型入口、CLI 和包内容                                 | `pnpm test:package`；tarball 不应包含第三方测试 fixture                                               |

Vitest 原生 JSON 报告写入 `test-results/vitest.json`，包含本次选择的 project。Playwright 原生 JSON 写入 `test-results/browser/results.json`，HTML 写入 `test-results/browser/html/`，按测试/项目隔离的附件、截图（包括 demo 截图）和保留的 trace 位于 `test-results/browser/artifacts/`。这些路径都在 `dist` 之外，不受 build 清理影响。

通过数、跳过数和失败信息以实际命令输出及新生成的报告为准，不在此写死测试数量或宣称百分百兼容；历史验证结果与当前 runner 结果必须分开。真实 PyCHM fixture 很小且只有单帧，不能单独证明真实多帧/多 reset 或 ITSF v2 文件的兼容性。

[CI](.github/workflows/ci.yml) 的目标矩阵为 **Ubuntu、macOS、Windows** 上的 Node 20.19/22/24，以及独立 Ubuntu **Chromium/Firefox/WebKit 三浏览器矩阵**。workflow 命令和报告上传须同步到上述原生入口与路径，浏览器矩阵通过 `--project` 选择引擎。定义了 workflow 不代表托管 CI 已运行通过；**Windows/Linux 验证仍待 CI 执行**。CI 仅有仓库读取权限，不自动发布 npm，也不部署。

## 许可证

CHMKit 代码使用 [MIT](LICENSE)。独立来源的 PyCHM fixture 及其提取出的期望文件为 **GPL-2.0-or-later**，上游声明与许可证保存在 `test/fixtures/pychm-example/`。它们仅用于测试，不包含在 npm 包内；不可将其改标为 MIT。
