# CHMKit TODO

## 核心功能实现

### 解析器模块 (Core Parser)

- [ ] **CHM 文件解析器**
  - [ ] 读取 ITSF (Info-Tech Storage Format) 头部信息
  - [ ] 解析 ITSP (Info-Tech Storage Path) 头部信息
  - [ ] 处理 LZXC (LZX Compression) 控制信息
  - [ ] 解析目录块并构建路径索引树
  - [ ] 提供每个文件的偏移与压缩状态元数据

- [ ] **LZX 解码器**
  - [ ] 实现 Sliding Window 解码机制
  - [ ] 支持 Reset Table / Block Index 跳转解码
  - [ ] 解码 Literal/Match 序列，复原原始文件内容
  - [ ] 处理不同窗口大小的 LZX 数据

- [ ] **文件重组器**
  - [ ] 支持按需读取指定文件 offset 所在数据块
  - [ ] 解码并拼接数据，重建完整文件 Buffer
  - [ ] 输出为 HTML、图片、纯文本等格式

### 编码器模块 (Encoder)

- [ ] **CHM 编码器**
  - [ ] 写入标准 CHM 结构（ITSF、ITSP、LZXC Headers）
  - [ ] 写入压缩数据块、目录信息、控制块
  - [ ] 支持自定义窗口大小和压缩级别

- [ ] **TOC 构建器**
  - [ ] 自动生成 `.hhc`（目录）与 `.hhk`（索引）文件内容
  - [ ] 支持基于文件结构或用户指定 TOC 构造树状结构
  - [ ] 自动识别 HTML 标题层级

- [ ] **LZX 压缩器**
  - [ ] 使用 Sliding Window 和 Huffman 编码将文件压缩成 LZX 格式
  - [ ] 控制压缩块大小（一般为 0x8000）
  - [ ] 优化压缩率和速度

### 高级 API 层

- [ ] **CHMKit 类完善**
  - [ ] **基础操作方法**
    - [ ] 实现 `parse()` 方法：完整解析 CHM 文件
    - [ ] 实现 `extract()` 方法：提取指定文件或全部内容
    - [ ] 实现 `pack()` 方法：打包目录为 CHM 文件
    - [ ] 实现 `getInfo()` 方法：获取 CHM 文件详细信息
  - [ ] **便捷读取方法（基于 CHMReader）**
    - [ ] `CHMKit.readFile(chmPath: string, filePath: string): Promise<Buffer>`：读取单个文件
    - [ ] `CHMKit.readText(chmPath: string, filePath: string): Promise<string>`：读取文本内容
    - [ ] `CHMKit.readHTML(chmPath: string, filePath: string): Promise<string>`：读取 HTML 页面
    - [ ] `CHMKit.listFiles(chmPath: string): Promise<string[]>`：列出所有文件
    - [ ] `CHMKit.searchContent(chmPath: string, keyword: string): Promise<SearchResult[]>`：搜索内容
    - [ ] `CHMKit.getTOC(chmPath: string): Promise<TOCEntry[]>`：获取目录结构
    - [ ] `CHMKit.exists(chmPath: string, filePath: string): Promise<boolean>`：检查文件存在
  - [ ] **批量操作方法**
    - [ ] `CHMKit.readMultiple(chmPath: string, filePaths: string[]): Promise<Map<string, Buffer>>`：批量读取
    - [ ] `CHMKit.exportFiles(chmPath: string, filePaths: string[], outputDir: string): Promise<void>`：批量导出

- [ ] **类型定义和接口**
  - [ ] `CHMFileInfo` 接口：文件信息结构
  - [ ] `TOCEntry` 接口：目录条目结构
  - [ ] `IndexEntry` 接口：索引条目结构
  - [ ] `SearchResult` 接口：搜索结果结构
  - [ ] `SearchOptions` 接口：搜索选项配置
  - [ ] `FileTreeNode` 接口：文件树节点结构
  - [ ] `CacheStrategy` 枚举：缓存策略类型
  - [ ] `FileWithMetadata` 接口：带元数据的文件
  - [ ] `NavLink` 接口：导航链接结构

