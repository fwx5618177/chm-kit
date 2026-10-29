# CLAUDE.md

本文件指导在 CHMKit 仓库中工作的编码代理。具体用户任务的文件所有权与限制优先；多人并行工作时不要覆盖别人的修改。

## 项目与当前边界

CHMKit 是 TypeScript CHM 读写库，提供 Node CJS/ESM API、`chmkit` / `chm` CLI，以及独立浏览器入口。代码使用 MIT；`test/fixtures/pychm-example/` 为独立第三方 **GPL-2.0-or-later 测试数据**，不是 MIT，且不得进入 npm tarball。

已实现标准 ITSF v2/v3、PMGL、LZXC ControlData/reset table，真实 LZX VERBATIM/ALIGNED/stored 解码（含跨帧/reset、E8），以及 VERBATIM LZ77 + 固定 Huffman 树编码和 stored fallback。自适应树、ALIGNED 编码、Electron IPC、Worker helper、自适应预载属于未来增强，不是待填的基础解码实现。

不要声称兼容全部 CHM、百分百边界覆盖、数学穷尽边界或已达到最优压缩率。真实 PyCHM fixture 小且单帧；其覆盖范围不能替代多帧、多 reset、ITSF v2 等独立真实语料。本次修订未发布到 npm，registry 版本不一定包含这些变更；不要据此断言从未发布过 npm。Windows/Linux 运行结果待托管 CI 验证。

## 环境与命令

运行时：Node >= 20.10.0。开发建议 Node 20.19+、22 或 24；pnpm 9.0.0，以 `package.json` 和锁文件为准。最低运行时兼容性与开发工具运行要求分开验证，不为通过构建而悄悄提高运行时要求。

从仓库根目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test
pnpm exec playwright install chromium firefox webkit
pnpm test:browser
pnpm demo
```

- `pnpm build` 仅为 `node scripts/build.mjs`，不接受参数或部分构建；使用 esbuild 完整构建 Node CJS/ESM、CLI、browser bundle，使用 TypeScript + rollup-plugin-dts 打包声明。
- build 只清理 `dist/{cjs,esm,browser,types,declarations}`，保留 `dist/demo/` 与其它证据；测试报告位于独立的 `test-results/`。不要把 build 描述成清空整个 `dist`，也不要用 `pnpm clean` 代替需要保留证据的重建。
- `pnpm test` = `vitest run`：运行 `node` + `package` 两个 project；`vitest.config.mts` 是唯一 Vitest 配置。
- `pnpm test:unit` = `vitest run --project node`：Node 单元/集成测试；CLI 从 `tsx` 源码子进程运行，无需预构建。
- `pnpm test:package` = `vitest run --project package`：project 的 `globalSetup` 构建一次，再打包并在隔离消费项目检查入口、类型、二进制和包内容。
- `pnpm test:browser` = `playwright test`：`playwright.config.ts` 是唯一真实浏览器配置，默认运行 Chromium/Firefox/WebKit；其 `globalSetup` 为整轮构建一次，与 package setup 独立。单引擎用 `pnpm test:browser --project=chromium`（或 `--project=firefox` / `--project=webkit`）。Node 单元测试不能代替真实浏览器测试。
- `pnpm test:all` = `pnpm test && pnpm test:browser`：包含两个 Vitest project 和默认三浏览器。
- `pnpm demo`：完整构建后运行真实样例 `scripts/demo.mjs`，生成 `dist/demo/` 中的 CHM、提取文件和报告。
- `pnpm test:watch` = `vitest --project node`；它和 `pnpm dev` 都是持续监听命令，只在用户明确需要时手动运行，不在有界自动化任务中启动。
- `pnpm lint` 覆盖 `src`、`test` 和 runner 配置文件；`pnpm format:check` 检查格式，fixture 通过 `.prettierignore` 排除。不得为通过格式检查改写 golden/oracle 文件。

Linux 三引擎及系统依赖可用 `pnpm exec playwright install --with-deps chromium firefox webkit` 安装。外部 CHM oracle 需要 `7zz` 或 `7z`；缺失时该项会显式 skip，不应当作互通测试通过。普通 fixture/哈希/解码检查无需联网下载，仍必须执行。

浏览器演示：先构建，再由用户手动执行 `python3 -m http.server 8080 --bind 127.0.0.1`，访问 `http://127.0.0.1:8080/examples/browser/`。代理执行验证应使用有界的 `pnpm test:browser`，由 Playwright 配置管理测试服务器生命周期，不单独启动不退出的开发服务器。

## 代码结构与分层约束

