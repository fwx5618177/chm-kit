# CHMKit 实现状态与路线图

此文件区分 **correctness / 审计修复** 与 **未来增强**。已勾选表示对应实现和测试入口已存在，不表示所有 CHM 生产工具、所有边界或所有平台均已验证。测试结果以实际生成的报告为准，不写死数量。使用说明见 [English README](README.md) / [中文 README](README_zh.md)。

## 已实现：格式与正确性

- [x] 标准 ITSF v2/v3 和 ITSP 头部读取，正确区分辅助头部、数据区和压缩 Content 的基址。
- [x] PMGL 目录、ENCINT、路径索引与目录项偏移/长度读取和边界验证。
- [x] 按格式读取 LZXC ControlData、窗口/reset 参数和 reset table。
- [x] section 0 与 section 1 数据重建，按 reset 点恢复并拼接文件。
- [x] 真实 LZX VERBATIM、ALIGNED、stored 解码；不以伪解码/原样返回压缩数据冒充支持。
- [x] 滑动窗口、literal/match、跨帧状态、reset 和 Intel E8 转换的实现及回归案例。
- [x] 标准 CHM 输出：ITSF/ITSP/PMGL、ControlData、reset table、Content 与元数据。
- [x] VERBATIM LZ77 + 固定 Huffman 树压缩；不可有效压缩帧回退 stored；可关闭用户内容压缩。
- [x] 基础 `.hhc` / `.hhk` 自动生成，使用 HTML 文件及 `<title>`；保留用户提供的导航文件，生成导航逐段 URL 编码路径中的 `#`/`%` 等字符。
- [x] `TOCBuilder` 修复孤立子页丢失：无匹配父节点的嵌套页面保留为根条目；生成导航可能变化，不等于与旧错误行为完全兼容。
- [x] legacy 伪 LZX Huffman 辅助 API 明确 deprecated 并抛出 unsupported / not supported 错误，不再返回伪造结果；真正的 `LZXDecoder` 和通用 Huffman 树功能仍正常。这是行为变化，旧调用需迁移，不宣称完全向后兼容。
- [x] `packFiles` 拒绝非 portable 路径、Windows device 名、控制/禁用字符、CHM 保留路径、UNC、NFC + 大小写不敏感重名及文件/目录冲突；非空 `defaultTopic` 必须指向归档中已存在的文件。
- [x] 共享 LZX 流中的 `CHMFile.compressedSize` 及 reader 单文件压缩大小/比率为 `null`，不伪造 per-file 物理大小。

## 已实现：安全与错误语义

- [x] 提取时拒绝路径穿越、跨平台危险文件名、冲突、已有输出文件及符号链接。
- [x] 检查输出根目录及祖先目录的符号链接；包括 macOS `/tmp` 别名，需使用真实路径。
- [x] 目录/文件写入前进行路径、realpath 和根目录身份检查；使用独占创建，拒绝覆盖。
- [x] 部分提取失败保留已成功文件并返回错误列表；CLI 以非零状态退出。
- [x] CLI JSON 保持原生机器可读输出，错误写 stderr；raw/stream 保持字节不变。
- [x] 配置递归校验、独立默认值副本、防原型污染；未知字段告警、非法文件回退。
- [x] 文档明确配置加载 API 尚未自动接入全部操作，不宣传未生效的并发/进度条等参数。
- [x] 浏览器入口隔离 Node 文件系统/日志/操作层；公开二进制接口使用普通 `Uint8Array`。
- [x] 预览安全要求明确：sandbox 禁用脚本，不向宿主 DOM 注入归档 HTML；网络限制另需 CSP。

> 提取检查并不等于能抵御恶意本地进程并发替换目录的完整沙箱；不要把不可信输出目录当作安全边界。范围/流读取也不代表整个输入归档不占内存。

## 已实现：API、阅读器与 CLI