- [ ] **平台集成 API**
  - [ ] **Electron 主进程集成**
    - [ ] `CHMKit.createElectronHandler(): ElectronHandler`：创建 IPC 处理器
    - [ ] 支持主进程中安全的文件读取
    - [ ] 预定义的 IPC 通道和事件
  - [ ] **Electron 渲染进程集成**
    - [ ] `CHMKit.createRenderer(preloadAPI): CHMRenderer`：创建渲染器代理
    - [ ] 支持渲染进程中的异步调用
    - [ ] 内置错误处理和重试机制
  - [ ] **Web Worker 支持**
    - [ ] `CHMKit.createWorker(): Worker`：创建专用 Worker
    - [ ] 支持后台解析和缓存
    - [ ] 非阻塞的文件操作

- [ ] **便捷方法（向后兼容）**
  - [ ] `list()`：列出所有文件路径
  - [ ] `get(path)`：获取指定文件 Buffer
  - [ ] `extractAll()`：批量导出全部资源
  - [ ] `search(keyword)`：搜索文件内容

### CHM 阅读器模块 (CHM Reader)

- [ ] **虚拟文件系统 (Virtual File System)**
  - [ ] 实现内存中的文件树结构
  - [ ] 支持文件路径映射和查找
  - [ ] 缓存文件元数据（大小、偏移、压缩状态）
  - [ ] 支持目录遍历和文件枚举

- [ ] **按需解码引擎**
  - [ ] 智能文件大小判断机制
  - [ ] 小文件（< 64KB）直接全量解码缓存
  - [ ] 大文件按块解码，支持范围请求
  - [ ] LRU 缓存策略，优化内存使用
  - [ ] 后台预加载常用文件

- [ ] **流式数据 API**
  - [ ] `readFile(path): Promise<string | Buffer>`：读取完整文件
  - [ ] `readFileStream(path, start?, end?): Promise<Buffer>`：范围读取
  - [ ] `getFileInfo(path): FileInfo`：获取文件元信息
  - [ ] `createReadStream(path): ReadableStream`：创建可读流
  - [ ] 支持文本编码自动检测

- [ ] **CHM 阅读器核心类 (CHMReader)**
  - [ ] **文件操作 API**
    - [ ] `CHMReader.open(filePath): Promise<CHMReader>`：打开 CHM 文件
    - [ ] `reader.close(): Promise<void>`：关闭阅读器释放资源
    - [ ] `reader.isOpen(): boolean`：检查阅读器状态
    - [ ] `reader.getFilePath(): string`：获取当前打开的文件路径
  - [ ] **文件系统导航 API**
    - [ ] `reader.listFiles(pattern?: string): Promise<string[]>`：列出所有文件路径
    - [ ] `reader.listDirectories(): Promise<string[]>`：列出所有目录
    - [ ] `reader.exists(path: string): Promise<boolean>`：检查文件是否存在
    - [ ] `reader.getFileTree(): Promise<FileTreeNode>`：获取完整文件树结构
    - [ ] `reader.glob(pattern: string): Promise<string[]>`：通配符匹配文件
  - [ ] **文件读取 API**
    - [ ] `reader.readFile(path: string): Promise<Buffer>`：读取文件原始数据
    - [ ] `reader.readText(path: string, encoding?: string): Promise<string>`：读取文本文件
    - [ ] `reader.readHTML(path: string): Promise<string>`：读取 HTML 内容
    - [ ] `reader.readJSON(path: string): Promise<any>`：读取 JSON 文件
    - [ ] `reader.readImage(path: string): Promise<Buffer>`：读取图片文件
    - [ ] `reader.readCSS(path: string): Promise<string>`：读取样式文件
    - [ ] `reader.readJS(path: string): Promise<string>`：读取 JavaScript 文件
  - [ ] **高级读取 API**
    - [ ] `reader.readRange(path: string, start: number, end: number): Promise<Buffer>`：范围读取
    - [ ] `reader.createReadStream(path: string): Promise<ReadableStream>`：创建读取流
    - [ ] `reader.readWithMetadata(path: string): Promise<FileWithMetadata>`：读取文件+元数据
    - [ ] `reader.readMultiple(paths: string[]): Promise<Map<string, Buffer>>`：批量读取
  - [ ] **文件信息 API**
    - [ ] `reader.getFileInfo(path: string): Promise<CHMFileInfo>`：获取文件详细信息
    - [ ] `reader.getFileSize(path: string): Promise<number>`：获取文件大小
    - [ ] `reader.getCompressedSize(path: string): Promise<number>`：获取压缩后大小
    - [ ] `reader.getCompressionRatio(path: string): Promise<number>`：获取压缩比
    - [ ] `reader.getMimeType(path: string): Promise<string>`：获取 MIME 类型
  - [ ] **导航和目录 API**
    - [ ] `reader.getTOC(): Promise<TOCEntry[]>`：获取目录结构
    - [ ] `reader.getIndex(): Promise<IndexEntry[]>`：获取索引
    - [ ] `reader.getDefaultPage(): Promise<string>`：获取默认首页
    - [ ] `reader.getHomePage(): Promise<string>`：获取主页路径
    - [ ] `reader.getNavigationLinks(path: string): Promise<NavLink[]>`：获取导航链接
  - [ ] **搜索功能 API**
    - [ ] `reader.search(keyword: string, options?: SearchOptions): Promise<SearchResult[]>`：全文搜索
    - [ ] `reader.searchInFile(path: string, keyword: string): Promise<SearchMatch[]>`：文件内搜索
    - [ ] `reader.findFiles(pattern: string): Promise<string[]>`：按名称查找文件
    - [ ] `reader.fuzzySearch(query: string): Promise<SearchResult[]>`：模糊搜索
  - [ ] **缓存和性能 API**
    - [ ] `reader.preload(paths: string[]): Promise<void>`：预加载文件
    - [ ] `reader.clearCache(): Promise<void>`：清空缓存
    - [ ] `reader.getCacheStats(): Promise<CacheStats>`：获取缓存统计
    - [ ] `reader.setCacheStrategy(strategy: CacheStrategy): void`：设置缓存策略

