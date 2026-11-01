import React from 'react';
import {useCurrentFrame} from 'remotion';
import layout from '../public/captures/viewer-layout.json';
import {
  BrowserWindow,
  Caption,
  Chip,
  Cursor,
  Highlight,
  Layer,
  RiserLine,
  Segment,
  Stage,
  Terminal,
  TitleCard,
  TypedInput,
} from './components';
import {Cam, CursorKey, camAt, fadeIn} from './motion';
import {BgmTrack, Cue, SfxTrack, typedFrames, typingCue} from './sfx';

// Scene plan at 30 fps, 37 s total: brand, hero, search, sidebar, CLI, feature chips, outro.
const SCENE = {
  brand: [0, 120],
  hero: [120, 300],
  search: [300, 480],
  sidebar: [480, 660],
  cli: [660, 840],
  chips: [840, 960],
  outro: [960, 1080],
} as const;
export const PROMO_FRAMES = SCENE.outro[1];

const VIEWER = {srcW: 1280, srcH: 860};
const VIEWER_WINDOW = {frameW: 1344, frameH: 903, left: 288, top: 28};

const TYPE_AT = 340;
const TYPE_FRAMES = typedFrames(TYPE_AT);

// 1.12 zoom keeps the header buttons, the search button and the sidebar list inside the frame.
const VIEWER_CAM: Cam[] = [
  {f: 120, x: 640, y: 430, z: 1},
  {f: 300, x: 571, y: 330, z: 1.12},
  {f: 340, x: 571, y: 190, z: 1.12},
  {f: 470, x: 571, y: 190, z: 1.12},
  {f: 500, x: 571, y: 330, z: 1.12},
  {f: 650, x: 571, y: 330, z: 1.12},
  {f: 660, x: 640, y: 430, z: 1},
];

const VIEWER_CURSOR: CursorKey[] = [
  {f: 305, x: 640, y: 600},
  {f: 322, x: 490, y: 147},
  {f: 330, x: 490, y: 147, click: true},
  {f: 355, x: 490, y: 147},
  {f: 385, x: 1003, y: 147},
  {f: 400, x: 1003, y: 147, click: true},
  {f: 530, x: 1003, y: 147},
  {f: 552, x: 144, y: 500},
];

const viewerLayers = (f: number): Layer[] => [
  {src: 'captures/viewer-document.png', opacity: 1},
  {src: 'captures/viewer-search.png', opacity: fadeIn(f, 406, 6)},
];

const CAPTIONS: Segment[] = [
  {from: 120, to: 300, text: 'CHM 解压、搜索、预览，全程在本地完成'},
  {from: 300, to: 480, text: '输入关键词，全文搜索直接定位到页面'},
  {from: 480, to: 660, text: '归档内文件一览无余，点击即可预览'},
  {from: 660, to: 840, text: '命令行同样好用：tree 看目录，search 搜全文'},
  {from: 840, to: 960, text: '一个库，覆盖 CHM 的常用操作'},
];

const TREE_REVEAL: [number, number] = [668, 728];

const CUES: Cue[] = [
  {sample: 'riser', at: 84, volume: 0.9, note: '品牌升起，字标落定同步冲击'},
  {sample: 'impact', at: 84, volume: 0.55, note: '字标落定冲击'},
  {sample: 'sparkle', at: 96, volume: 0.3, note: '强调线点亮'},
  {sample: 'whoosh', at: 120, volume: 0.9, note: '切到主界面'},
  {sample: 'clickSoft', at: 330, volume: 0.6, note: '点击搜索框'},
  typingCue(TYPE_AT, 0.5, '逐字输入「边界条件」，与击键起点对齐'),
  {sample: 'click', at: 400, volume: 0.9, note: '点击「全文搜索」'},
  {sample: 'whoosh', at: 480, volume: 0.7, note: '切到归档文件列表'},
  {sample: 'whoosh', at: 660, volume: 0.9, note: '切入命令行'},
  typingCue(674, 0.4, 'tree 命令输入'),
  typingCue(712, 0.4, 'search 命令输入'),
  {sample: 'whoosh', at: 840, volume: 0.8, note: '切到功能标签'},
  {sample: 'click', at: 850, volume: 0.8, note: '功能标签 1'},
  {sample: 'clickSoft', at: 868, volume: 0.6, note: '功能标签 2'},
  {sample: 'click', at: 886, volume: 0.8, note: '功能标签 3'},
  {sample: 'clickSoft', at: 904, volume: 0.6, note: '功能标签 4'},
  {sample: 'sparkle', at: 986, volume: 0.3, note: '结尾字标落定'},
];

export const Promo: React.FC<{bgm: boolean}> = ({bgm}) => {
  const frame = useCurrentFrame();
  const inRange = ([from, to]: readonly [number, number]) => frame >= from && frame < to;

  return (
    <Stage>
      {inRange(SCENE.brand) && (
        <>
          <RiserLine start={0} end={84} />
          <TitleCard start={60} wordmarkSize={200} tagline="读懂每一份 CHM 文档" detail="浏览器 · 命令行 · 本地处理" />
        </>
      )}

      {inRange(SCENE.hero) || inRange(SCENE.search) || inRange(SCENE.sidebar) ? (
        <BrowserWindow
          {...VIEWER_WINDOW}
          srcW={VIEWER.srcW}
          srcH={VIEWER.srcH}
          layers={viewerLayers(frame)}
          cam={camAt(frame, VIEWER_CAM)}
        >
          <Highlight box={layout.loaded.boundaries} from={540} to={650} />
          <TypedInput box={layout.search.input} text="边界条件" frames={TYPE_FRAMES} hideAt={412} />
          <Cursor path={VIEWER_CURSOR} />
        </BrowserWindow>
      ) : null}

      {inRange(SCENE.cli) && (
        <Terminal scene="tree-search" start={SCENE.cli[0]} end={SCENE.cli[1]} reveal={TREE_REVEAL} scroll={false} />
      )}

      {inRange(SCENE.chips) && (
        <>
          <Chip label="读取" at={850} left={420} top={480} />
          <Chip label="搜索" at={868} left={780} top={480} />
          <Chip label="导出" at={886} left={1140} top={480} />
          <Chip label="打包" at={904} left={1500} top={480} />
        </>
      )}

      {inRange(SCENE.outro) && (
        <TitleCard
          start={SCENE.outro[0]}
          wordmarkSize={180}
          tagline="让 CHM 文档，在浏览器里重新打开。"
          detail="github.com/fwx5618177/chm-kit"
        />
      )}

      <Caption segments={CAPTIONS} />
      <SfxTrack cues={CUES} />
      {bgm && <BgmTrack durationInFrames={PROMO_FRAMES} />}
    </Stage>
  );
};