- [x] Node `CHMReader.open(path)`、内存 `CHMArchive`，浏览器 `CHMReader.open(Uint8Array | ArrayBuffer | Blob)`。
- [x] 打开/关闭状态、Node 原始文件路径、文件/目录枚举、大小写不敏感路径查找、glob 和文件树；`listDirectories/getFileTree` 限制深度 1024、100000 个推断目录、累计目录路径字符数 8 × 1024 × 1024，超限抛错；原始 `listFiles` 仍可查极深文件。
- [x] 原始字节、文本、HTML、JSON、图片、CSS、JS 读取，批量读取和带元数据读取。
- [x] **本次审计已完成范围流修复**：`createReadStream(path, start = 0, end?)` 支持半开字节范围 `[start, end)`、取消及背压；CLI `--stream --range` 直接复用同一逐帧状态，不按 chunk 反复从 reset 解码。
- [x] 顺序流工作内存为 dictionary + 物理 frame + chunk，不随 reset 组大小增长；输入/缓存/调用方保留输出另计。从最近 reset 解码必要 history 前缀，不宣称零前缀开销；这不是下方可选性能 roadmap 的待办。
- [x] 文件大小、MIME、section/offset、压缩状态和真实可知的压缩信息。
- [x] `#SYSTEM` 元数据、TOC、索引、默认页/主页与导航链接解析；`getDefaultPage/local` 保留 query/hash，读文件 API 仍接收原始路径而非完整 URL，demo 负责解析。
- [x] 全文/单文件搜索、文件名查找、文件名模糊匹配和搜索结果限制。
- [x] LRU / none 缓存策略、预算、统计、手动预加载和清理缓存。
- [x] 显式编码、BOM/HTML charset/语言信息回退，GBK 等文本解码。
- [x] Node `CHMKit` 的 parse/extract/pack/getInfo、读取、列表和 exists 基础门面；`exists` 仅内部路径缺失返回 `false`，坏档案等错误抛出。
- [x] Node `CHMKit.open/from/packFiles/getTOC/getIndex/searchContent/readRange/readMultiple/exportFiles` 门面及 `list/get/search/extractAll` 兼容名称。
- [x] 浏览器独立 `chmkit/browser` 入口、`packFiles(Map)` 和根入口 browser condition；根路径浏览器默认导出修复为 `CHMKit`，显式浏览器子入口默认仍为 `CHMReader`。
- [x] Node/browser 公共 `FileWithMetadata` 在源码层分离，data 分别为 `Buffer` / `Uint8Array`，声明不再依赖构建后字符串 patch。
- [x] 内部 Buffer adapter 位于 `src/browser-buffer.ts`，作为正式 browser build 依赖注入，不设置或污染全局 `Buffer`。
- [x] `extract` 的 glob、保留结构、verbose、安全拒绝及部分失败退出语义。
- [x] `pack` 的标题、默认主题、压缩/非压缩控制；`info` 的文本和 JSON 输出。
- [x] `read` 的文件读取、`--list`、`--toc`、`--index`。
- [x] `read --format text|json|raw`、`--encoding`、`--output`、`--range`、`--stream`，并校验不兼容组合。

## 已实现：测试入口、cases、打包和文档

- [x] 原生 Vitest runner，唯一 `vitest.config.mts` 定义 `node` / `package` 两个 project；Node CLI 测试从 `tsx` 源码子进程运行，无需预构建。
- [x] `pnpm test` = `vitest run`（两个 project），`test:unit` = `vitest run --project node`，`test:package` = `vitest run --project package`，`test:watch` = `vitest --project node`；原生 JSON 输出 `test-results/vitest.json`。
- [x] 格式边界、BitReader/Huffman、解码、编码、重建、reader、缓存、CLI 与操作层回归案例。
- [x] 未修改的真实 PyCHM ALIGNED-Huffman CHM，固定哈希、上游来源、GPL 声明和独立提取期望值。
- [x] `7zz` / `7z` 独立检查真实/生成 CHM 的互通性；工具缺失时显式跳过外部检查，不跳过离线数据验证。
- [x] 原生 Playwright Test runner，唯一 `playwright.config.ts`，默认 Chromium/Firefox/WebKit；`pnpm test:browser --project=chromium` 等选择单引擎。覆盖 API/打包、原生 module Worker 字节传输示例、交互预览与安全，区别于 Node 单元测试。
- [x] package project 与浏览器各自通过 `globalSetup` 为整轮构建一次，不要求 Node 单元测试预构建。
- [x] `pnpm demo` 生成 `dist/demo/sample.chm`、提取文件和 `report.json`，提供可比较的实际内容。
- [x] 浏览器交互演示及原生报告：JSON 为 `test-results/browser/results.json`，HTML 为 `test-results/browser/html/`，附件、截图和保留的 trace 位于按测试/项目隔离的 `test-results/browser/artifacts/`。
- [x] `pnpm build` 仅执行无参数的 `node scripts/build.mjs`，完整构建 CJS/ESM/CLI/browser 和类型声明，不支持部分构建；只清理 `dist/{cjs,esm,browser,types,declarations}`，保留 demo 与证据。
- [x] 仅保留完整构建 `scripts/build.mjs` 与真实样例 `scripts/demo.mjs` 两个必要脚本，验证统一使用原生 runner。
- [x] tarball 安装消费测试：入口、CJS/ESM、类型、CLI、包内容；consumer 在系统临时目录真实路径下，隔离仓库祖先依赖且无 overrides。`@types/node` 为正式依赖，验证实际安装解析而非借用仓库依赖。
- [x] `test:browser` = `playwright test`（默认三引擎），`test:all` = `pnpm test && pnpm test:browser`，包含 node/package 和真实三浏览器。
- [x] 保留 `test/support/`、独立测试 helper、真实 fixture 及独立 golden/oracle 期望值；这些是有价值的测试基础设施，不是临时补丁，且全部不进入发布包。
- [x] 移除空配置示例、未接入的手工样本目录，以及私有未引用的 `BinaryDataReader` 与 barrel；普通 config API 仍不自动接线，不将清理描述为新增配置能力。
- [x] lint 覆盖 `src` / `test` / runner 配置；新增 `format:check`，通过 `.prettierignore` 排除 fixture，不修改 golden/oracle 数据。
- [x] 中英文 README：Node/浏览器/CLI、cases 实际效果、资源边界和安全说明。
- [x] 维护指导 `CLAUDE.md` 与中英文文档同步原生入口、类型边界和兼容性变化，不宣传未接入的配置。
- [x] CI 矩阵定义：Ubuntu/macOS/Windows × Node 20.19/22/24，Ubuntu 独立 Chromium/Firefox/WebKit；仅仓库读取权限，不自动发布或部署。入口迁移及执行结果见下方待验证项。