- [ ] **性能优化特性**
  - [ ] 延迟加载：仅在需要时解码文件
  - [ ] 智能预测：基于访问模式预加载相关文件
  - [ ] 内存池管理：复用 Buffer 对象减少 GC
  - [ ] 压缩感知：根据压缩比调整缓存策略

## 测试和质量保证

- [ ] **单元测试**
  - [ ] 选择测试框架（Vitest/Bun Test 等）
  - [ ] CHM 解析器测试
  - [ ] LZX 解码器测试
  - [ ] 文件重组器测试
  - [ ] CHM 编码器测试
  - [ ] CHM 阅读器测试
  - [ ] 虚拟文件系统测试
  - [ ] 按需解码引擎测试
  - [ ] BitReader 工具类测试
  - [ ] Huffman 工具类测试

- [ ] **集成测试**
  - [ ] 完整的 CHM 文件解析测试
  - [ ] 解析后重新打包测试
  - [ ] CHM 阅读器端到端测试
  - [ ] 按需解码性能测试
  - [ ] 不同 CHM 版本兼容性测试
  - [ ] 大文件处理性能测试
  - [ ] 并发访问压力测试

- [ ] **示例文件**
  - [ ] 收集各种 CHM 文件样本
  - [ ] 创建测试用的 CHM 文件
  - [ ] 验证与其他 CHM 工具的兼容性

## CLI 工具改进

- [ ] **extract 命令增强**
  - [ ] 支持正则表达式过滤
  - [ ] 支持并行提取以提高性能
  - [ ] 添加进度条显示
  - [ ] 支持提取到不同格式（如 ZIP）

- [ ] **pack 命令增强**
  - [ ] 自动检测和生成 TOC
  - [ ] 支持模板系统
  - [ ] 支持增量更新
  - [ ] 添加压缩选项控制

- [ ] **info 命令增强**
  - [ ] 显示详细的文件统计信息
  - [ ] 支持验证 CHM 文件完整性
  - [ ] 显示压缩率等性能指标

- [ ] **read 命令（新增）**
  - [ ] **基础读取功能**
    - [ ] `chmkit read <input.chm> [file-path]`：读取指定文件
    - [ ] `chmkit read <input.chm> --list`：列出所有文件
    - [ ] `chmkit read <input.chm> --toc`：显示目录结构
    - [ ] `chmkit read <input.chm> --index`：显示索引
  - [ ] **输出控制选项**
    - [ ] `--output <file>`：输出到指定文件
    - [ ] `--stdout`：输出到标准输出（默认）
    - [ ] `--format <text|json|raw>`：指定输出格式
    - [ ] `--encoding <encoding>`：指定文本编码
  - [ ] **文件过滤和搜索**
    - [ ] `--pattern <glob>`：通配符匹配文件
    - [ ] `--search <keyword>`：搜索包含关键词的文件
    - [ ] `--type <html|image|css|js|text>`：按文件类型过滤
    - [ ] `--size <min-max>`：按文件大小过滤
  - [ ] **交互式功能**
    - [ ] `--interactive`：启动交互式文件浏览器
    - [ ] `--tree`：以树状结构显示文件
    - [ ] `--preview`：预览文件内容摘要
  - [ ] **高级读取选项**
    - [ ] `--range <start:end>`：范围读取（字节偏移）
    - [ ] `--stream`：流式输出大文件
    - [ ] `--metadata`：同时输出文件元数据
    - [ ] `--batch <file-list>`：批量读取多个文件
  - [ ] **性能和缓存**
    - [ ] `--no-cache`：禁用缓存
    - [ ] `--preload`：预加载相关文件
    - [ ] `--parallel <num>`：并行处理数量

