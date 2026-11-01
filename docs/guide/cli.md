# 命令行使用指南

[文档首页](../index.md) · [下载与安装](downloads.md) · [配置与资源预算](configuration.md)

本页示例使用 `chmkit` 命令（安装 npm 包后可用，别名 `chm`）。如果使用独立下载的 CLI，请把命令替换为
`node chmkit-<版本>-cli.cjs`，版本号以发布包的 `manifest.json` 为准。下面的 `manual.chm` 请替换为你自己的文件。

```sh
chmkit --help
chmkit read --help
chmkit info manual.chm
chmkit info manual.chm --json
chmkit read manual.chm --list --format json
chmkit tree manual.chm --depth 2 --json
```

`info` 默认输出可读的统计报告；加 `--json` 时输出 JSON。

## 搜索与过滤

```sh
chmkit search manual.chm "安装" --type html,txt --limit 10 --json
chmkit search manual.chm "index" --names --case-sensitive
chmkit tree manual.chm --filter "**/*.html" --max-size 2MiB
chmkit read manual.chm --list --type "image/*" --min-size 1KiB --format json
```

- `--filter`（glob）、`--type`（逗号分隔的扩展名或 MIME）、`--min-size` 和 `--max-size` 取交集。
- 大小限制针对**解压后的**大小，且包含边界值。大小可写为字节数、十进制单位（KB、MB、GB）或二进制单位（KiB、MiB、GiB）。
- glob 请加引号，避免被 shell 提前展开。
- MIME 类型根据文件名推断，不代表内容安全检查结果。
- 对 `read` 而言，这些过滤条件**只作用于 `--list`**；在这里 `-f` 表示 `--format`。

内容搜索是字面量匹配，会跳过二进制 MIME 类型，返回包含匹配项的文件，而不是持久化的搜索索引。

- `--limit` 限制匹配文件数（`0` 表示不返回任何结果），`--max-matches` 限制每个文件的匹配数。
- `--whole-word` 使用 Unicode 单词边界；`--encoding` 指定解码方式。
- `--names` 只搜索文件名子串，不能与 `--whole-word` 或 `--encoding` 同时使用。
- `--max-read-size 16MiB` 限制一次物化读取的源文件大小，它**不是**归档大小或 CPU 时间的限制。

## 读取字节、文本或导航

```sh
# 先确认归档中存在 /index.html
chmkit read manual.chm /index.html
chmkit read manual.chm /index.html --encoding GBK --format json
chmkit read manual.chm /index.html --range 0:16 --format raw --output first.bin
chmkit read manual.chm /index.html --stream --output page.html
chmkit read manual.chm --toc --format json
chmkit read manual.chm --index --format json
```

- 文件路径、`--list`、`--toc` 和 `--index` 必须且只能选择一个。
- `--range start:end` 是严格的左闭右开**字节**区间 `[start, end)`；必须在文件范围内，并且可能切开多字节字符。
- `--format raw` 保留原始字节；文本与 JSON 默认按 UTF-8 解码，除非指定 `--encoding`。
- 单个文件的 JSON 输出包含解码后的内容和元数据。目录与索引的 JSON 输出为结构化导航数据；text 与 raw 输出则返回原始 `.hhc` / `.hhk` 源内容。
- `--stream` 始终输出原始字节，不受默认文本格式影响。它支持 `--range` 和 `--output`，**不支持** JSON。
- `--list` 不接受 raw、range 或 stream。
- `read --output` 会写入你指定的普通文件，**可能覆盖已有文件**。它不继承 `extract` 的"只允许新建文件、禁止符号链接"策略。

## 提取一个或多个归档

```sh
chmkit extract manual.chm --output ./manual-new --preserve-structure --json
chmkit extract manual.chm --output ./html-new --preserve-structure --type html --concurrency 4 --chunk-size 65536 --progress
chmkit batch first.chm second.chm --output ./batch-new --preserve-structure --json
```

