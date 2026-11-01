import React from 'react';
import {useCurrentFrame} from 'remotion';
import layout from '../public/captures/viewer-layout.json';
import {
  BrowserWindow,
  Caption,
  Cursor,
  Highlight,
  Layer,
  RiserLine,
  Section,
  Segment,
  Stage,
  Terminal,
  TitleCard,
  TypedInput,
} from './components';
import {Cam, CursorKey, camAt, fadeIn} from './motion';
import {BgmTrack, Cue, SfxTrack, typedFrames, typingCue} from './sfx';

// Scene plan at 30 fps. Every frame that a sound cue or another scene depends on is named here.
const SCENE = {
  title: [0, 150],
  viewer: [150, 960],
  section: [960, 1110],
  help: [1110, 1350],
  tree: [1350, 1500],
  read: [1500, 1740],
  outro: [1740, 1860],
} as const;
export const TUTORIAL_FRAMES = SCENE.outro[1];

const VIEWER = {srcW: 1280, srcH: 860};
// 1.05 frame px per CSS px; leaves the 132 px caption band free at the bottom.
const VIEWER_WINDOW = {frameW: 1344, frameH: 903, left: 288, top: 28};

// Zoom targets keep the search toolbar and the sidebar edges inside the frame.
const VIEWER_CAM: Cam[] = [
  {f: 150, x: 640, y: 430, z: 1},
  {f: 420, x: 640, y: 430, z: 1.04},
  {f: 570, x: 640, y: 430, z: 1.04},
  {f: 640, x: 541, y: 190, z: 1.2},
  {f: 800, x: 541, y: 190, z: 1.2},
  {f: 840, x: 582, y: 330, z: 1.1},
  {f: 960, x: 640, y: 430, z: 1},
];

// Click frames line up with the cue table; clicks alternate between the two click samples.
const VIEWER_CURSOR: CursorKey[] = [
  {f: 160, x: 640, y: 600},
  {f: 215, x: 1043, y: 53},
  {f: 230, x: 1043, y: 53, click: true},
  {f: 322, x: 144, y: 500},
  {f: 345, x: 144, y: 500, click: true},
  {f: 440, x: 490, y: 147},
  {f: 628, x: 490, y: 147, click: true},
  {f: 700, x: 490, y: 147},
  {f: 720, x: 1003, y: 147},
  {f: 726, x: 1003, y: 147, click: true},
  {f: 790, x: 1003, y: 147},
  {f: 808, x: 1103, y: 146},
  {f: 816, x: 1103, y: 146, click: true},
];

const TYPE_AT = 640;
const TYPE_FRAMES = typedFrames(TYPE_AT);

const viewerLayers = (f: number): Layer[] => [
  {src: 'captures/viewer-start.png', opacity: 1},
  {src: 'captures/viewer-loaded.png', opacity: fadeIn(f, 240, 16)},
  {src: 'captures/viewer-document.png', opacity: fadeIn(f, 350, 16)},
  {src: 'captures/viewer-search.png', opacity: fadeIn(f, 732, 6)},
  {src: 'captures/viewer-toc.png', opacity: fadeIn(f, 822, 6)},
];

const CAPTIONS: Segment[] = [
  {from: 150, to: 240, text: '第一步：点击「加载演示文档」'},
  {from: 240, to: 350, text: '左侧列出归档中的全部文件，点击即可预览'},
  {from: 350, to: 420, text: '文档在浏览器内渲染，无需上传'},
  {from: 420, to: 570, text: '预览默认禁用 HTML 脚本，内容安全可读'},
  {from: 570, to: 726, text: '输入关键词，点击「全文搜索」'},
  {from: 726, to: 828, text: '匹配结果按文件列出，点击即可打开'},
  {from: 828, to: 960, text: '「查看目录」展示 CHM 自带的目录结构'},
  {from: 960, to: 1110, text: '命令行与浏览器共用同一套读取能力'},
  {from: 1110, to: 1350, text: '--help 列出全部子命令与参数'},
  {from: 1350, to: 1500, text: 'tree 查看目录树，search 按关键词搜索全文'},
  {from: 1500, to: 1740, text: 'read 读取单个文件，extract 批量导出全部内容'},
];