## 文档和示例

- [ ] **API 文档**
  - [ ] 完整的 TypeScript 类型文档
  - [ ] CHM 阅读器 API 文档
  - [ ] 虚拟文件系统接口文档
  - [ ] JSDoc 注释补充
  - [ ] 在线 API 文档生成

- [ ] **使用示例**
  - [ ] **基础用法示例**
    - [ ] 简单的文件读取示例
    - [ ] CHM 文件信息获取示例
    - [ ] 目录结构遍历示例
  - [ ] **CHM 阅读器使用示例**
    - [ ] 完整的 CHM 阅读器应用示例
    - [ ] 流式数据处理示例
    - [ ] 缓存策略配置示例
    - [ ] 搜索功能集成示例
  - [ ] **平台集成示例**
    - [ ] **Electron 应用集成**
      - [ ] 主进程中打开和读取 CHM 文件
      - [ ] 渲染进程中显示 CHM 内容
      - [ ] IPC 通信处理 CHM 操作
      - [ ] 本地 CHM 文件浏览器应用
    - [ ] **Node.js 服务器示例**
      - [ ] Express 服务器提供 CHM 内容
      - [ ] RESTful API 接口设计
      - [ ] WebSocket 实时搜索
    - [ ] **Web Worker 示例**
      - [ ] 后台解析大型 CHM 文件
      - [ ] 非阻塞的文件索引构建

  - [ ] **高级用法示例**
    - [ ] 批量处理多个 CHM 文件
    - [ ] CHM 内容转换和迁移
    - [ ] 自定义缓存策略实现
    - [ ] 性能监控和优化
  - [ ] **错误处理示例**
    - [ ] 文件不存在处理
    - [ ] 损坏文件恢复
    - [ ] 网络错误重试机制
    - [ ] 内存不足优雅降级

- [ ] **教程**
  - [ ] CHM 文件格式说明
  - [ ] LZX 压缩算法介绍
  - [ ] 最佳实践指南

## 性能和优化

- [ ] **内存优化**
  - [ ] 流式处理大文件
  - [ ] 内存使用监控
  - [ ] 缓存策略优化

- [ ] **性能基准测试**
  - [ ] 与其他 CHM 工具的性能对比
  - [ ] 不同文件大小的处理时间测试
  - [ ] 内存使用效率测试

## 发布和部署

- [ ] **npm 包发布**
  - [ ] 配置 npm 发布流程
  - [ ] 设置 CI/CD 自动发布
  - [ ] 版本管理策略

- [ ] **跨平台支持**
  - [ ] Windows 平台测试
  - [ ] macOS 平台测试
  - [ ] Linux 平台测试
  - [ ] 二进制依赖处理

## 已完成项目

- [x] 项目结构创建
- [x] TypeScript 配置
- [x] 代码质量工具配置（ESLint, Prettier, Husky）
- [x] 基础类型定义
- [x] CLI 框架搭建
- [x] BitReader 工具类实现
- [x] Huffman 工具类实现
- [x] 项目文档结构
- [x] 构建和发布配置

---

## 优先级

**高优先级 (High Priority)**

- CHM 文件解析器实现
- LZX 解码器实现
- 基础的 extract 功能
- CHM 阅读器核心功能（虚拟文件系统 + 按需解码）

**中优先级 (Medium Priority)**

- CHM 阅读器高级特性（缓存策略、预加载、搜索）
- CHM 编码器实现
- pack 功能完善
- 完整的测试覆盖

**低优先级 (Low Priority)**

- 性能优化
- 高级 CLI 功能
- 详细文档