## 待完成：发布前验证与 correctness 覆盖扩展

这些项目仍需真实验证或证据，不应与可选增强混为一谈：

- [x] CI 已同步到 `pnpm test`、`pnpm test:browser --project=chromium` 等原生入口及 `test-results/` 报告路径。
- [ ] 在 GitHub 托管 CI 实际执行完整矩阵，记录 Windows/Linux 结果并修复平台特定失败；已定义 workflow 不等于已通过。
- [x] 本轮在实际 Node 20.10.0 下通过已安装包验收并记录结果，与开发构建基线 20.19+ 分开；后续修订需重新验证。
- [ ] 扩充独立来源的正常 CHM 语料：真实 ITSF v2、多帧、多 reset、不同窗口、编码和生产工具组合。
- [ ] 引入更多畸形输入语料、差分检查与有界 fuzzing；不把小样例或合成案例当作全格式证明。
- [x] 本轮最终验证已更新 `VALIDATION.md`，记录实际命令、环境、失败/跳过情况和原生报告；与旧 runner 的历史结果区分，不沿用旧通过数，不宣称百分百边界覆盖。
- [ ] 为本次修订完成人工发布前审查、版本/许可证/包内容检查及经授权的 npm 发布；**本次未发布 npm，registry 版本不一定包含此修订**。

## 未来增强路线图（不是已实现接口）

### 编码器与格式生态

- [ ] 自适应 Huffman 树选择/编码，改进压缩率和压缩级别策略。
- [ ] ALIGNED 块编码及与固定树 VERBATIM 的策略选择。
- [ ] 更丰富的窗口、reset、块大小等高级编码配置；按实际连接到实现的参数公开。
- [ ] 完整章节层级推断、自定义 TOC 模板和 HTML Help 项目元数据支持。
- [ ] 增量打包、模板系统、更新已有 CHM 或其它导出格式。

### 平台集成与性能

- [ ] Electron 主进程 IPC handler、preload/renderer 代理和安全集成示例。
- [ ] 可复用 Web Worker 封装与完整消息协议；已有 `examples/browser/reader.worker.js` 最小示例，不等于已提供库级 Worker helper。
- [ ] 基于访问行为的自适应后台预加载；目前仅支持显式手动 `preload`。
- [ ] 内存池、压缩感知缓存和基于真实语料的性能/峰值内存基准。
- [ ] Node 文件系统随机访问输入，避免整个归档载入内存；需区别于已有的输出范围/流 API。
- [ ] 更完整的浏览器资源/链接解析和网络隔离策略，以及跨版本/平台浏览器验证；已有三引擎测试入口不等于全面兼容。

### CLI、配置与开发体验

- [ ] 交互式浏览器、tree/preview/search/batch、类型/大小过滤等新增 CLI 模式。
- [ ] 可取消并行提取、真实进度条和并发控制；不能仅靠配置声明声称支持。
- [ ] 将配置自动加载及有明确需求的字段逐项接入 CLI/encoder/reader，并用行为测试验证；移除或明确保留未接入字段。
- [ ] 在线 API 文档、格式/LZX 教程、Electron/服务端/Worker 完整示例。
- [ ] 经人工授权设计发布流程；不在当前 CI 自动执行 npm publish 或部署。
