# CHMKit 配置说明

CHMKit 支持通过 `chmkit.config.json` 配置文件来自定义行为。如果项目根目录没有配置文件，将使用默认配置。

## 配置文件位置

CHMKit 会在以下位置查找配置文件：

- 当前工作目录下的 `chmkit.config.json`

## 配置文件结构

配置文件采用 JSON 格式，包含以下主要部分：

### `default` - 基础配置

```json
{
  "default": {
    "logLevel": "info", // 日志级别: "silent" | "error" | "warn" | "info" | "debug"
    "tempDir": "./temp", // 临时文件目录
    "maxMemory": 104857600 // 最大内存使用量(字节)，默认 100MB
  }
}
```

### `lzx` - LZX 压缩配置

```json
{
  "lzx": {
    "windowSize": 32768, // 滑动窗口大小，默认 32KB
    "resetInterval": 32768, // 重置间隔
    "compressionLevel": 6 // 压缩级别 (1-9)
  }
}
```

### `format` - CHM 文件格式配置

```json
{
  "format": {
    "itsfSignature": "ITSF", // ITSF 头部签名
    "itsfVersion": 3, // ITSF 版本
    "itspSignature": "ITSP", // ITSP 头部签名
    "itspVersion": 1, // ITSP 版本
    "lzxcSignature": "LZXC", // LZXC 头部签名
    "lzxcVersion": 2, // LZXC 版本
    "defaultFiles": {
      "toc": "Table of Contents.hhc", // 默认目录文件名
      "index": "Index.hhk", // 默认索引文件名
      "project": "Project.hhp" // 默认项目文件名
    },
    "supportedExtensions": [
      // 支持的文件扩展名
      ".html",
      ".htm",
      ".css",
      ".js",
      ".json",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
      ".ico",
      ".xml",
      ".txt",
      ".md"
    ]
  }
}
```

### `cli` - CLI 工具配置

```json
{
  "cli": {
    "defaultOutputDir": "./output", // 默认输出目录
    "defaultOutputFile": "./output.chm", // 默认输出文件
    "defaultTempDir": "./temp", // 默认临时目录
    "maxConcurrency": 4, // 最大并发数
    "showProgress": true, // 显示进度条
    "colorOutput": true // 彩色输出
  }
}
```

### `performance` - 性能配置

```json
{
  "performance": {
    "chunkSize": 32768, // 数据块大小，默认 32KB
    "bufferSize": 65536, // 缓冲区大小，默认 64KB
    "maxFileSize": 524288000, // 最大文件大小，默认 500MB
    "compressionThreshold": 1024 // 压缩阈值，默认 1KB
  }
}
```

### `validation` - 验证配置

```json
{
  "validation": {
    "validateHeaders": true, // 验证文件头部
    "validateChecksums": true, // 验证校验和
    "strictMode": false, // 严格模式
    "allowMissingFiles": false // 允许缺失文件
  }
}
```

## 使用示例

### 创建配置文件

在项目根目录创建 `chmkit.config.json`：

```json
{
  "default": {
    "logLevel": "debug",
    "tempDir": "./temp"
  },
  "cli": {
    "showProgress": false,
    "maxConcurrency": 8
  },
  "performance": {
    "chunkSize": 65536
  }
}
```

### 程序化使用

```typescript
import { getConfig, getCliConfig, resetConfigCache } from '@/src/core/config';

// 获取完整配置
const config = getConfig();

// 获取特定配置部分
const cliConfig = getCliConfig();

// 重新加载配置
resetConfigCache();
const newConfig = getConfig(true);
```

## 配置优先级

1. **用户配置文件** - `chmkit.config.json` 中的设置
2. **默认配置** - 内置的默认值

用户配置会与默认配置进行深度合并，只有指定的字段会覆盖默认值。

## 配置验证

CHMKit 会验证配置文件的格式：

- 无效的配置项会被忽略并显示警告
- 配置文件解析错误时会回退到默认配置
- 支持部分配置，未指定的部分使用默认值

## 环境特定配置

可以在不同环境使用不同的配置文件：

```bash
# 开发环境
cp chmkit.config.development.json chmkit.config.json

# 生产环境
cp chmkit.config.production.json chmkit.config.json
```

## 完整示例

查看 `chmkit.config.json.example` 文件了解所有可配置选项的完整示例。