- `src/core/headers/`：ITSF/ITSP/LZXC 和二进制字段；必须按格式识别偏移基址与范围。
- `src/core/directory/`：PMGL/ENCINT 目录解析。
- `src/core/parser/`：结构验证和解析编排。
- `src/core/lzx/`：LZX 位读取、滑动窗口、树/匹配、帧和 reset 解码。
- `src/core/files/`：文件重建与统计；本次审计已完成范围流修复，逐帧状态必须跨 chunk 复用，不退化为逐 chunk 从 reset 重新解码。
- `src/encoder/archive-builder.ts`：纯内存 `packFiles(Map)` 和标准 CHM 构造；目录扫描/写盘适配与其分离。
- `src/reader/chm-archive.ts`：便携内存核心，文件树、读取、元数据、导航、搜索、缓存；不引入 fs/process/logger/Node streams。
- `src/reader/chm-reader.ts`：Node 文件路径适配器，`CHMReader.open(path)` 异步读入文件。
- `src/reader/types.ts`：ReaderOptions、搜索/导航/缓存/元数据类型和泛型 `FileWithMetadataData<Data>`；Node 在 `chm-reader.ts` 导出 `FileWithMetadata = FileWithMetadataData<Buffer>`，浏览器在 `browser.ts` 导出 `FileWithMetadata = FileWithMetadataData<Uint8Array>`。声明边界由源码保证，不得构建后字符串 patch。
- `src/browser.ts`：浏览器组合式 facade；只接收字节/ArrayBuffer/Blob，不接收文件路径或 URL 字符串；二进制结果为普通 `Uint8Array`，显式子入口默认导出 `CHMReader`。
- `src/browser-root.ts`：根路径 browser condition，默认导出 `CHMKit`，不要误改成显式子入口的默认值。
- `src/browser-buffer.ts`：正式 browser build 的内部 Buffer adapter，通过 esbuild inject 注入模块依赖，不挂载或覆盖 `globalThis.Buffer`，不是全局污染。
- `src/chm-kit.ts` / `src/convenience.ts`：Node 门面与兼容入口；一次性操作负责关闭内部 reader，多次读取应复用 reader。
- `src/operations/`：Node parse/extract/pack/info 和文件管理适配。
- `src/cli/commands/`：Commander 命令 extract/pack/info/read；输出及退出码是公共行为。
- `src/core/config.ts`：Node 配置加载/校验 API；当前并未自动接入全部 CLI/encoder/reader 行为。
- `scripts/`：仅保留必要的完整构建 `build.mjs` 与真实样例 `demo.mjs`；测试使用原生 runner，不恢复自定义脚本入口。
- `test/`：Vitest Node/package 测试、Playwright 浏览器测试、合成案例、独立来源 fixture 与 golden/oracle 期望值。
- `test/support/`、各测试层的独立 helper 与 `test/fixtures/` 必须保留，是可复用测试基础设施及独立正确性证据，不是临时补丁；不得进入发布包。未接入的手工样本目录和私有未引用的 `BinaryDataReader` 及其 barrel 不应作为维护入口恢复。
- `examples/browser/`：静态交互浏览器演示及 `reader.worker.js` 原生 module Worker 最小示例；不是库级 Worker helper。

## 必须保持的公共语义

### API 与内存

- Node `CHMReader.open(path)` 为异步；打开后大多数归档方法同步，流消费异步，`close()` 在流消费后调用。
- Node 内存入口 `CHMArchive` / `CHMKit.from` 与浏览器字节入口不可依赖文件路径。
- Node 读取返回 `Buffer`；浏览器公开签名/结果返回 `Uint8Array`，流为 WHATWG `ReadableStream<Uint8Array>`，不是 Node Readable。
- `readRange` / `createReadStream(path, start = 0, end?)` 为严格半开字节范围 `[start, end)`，省略 `end` 到 EOF；越界报错，不偷偷截断或使用字符索引。
- 顺序 LZX 流工作内存为 dictionary + 物理 frame + chunk，不随 reset 组大小增长；输入、缓存及调用方保留输出另计。从最近前置 reset 解码必要 history，不能宣传零前缀开销；已完成的范围流审计修复与可选性能 roadmap 分开。
- `listDirectories/getFileTree` 目录展开上限为深度 1024、100000 个推断目录、累计目录路径字符数 8 × 1024 × 1024（非 UTF-8 字节数），超限抛错；原始 `listFiles` 仍可查询极深文件。
- reader 保有完整输入副本。缓存预算仅包含其管理的文件/重建块，不是总内存限制；`maxFileSize` 限制单次物化读取，不能宣传成整个输入归档大小限制。
- 共享 LZX 流中的 `CHMFile.compressedSize` 及 reader 单文件压缩大小/比率为 `null`，不伪造 per-file 物理大小。
- `exists` 仅在内部路径缺失时返回 `false`；坏档案、打开失败及已关闭 reader 等错误抛出，不捕获所有错误再返回 `false`。
- `packFiles` 拒绝非 portable 路径（Windows device 名、控制/禁用字符、CHM 保留路径、UNC）、NFC + 大小写不敏感重名和文件/目录冲突；非空 `defaultTopic` 必须指向归档中已存在的文件。
- 自动生成 TOC 仅为基础导航；路径按段 URL 编码（包括字面量 `#`/`%`），不能描述为已完成语义章节树推断。`TOCBuilder` 已修复孤立子页丢失：无匹配父节点的嵌套页面必须保留，生成导航可能变化，不能宣称与旧错误输出完全兼容。
- legacy 伪 LZX Huffman 辅助 API（`Huffman.createLZXDecoder/readCodeLengths/buildPredefinedTree` 及 `LZXHuffmanDecoder` 操作）保留 deprecated 签名但明确抛出 unsupported / not supported 错误，不消费输入或修改状态。真正的 `LZXDecoder` 及通用 Huffman 树功能正常；不要为了兼容伪输出恢复假解码，也不要声称这一变更完全向后兼容。
- `getDefaultPage()` 和导航 `local` 保留 query/hash；读文件 API 接收原始归档路径而非完整 URL。示例不要把任意导航目标直接交给 `readFile/readHTML`；demo 负责解析，并区分文件名字面量 `#`/`%` 与 URL 后缀。

