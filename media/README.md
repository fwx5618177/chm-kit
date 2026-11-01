# CHMKit 视频

本目录是 CHMKit 的演示视频与源码。画面全部来自本仓库的真实构建产物（浏览器查看器截图与 CLI 终端输出），字幕为中文。

## 成片

| 文件                        | 时长     | 分辨率    | 背景音乐 | 内容                           |
| --------------------------- | -------- | --------- | -------- | ------------------------------ |
| `chmkit-tutorial.mp4`       | 62.06 秒 | 1920×1080 | 有       | 使用教程：浏览器查看器与命令行 |
| `chmkit-tutorial-nobgm.mp4` | 62.06 秒 | 1920×1080 | 无       | 同一时间线，只保留音效         |
| `chmkit-promo.mp4`          | 36.05 秒 | 1920×1080 | 有       | 宣传片：品牌、功能概览与命令行 |
| `chmkit-promo-nobgm.mp4`    | 36.05 秒 | 1920×1080 | 无       | 同一时间线，只保留音效         |

- 有背景音乐与无背景音乐的版本画面和音效时间线完全相同，只差一条背景音乐。
- `chmkit-tutorial-preview.gif`、`chmkit-promo-preview.gif`：从无背景音乐成片截取的 8 秒循环预览（640×360），用于 README 直接展示，点击跳转到完整视频。
- 视频格式：H.264（yuv420p）+ AAC 48 kHz 立体声，30 fps。

## 音频与授权

- 背景音乐：《House Vibez》，作者 Lily J，来自 Mixkit，采用 Mixkit Stock Music Free License（可商用，无需署名）。音量经过压低，积分响度约 −30 LUFS，比音效低约 7 LU。来源与许可见 [source/public/audio/bgm/BGM-CREDITS.md](source/public/audio/bgm/BGM-CREDITS.md)。
- 音效：全部来自 Freesound，许可为 CC0-1.0，清单见 [source/public/audio/sfx/FREESOUND-CREDITS.md](source/public/audio/sfx/FREESOUND-CREDITS.md)。
- 质量说明：背景音乐与音效的音量由测量确定，**尚未经过人工试听**。若感觉音乐偏大或偏小，只需修改 `source/src/sfx.tsx` 中的 `BGM_VOLUME` 并重新渲染。

## 源码

`source/` 是独立的 Remotion 工程，使用 `npm` 管理依赖，不参与 chm-kit 的 `pnpm` 构建、lint 或 TypeScript 检查。

- `source/src/`：分镜（`Tutorial.tsx`、`Promo.tsx`）、音效时间线（`sfx.tsx`）、界面组件与动效。
- `source/scripts/capture-viewer.cjs`、`capture-cli.cjs`：从 chm-kit 的 `dist/` 产物截取画面，需先执行 chm-kit 的 `pnpm build`。
- `source/scripts/measure-audio-offset.py`：测量输出音轨延迟，用于校准音效同步。
- `source/DESIGN.md`：分镜表、音效表、响度数据、已知限制与完整复现步骤。

复现（在 `media/source/` 目录下执行）：

```sh
npm ci
node scripts/capture-viewer.cjs    # 可选：重新截取查看器画面
node scripts/capture-cli.cjs       # 可选：重新截取 CLI 画面
npm run render:tutorial && npm run render:tutorial:nobgm
npm run render:promo && npm run render:promo:nobgm
```

渲染结果写入 `source/out/`，该目录与 `source/node_modules/` 均已被忽略。
