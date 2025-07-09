# CHMKit

一个用于读取、解析和压缩 `.chm` 文件的 TypeScript 库，提供 CLI 工具和 API 接口。

[English](README.md) | **中文**

## 简介

CHMKit 是一个用于读取、解析和压缩 `.chm` 文件的 TypeScript 库，提供 CLI 工具和 API 接口。

## 安装

```bash
# 使用 npm
npm install -g chmkit

# 使用 pnpm
pnpm add -g chmkit

# 使用 yarn
yarn global add chmkit
```

## CLI 命令

```bash
# 查看帮助
chmkit --help

# 提取 CHM 文件内容
chmkit extract input.chm -o output/
chmkit extract input.chm --output ./docs --filter "*.html" --preserve-structure --verbose

# 打包目录为 CHM 文件
chmkit pack ./docs -o help.chm
chmkit pack ./src --output manual.chm --title "用户手册" --compression --verbose

# 查看 CHM 文件信息
chmkit info input.chm
chmkit info input.chm --json --verbose
```

## API 使用

```typescript
import { CHMKit } from 'chmkit';

// 解析 CHM 文件
const chmData = await CHMKit.parse('input.chm');

// 提取文件内容
await CHMKit.extract('input.chm', './output');

// 打包目录
await CHMKit.pack('./docs', 'help.chm');

// 获取文件信息
const info = await CHMKit.getInfo('input.chm');
```

## 配置

CHMKit 支持通过项目根目录的 `chmkit.config.json` 配置文件进行自定义。如果没有找到配置文件，将使用默认设置。

### 基础配置

在项目根目录创建 `chmkit.config.json` 文件：

```json
{
  "default": {
    "logLevel": "info",
    "tempDir": "./temp",
    "maxMemory": 104857600
  },
  "cli": {
    "showProgress": true,
    "maxConcurrency": 4,
    "colorOutput": true
  },
  "performance": {
    "chunkSize": 32768,
    "bufferSize": 65536
  }
}
```

### 配置选项

- **`default`** - 基础 CHMKit 设置（日志级别、临时目录、内存限制）
- **`lzx`** - LZX 压缩参数（窗口大小、压缩级别）
- **`format`** - CHM 文件格式设置（签名、版本、支持的扩展名）
- **`cli`** - CLI 工具行为（输出设置、并发数、进度显示）
- **`performance`** - 性能调优（块大小、缓冲区、阈值）
- **`validation`** - 文件验证设置（头部检查、校验和、严格模式）

### 在代码中使用配置

```typescript
import { getConfig, getCliConfig } from 'chmkit/config';

// 获取完整配置
const config = getConfig();

// 获取特定配置部分
const cliConfig = getCliConfig();

// 重新加载配置
const newConfig = getConfig(true);
```

详细的配置选项请参考 [CONFIG.md](CONFIG.md) 和 [配置示例文件](chmkit.config.json.example)。

## Node.js 版本要求

- Node.js >= 20.10.0

## 开发

```bash
# 克隆项目
git clone <repository-url>
cd chmkit

# 安装依赖
pnpm install

# 开发构建
pnpm build

# 代码检查
pnpm lint

# 格式化代码
pnpm format
```

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件。