- 建议使用全新的私有输出目录。不加 `--preserve-structure` 时文件名会被扁平化，重名会失败。已存在的目标不会被覆盖。
- 不安全的可移植文件名、路径穿越、冲突的目标和符号链接都会被拒绝，包括输出根目录的各级祖先。在 macOS 上请使用真实路径，而不是 `/tmp` 这样的符号链接别名。
  不要提取到可能被恶意本地进程并发修改的目录中，参见 [SECURITY.md](../../SECURITY.md) 的 TOCTOU 限制。
- 输入是基于文件的：通过同步的定位读取和解压完成，不会先把整个归档复制到内存。提取期间必须保证底层文件内容不变，而不仅是路径稳定。文件描述符在成功、出错或取消时都会关闭。
- `--concurrency` 限制的是异步输出 I/O，**不是**解码器的并行 CPU 计算。`--chunk-size` 为每个 worker 的写入块字节数（整数）。
  目录元数据以及每个生成器的解码器和块工作区仍会占用内存；并发数不是总内存上限。
- `batch` 逐个处理归档，每个归档内部使用异步 I/O 并发。输出为编号的规范化子目录，例如 `1-first/`。
  它接收显式的输入参数，不会自行展开文件系统通配符。
- Ctrl-C 会停止调度、等待正在进行的工作收尾，并尝试删除未完成的文件；已完成的文件保留。提取不是全有或全无的事务。
- JSON 结果包含成功列表与错误列表（`batch` 为每个已处理的归档返回一条结果）。存在部分错误时，不能视为完全成功。

## 预览与浏览

```sh
chmkit preview manual.chm /index.html --output ./preview-new.html
chmkit browse manual.chm
```

- `preview` 生成**静态、非交互的快照**，不是 Web 服务器。它不会启动浏览器，也不会打包归档中的资源。
  HTML 或文本内容会显示在无脚本、受 CSP 限制的沙箱中；外部资源和交互被禁用，因此样式、图片和链接可能无法正常显示。
  输出文件采用独占创建，拒绝符号链接祖先目录，且父目录必须已存在。省略 `--output` 时，生成的 HTML 输出到 stdout。归档内容仍应视为不可信内容。
- `browse` 要求 stdin 和 stderr 都是 TTY。支持的命令包括 `list [glob]`、`read <path>`、`info <path>`、`search <text>`、`help` 和 `quit`。
  界面输出到 stderr，而不是 stdout。文本显示会转义终端控制字符，并将读取内容截断为 64 KiB；它不是二进制文件查看器。自动化脚本应使用 `tree`、`search` 和 `read`。

## 创建归档

先准备一个包含 `index.html` 的 `html-manual/` 目录：

```sh
chmkit pack ./html-manual --output manual.chm --title "手册" --default-topic index.html
chmkit pack ./html-manual --output tuned.chm --compression-level 6 --window-bits 16 --reset-interval 131072 --block-size 8192
chmkit pack ./html-manual --output stored.chm --no-compression
```

压缩相关选项的含义见 [打包与更新指南](packing.md)。目录模板和高级元数据是 API 选项，不是额外的命令行参数。
`pack` 写入的是普通文件：请选择新的文件名，不要假设 `extract` 的禁止覆盖保护同样适用于它。

## 配置与自动化约定

```sh
chmkit --config ./chmkit.config.json search manual.chm "安装" --json
```

显式指定的配置文件必须有效，否则命令失败；未指定时，CLI 会读取当前工作目录下的 `chmkit.config.json`。
命令行参数优先于配置项。具体的[字段与操作的对应关系](configuration.md)很重要：历史上被接受但未真正生效的字段，
CLI 会给出警告并忽略。

机器可读的结果输出到 stdout，诊断信息和进度输出到 stderr，二者分开。
普通错误和部分提取失败会以非零退出码结束（通常为 `1`）；提取被取消时退出码为 `130`。参数错误同样返回非零退出码。
仅凭 JSON 结果不能证明操作成功，还应检查退出码以及 `errors`、`cancelled` 字段。