### 提取与 CLI

- 拒绝路径穿越、危险 portable 文件名、冲突、符号链接及已有输出；包括输出根和祖先目录。
- macOS `/tmp` 等 symlink 别名按同一规则拒绝，测试和示例应使用真实路径；不要为便利绕开安全策略。
- 不承诺能防御恶意本地进程的所有 TOCTOU 竞争；不要向不可信进程可并发修改的目录提取。
- `extract` 返回部分失败时，保留成功文件和错误列表；CLI 退出码非零，不吞掉错误。
- `info --json` 与 `read --format json` 的 stdout 必须可直接 JSON 解析，诊断写 stderr。
- `read --stream` 是原始字节，不能与 JSON 组合；`--stream --range` 直接调用 reader 范围流并复用同一逐帧状态，不用循环 `readRange` 冒充；range/output 的组合与导航 JSON 限制保持一致。
- 不把路线图中的 CLI flag 加到示例，除非实现、help 和测试均已存在。

### 浏览器安全与入口

- 根导出的 browser condition 和 `chmkit/browser` 必须解析到无 Node 内建依赖的 bundle；前者默认 `CHMKit`，后者默认 `CHMReader`。用真实浏览器与消费包测试验证默认值和具名导出。
- 不把 untrusted CHM HTML 写入宿主 DOM；预览 iframe 必须 sandbox 禁脚本，不加 `allow-scripts` / `allow-same-origin`。
- sandbox 不是网络防火墙；外部资源需要限制性 CSP 和经过验证的链接/资源重写。
- 浏览器支持不等于已提供 Worker、Electron 或 filesystem helper。

### 配置与文档

- `chmkit/config` 支持查找、校验、合并和缓存配置，但加载成功不等于字段被具体操作消费。
- 不恢复空配置示例，不宣传未接入的 maxConcurrency/showProgress/maxMemory/checksum 等控制。
- 真正行为通过 ReaderOptions、PackFilesOptions、ExtractOptions 或 CLI 已实现参数控制；新增全局字段必须用行为测试证明接线。
- 中英文 README、TODO 与 CLI help 一起维护；不要加入不存在的文档链接、发布状态或测试数量。

## 验证与证据

优先验证修改范围，再运行完整测试。不得只看单文件成功便报告全套通过；记录失败、skip、平台、Node 版本和所运行的命令。最终验证后再更新 `VALIDATION.md`，将旧 runner 的历史结果与当前 Vitest/Playwright 原生结果分开，不沿用旧数量或提前写死最终测试数。

可检查的结果：

- `test-results/vitest.json`：Vitest 原生 JSON，反映当次选择的 project、用例及通过/失败/skip；不是自定义逐文件汇总。
- `dist/demo/sample.chm`、`dist/demo/extracted/`、`dist/demo/report.json`：实际可读取/提取的内容；自我往返不等于独立互通证明。
- `test-results/browser/results.json`：Playwright 原生 JSON；`test-results/browser/html/` 为 HTML 报告，`test-results/browser/artifacts/` 保存按测试/项目隔离的附件、截图（包括 demo 截图）和保留的 trace。必须实际运行才能声称生成成功。
- `test/fixtures/pychm-example/manifest.json`、`SHA256SUMS` 和 `expected/`：独立 7-Zip oracle；不得修改 fixture 或用本库输出来替换期望值以掩盖问题。

CI 在 `.github/workflows/ci.yml`：目标矩阵为 Ubuntu/macOS/Windows × Node 20.19/22/24，Linux 安装独立 7-Zip，Ubuntu 单独配置 Chromium/Firefox/WebKit 浏览器矩阵。同步 workflow 时，Node 使用 `pnpm test` 覆盖 node/package，浏览器使用 `pnpm test:browser --project=chromium` 等逐项选择，并上传新的 `test-results/` 原生报告及附件。CI 使用 frozen lockfile、禁安装生命周期脚本；仅 `contents: read`，不含自动 npm 发布或部署。Workflow 定义不是跨平台已通过的证据。

安装包 consumer 必须建在系统临时目录的真实路径下，隔离仓库祖先的依赖解析及注入环境变量；不能通过仓库 `node_modules` 或 consumer overrides 掩盖漏依赖。`@types/node` 是正式 dependencies，需从实际安装的包内依赖解析验证；依赖未缓存时安装可能访问 registry。

发布前确认 tarball 不包含测试 fixture、GPL 期望文件、demo 提取的第三方内容或临时消费者文件。未经用户要求不提交 git、不创建分支、不发布、不部署，也不顺手修复无关失败。