// Cue frames are the visual beats; peak alignment and the measured output offset are applied in sfx.tsx.
const CUES: Cue[] = [
  {sample: 'riser', at: 84, volume: 0.9, note: '标题升起，字标落定同步冲击'},
  {sample: 'impact', at: 84, volume: 0.55, note: '字标落定冲击'},
  {sample: 'sparkle', at: 96, volume: 0.3, note: '强调线点亮'},
  {sample: 'click', at: 230, volume: 1, note: '点击「加载演示文档」'},
  {sample: 'clickSoft', at: 345, volume: 0.6, note: '点击 docs/boundaries.html'},
  {sample: 'click', at: 628, volume: 0.9, note: '点击搜索框'},
  typingCue(TYPE_AT, 0.5, '逐字输入「边界条件」，与击键起点对齐'),
  {sample: 'clickSoft', at: 726, volume: 0.6, note: '点击「全文搜索」'},
  {sample: 'click', at: 816, volume: 0.9, note: '点击「查看目录」'},
  {sample: 'whoosh', at: 960, volume: 0.9, note: '切入命令行段落'},
  {sample: 'whoosh', at: 1110, volume: 0.6, note: '切入终端截图'},
  typingCue(1362, 0.4, 'tree 命令输入'),
  typingCue(1403, 0.4, 'search 命令输入'),
  {sample: 'whoosh', at: 1500, volume: 0.8, note: '切入 read / extract 段落'},
  {sample: 'whoosh', at: 1740, volume: 0.7, note: '切入结尾'},
  {sample: 'sparkle', at: 1766, volume: 0.3, note: '结尾字标落定'},
];

export const Tutorial: React.FC<{bgm: boolean}> = ({bgm}) => {
  const frame = useCurrentFrame();
  const inRange = ([from, to]: readonly [number, number]) => frame >= from && frame < to;

  return (
    <Stage>
      {inRange(SCENE.title) && (
        <>
          <RiserLine start={0} end={84} />
          <TitleCard
            start={60}
            kicker="使用教程"
            tagline="浏览器与命令行，都能读懂 CHM 文档"
            detail="读取 · 搜索 · 导出，全部在本地完成"
          />
        </>
      )}

      {inRange(SCENE.viewer) && (
        <BrowserWindow
          {...VIEWER_WINDOW}
          srcW={VIEWER.srcW}
          srcH={VIEWER.srcH}
          layers={viewerLayers(frame)}
          cam={camAt(frame, VIEWER_CAM)}
        >
          <Highlight box={layout.search.firstResult} from={760} to={812} />
          <Highlight box={layout.toc.firstEntry} from={850} to={930} />
          <TypedInput box={layout.search.input} text="边界条件" frames={TYPE_FRAMES} hideAt={738} />
          <Cursor path={VIEWER_CURSOR} />
        </BrowserWindow>
      )}

      {inRange(SCENE.section) && <Section start={SCENE.section[0]} title="命令行" tagline="同一份 CHM，同样的读取与搜索能力" />}
      {inRange(SCENE.help) && <Terminal scene="help" start={SCENE.help[0]} end={SCENE.help[1]} />}
      {inRange(SCENE.tree) && (
        <Terminal scene="tree-search" start={SCENE.tree[0]} end={SCENE.tree[1]} reveal={[1356, 1420]} scroll={false} />
      )}
      {inRange(SCENE.read) && <Terminal scene="read-extract" start={SCENE.read[0]} end={SCENE.read[1]} />}

      {inRange(SCENE.outro) && (
        <TitleCard
          start={SCENE.outro[0]}
          wordmarkSize={150}
          tagline="读取 · 搜索 · 导出，一切在本地完成"
          detail="github.com/fwx5618177/chm-kit"
        />
      )}

      <Caption segments={CAPTIONS} />
      <SfxTrack cues={CUES} />
      {bgm && <BgmTrack durationInFrames={TUTORIAL_FRAMES} />}
    </Stage>
  );
};
