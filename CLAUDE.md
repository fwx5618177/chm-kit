# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

CHMKit 是一个 TypeScript 库，用于读取、解析和压缩 `.chm` 文件，并提供命令行工具。该项目支持 CommonJS 和 ESM 构建，并为 CHM 文件操作提供命令行界面。

## 开发命令

- **构建**: `pnpm build` - 构建类型、ESM 和 CJS 版本
  - `pnpm run build:types` - TypeScript 声明文件到 `dist/types`
  - `pnpm run build:esm` - ES 模块到 `dist/esm`
  - `pnpm run build:cjs` - CommonJS 模块到 `dist/cjs`
- **开发**: `pnpm dev` - 使用 tsx 在监听模式下运行 CLI
- **代码检查**: `pnpm lint` - ESLint 检查，`pnpm lint:fix` - 自动修复
- **格式化**: `pnpm format` - Prettier 格式化
- **测试**: `pnpm test` - 使用 tsx 运行测试，`pnpm test:watch` - 监听模式
- **清理**: `pnpm clean` - 删除 dist 目录

## 架构概述

### 核心结构

- **`src/core/`** - 核心 CHM 解析功能
  - `chm-parser.ts` - 主要 CHM 文件解析器
  - `types.ts` - CHM 结构的 TypeScript 接口
  - `headers/` - ITSF、ITSP、LZXC 头部解析器
  - `lzx/` - LZX 解压缩（解码器、滑动窗口、重置表）
  - `directory/` - 目录结构解析
  - `file-reconstructor.ts` - 从压缩数据重建文件

### 操作层

- **`src/operations/`** - 高级操作（extract、pack、info、parse）
- **`src/encoder/`** - CHM 编码和压缩
- **`src/utils/`** - 工具类（位读取器、哈夫曼、日志工具）

### 命令行界面

- **`src/cli/`** - 使用 Commander.js 的命令行界面
  - `index.ts` - 主要 CLI 入口点
  - `commands/` - 单独的命令（extract、pack、info）

### 关键组件

- **CHMKit** (`src/chm-kit.ts`) - 主要 API 类
- **Logger** (`src/logger/`) - 分级结构化日志
- **Constants** (`src/constants.ts`) - 版本和配置常量

## 构建系统

- **TypeScript**: ES2020 目标，严格模式
- **模块解析**: Node 与路径映射（`@/*` → `src/*`）
- **多格式**: 构建 CJS、ESM 和 TypeScript 声明
- **包管理器**: pnpm 9.0.0
- **Node 要求**: >= 20.10.0

## 测试

- **框架**: 使用 tsx 直接运行 TypeScript 测试
- **位置**: `test/` 目录下的 `.test.ts` 文件
- **示例数据**: `test/sample-chm/` 包含测试 CHM 文件和结构

## 命令行使用

该包提供 `chm` 和 `chmkit` 二进制文件，包含以下命令：

- `chmkit extract` - 提取 CHM 内容
- `chmkit pack` - 从目录创建 CHM
- `chmkit info` - 显示 CHM 文件信息

## 配置

项目支持通过 `chmkit.config.json` 进行配置，包含日志、LZX 压缩、CLI 行为和性能调优等部分。
