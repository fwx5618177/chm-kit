# CHMKit 文档

在浏览器中打开本地 CHM、在终端中使用命令行，或把库集成到自己的应用中。

[中文 README](../README.md) · [English README](../README.en.md) · [API 参考](api.md)

## 按目标选择指南

| 我想要…                                     | 阅读                                             |
| ------------------------------------------- | ------------------------------------------------ |
| 打开浏览器查看器，或安装、校验发布包        | [安装与验证](guide/downloads.md)（英文）         |
| 在终端中查看、搜索、读取、提取、打包        | [命令行使用指南](guide/cli.md)（中文）           |
| 在网页中读取本地文件，并安全地预览 CHM 页面 | [浏览器使用指南](guide/browser.md)（中文）       |
| 在 Node.js 服务或脚本中复用读取器、流式读取 | [Node.js 指南](guide/node.md)（英文）            |
| 把解析放到 Worker，避免阻塞界面线程         | [Worker 指南](guide/worker.md)（英文）           |
| 在 Electron 中开放受控的归档能力            | [Electron 指南](guide/electron.md)（英文）       |
| 创建 CHM、自定义目录、重建更新后的归档      | [打包与更新](guide/packing.md)（英文）           |
| 理解配置项与内存、资源预算                  | [配置与资源预算](guide/configuration.md)（英文） |
| 从旧版本迁移调用方式                        | [迁移指南](guide/migration.md)（英文）           |
| 了解 ITSF、LZX 帧与重置的格式细节           | [CHM 与 LZX 格式](guide/format-lzx.md)（英文）   |
| 查找函数签名与导出类型                      | [API 参考](api.md)                               |

## 示例代码

- [浏览器查看器源码](../examples/browser/README.md)：文件选择、预览与 Worker 生命周期。
- [Worker 示例](../examples/worker/README.md)：客户端、Worker 入口与资源释放。
- [Electron 示例](../examples/electron/README.md)：主进程归档、沙箱预加载与渲染进程。
- [Node HTTP 服务示例](guide/node.md)：只读、固定归档的文本服务，包含明确的限制与关闭流程。

## 与发布包的关系

示例中的 `dist/viewer/index.html` 包含在 npm 发布包中，可直接以 `file:` 方式打开，
无需 Node.js、构建步骤或本地服务器。库的 ESM 与 module Worker 集成需要通过 HTTP(S) 提供文件。
安装与校验方式见 [安装与验证](guide/downloads.md)。

## 安全、许可与维护

使用前请阅读 [SECURITY.md](../SECURITY.md)，了解上传归档、预览与 IPC 的风险。
[许可与语料政策](guide/licensing.md) 说明 MIT 许可的实现代码与第三方测试数据的区别。
实际的测试执行结果与平台证据记录在 [VALIDATION.md](../VALIDATION.md)，文档中不硬编码测试数量。

[更新日志](../CHANGELOG.md) · [参与贡献](../CONTRIBUTING.md) · [CI 与发布策略](../.github/PIPELINES.md)
