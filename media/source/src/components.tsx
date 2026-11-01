import React, {createContext, useContext} from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import cliLayout from '../public/captures/cli-layout.json';
import {color, font} from './tokens';
import {CursorKey, cursorAt, fadeIn} from './motion';

export type Box = {x: number; y: number; w: number; h: number};
export type Layer = {src: string; opacity: number};

// Scale from content units (CSS px of the capture) to frame px, shared with overlays.
const ScaleContext = createContext(1);

export const Stage: React.FC<{children: React.ReactNode}> = ({children}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at 50% 30%, #15243a 0%, ${color.bg} 68%)`,
      fontFamily: font,
      color: color.text,
      overflow: 'hidden',
    }}
  >
    {children}
  </AbsoluteFill>
);

export const fitBox = (srcW: number, srcH: number, maxW: number, maxH: number) => {
  const ratio = Math.min(maxW / srcW, maxH / srcH);
  return {w: Math.round(srcW * ratio), h: Math.round(srcH * ratio)};
};

type WindowProps = {
  srcW: number;
  srcH: number;
  frameW: number;
  frameH: number;
  left: number;
  top: number;
  layers: Layer[];
  cam: {x: number; y: number; z: number};
  children?: React.ReactNode;
  overlay?: React.ReactNode;
};

// Renders stacked captures inside a window frame. The camera is a focus point and zoom
// in content units; the content layer is clamped so the window never shows empty edges.
export const BrowserWindow: React.FC<WindowProps> = ({
  srcW,
  srcH,
  frameW,
  frameH,
  left,
  top,
  layers,
  cam,
  children,
  overlay,
}) => {
  const scale = (frameW / srcW) * cam.z;
  const clampTo = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const span = (content: number, frame: number, focus: number) =>
    content * scale <= frame
      ? (frame - content * scale) / 2
      : clampTo(frame / 2 - focus * scale, frame - content * scale, 0);
  const tx = span(srcW, frameW, cam.x);
  const ty = span(srcH, frameH, cam.y);
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: frameW,
        height: frameH,
        overflow: 'hidden',
        borderRadius: 14,
        background: color.surface,
        boxShadow: `0 0 0 1px ${color.line}, 0 30px 80px rgba(0, 0, 0, 0.5)`,
      }}
    >
      <ScaleContext.Provider value={scale}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: srcW,
            height: srcH,
            transformOrigin: '0 0',
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          }}
        >
          {layers.map((layer) => (
            <Img
              key={layer.src}
              src={staticFile(layer.src)}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: srcW,
                height: srcH,
                opacity: layer.opacity,
              }}
            />
          ))}
          {children}
        </div>
      </ScaleContext.Provider>
      {overlay}
    </div>
  );
};

export const Cursor: React.FC<{path: CursorKey[]}> = ({path}) => {
  const frame = useCurrentFrame();
  const scale = useContext(ScaleContext);
  const pos = cursorAt(frame, path);
  if (!pos) return null;
  const size = 30 / scale;
  return (
    <>
      {pos.ripple !== null && (
        <div
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            width: (16 + 34 * pos.ripple) / scale,
            height: (16 + 34 * pos.ripple) / scale,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: `${3 / scale}px solid ${color.accent}`,
            opacity: 1 - pos.ripple,
            boxSizing: 'border-box',
          }}
        />
      )}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{position: 'absolute', left: pos.x, top: pos.y, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'}}
      >
        <path
          d="M3 2 L3 19.5 L7.8 15 L10.8 21.6 L13.6 20.3 L10.6 13.9 L17 13.9 Z"
          fill="#ffffff"
          stroke="#0b1220"
          strokeWidth={1.4}
        />
      </svg>
    </>
  );
};

export const Highlight: React.FC<{box: Box; from: number; to: number}> = ({box, from, to}) => {
  const frame = useCurrentFrame();
  const scale = useContext(ScaleContext);
  const opacity = interpolate(frame, [from, from + 10, to - 10, to], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (opacity <= 0) return null;
  const pad = 6;
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x - pad,
        top: box.y - pad,
        width: box.w + pad * 2,
        height: box.h + pad * 2,
        boxSizing: 'border-box',
        border: `${3 / scale}px solid ${color.accent}`,
        borderRadius: 10,
        boxShadow: `0 0 ${24 / scale}px ${color.accent}66`,
        opacity,
      }}
    />
  );
};

// Replays typing into a field that the static capture shows empty. Character i appears at frames[i],
// which come from the keystroke onsets of the typing sound.
export const TypedInput: React.FC<{
  box: Box;
  text: string;
  frames: number[];
  hideAt: number;
}> = ({box, text, frames, hideAt}) => {
  const frame = useCurrentFrame();
  const scale = useContext(ScaleContext);
  const shown = frames.filter((at) => frame >= at).length;
  if (shown === 0) return null;
  const typing = frame < frames[frames.length - 1] + 15;
  const opacity = frame < hideAt ? 1 : 1 - fadeIn(frame, hideAt, 12);
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        boxSizing: 'border-box',
        background: color.field,
        border: `1px solid ${color.border}`,
        borderRadius: 7,
        padding: '0 13px',
        display: 'flex',
        alignItems: 'center',
        fontFamily: font,
        fontSize: 16,
        color: color.text,
        opacity,
      }}
    >
      <span>{text.slice(0, shown)}</span>
      <span
        style={{
          width: 1.5 / scale,
          height: 20,
          marginLeft: 1,
          background: color.accent,
          opacity: typing || Math.floor(frame / 15) % 2 === 0 ? 1 : 0,
        }}
      />
    </div>
  );
};

export type Segment = {from: number; to: number; text: string};

export const Caption: React.FC<{segments: Segment[]}> = ({segments}) => {
  const frame = useCurrentFrame();
  const seg = segments.find((s) => frame >= s.from && frame < s.to);
  if (!seg) return null;
  const opacity = interpolate(frame, [seg.from, seg.from + 8, seg.to - 8, seg.to], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const lift = interpolate(frame, [seg.from, seg.from + 10], [12, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 948,
        height: 132,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color.band,
        borderTop: `1px solid ${color.line}`,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${lift}px)`,
          fontSize: 60,
          fontWeight: 600,
          color: color.textStrong,
          whiteSpace: 'nowrap',
        }}
      >
        {seg.text}
      </div>
    </div>
  );
};

export const Wordmark: React.FC<{size: number; start: number}> = ({size, start}) => {
  const frame = useCurrentFrame();
  const lift = interpolate(frame, [start, start + 24], [28, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t: number) => 1 - Math.pow(1 - t, 3),
  });
  const opacity = fadeIn(frame, start, 20);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: size * 0.2,
        transform: `translateY(${lift}px)`,
        opacity,
      }}
    >
      <span style={{fontSize: size, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1}}>CHMKit</span>
      <span
        style={{
          width: size * 0.2,
          height: size * 0.2,
          borderRadius: '50%',
          background: color.accent,
          transform: `scale(${interpolate(frame, [start + 10, start + 26], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })})`,
        }}
      />
    </div>
  );
};

// Title card: wordmark lands, then the kicker and tagline fade in. Caller positions the card.
export const TitleCard: React.FC<{
  start: number;
  wordmarkSize?: number;
  kicker?: string;
  tagline: string;
  detail?: string;
}> = ({start, wordmarkSize = 180, kicker, tagline, detail}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 26}}>
      {kicker && (
        <div style={{fontSize: 48, fontWeight: 600, color: color.accent, opacity: fadeIn(frame, start + 14, 18)}}>
          {kicker}
        </div>
      )}
      <Wordmark size={wordmarkSize} start={start} />
      <div style={{fontSize: 56, fontWeight: 500, color: color.textStrong, opacity: fadeIn(frame, start + 30, 20)}}>
        {tagline}
      </div>
      {detail && (
        <div style={{fontSize: 40, fontWeight: 400, color: color.muted, opacity: fadeIn(frame, start + 42, 20)}}>
          {detail}
        </div>
      )}
    </AbsoluteFill>
  );
};

export const Chip: React.FC<{label: string; at: number; left: number; top: number}> = ({label, at, left, top}) => {
  const frame = useCurrentFrame();
  const t = fadeIn(frame, at, 12);
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        transform: `translate(-50%, -50%) scale(${0.9 + 0.1 * t})`,
        opacity: t,
        padding: '22px 46px',
        borderRadius: 999,
        background: color.surface,
        border: `2px solid ${color.border}`,
        fontSize: 68,
        fontWeight: 600,
        color: color.textStrong,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </div>
  );
};

// Riser visual: a mint line grows until the wordmark lands on the impact frame.
export const RiserLine: React.FC<{start: number; end: number}> = ({start, end}) => {
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.5, 0, 1, 1),
  });
  const fade = interpolate(frame, [end, end + 18], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 760,
        width: 560 * grow,
        height: 3,
        transform: 'translateX(-50%)',
        background: color.accent,
        opacity: fade,
      }}
    />
  );
};

export const Section: React.FC<{start: number; title: string; tagline: string}> = ({start, title, tagline}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 30}}>
      <div style={{fontSize: 150, fontWeight: 800, letterSpacing: '-0.03em', opacity: fadeIn(frame, start, 20)}}>
        {title}
      </div>
      <div style={{fontSize: 56, fontWeight: 500, color: color.muted, opacity: fadeIn(frame, start + 16, 20)}}>
        {tagline}
      </div>
    </AbsoluteFill>
  );
};

// Fixed title bar drawn over the scrolling terminal capture; the 56 px height matches the capture's own bar.
const TerminalBar: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      top: 0,
      right: 0,
      height: 56,
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '0 24px',
      boxSizing: 'border-box',
      background: '#1b2a40',
      color: color.muted,
      fontSize: 22,
    }}
  >
    <span style={{width: 16, height: 16, borderRadius: '50%', background: '#ff5f57'}} />
    <span style={{width: 16, height: 16, borderRadius: '50%', background: '#febc2e'}} />
    <span style={{width: 16, height: 16, borderRadius: '50%', background: '#28c840'}} />
    <span style={{marginLeft: 14}}>zsh — chm-kit</span>
  </div>
);

export type TerminalScene = keyof typeof cliLayout;

// A captured terminal. `pan` scrolls long output from top to bottom across [start, end];
// `reveal` shows the output line by line over [reveal[0], reveal[1]] for short outputs.
export const Terminal: React.FC<{
  scene: TerminalScene;
  start: number;
  end: number;
  reveal?: [number, number];
  scroll?: boolean;
}> = ({scene, start, end, reveal, scroll = true}) => {
  const frame = useCurrentFrame();
  const {w, h} = cliLayout[scene];
  const frameH = Math.min(903, h);
  const pan = scroll
    ? interpolate(frame, [start, end], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.25, 0, 0.2, 1),
      })
    : 0;
  const shown = reveal
    ? interpolate(frame, reveal, [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.linear,
      })
    : 1;
  return (
    <BrowserWindow
      srcW={w}
      srcH={h}
      frameW={w}
      frameH={frameH}
      left={(1920 - w) / 2}
      top={28 + (903 - frameH) / 2}
      layers={[{src: `captures/cli-${scene}.png`, opacity: 1}]}
      cam={{x: w / 2, y: frameH / 2 + (h - frameH) * pan, z: 1}}
      overlay={<TerminalBar />}
    >
      {shown < 1 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: h * shown,
            width: w,
            height: h - h * shown,
            background: '#111a2b',
          }}
        />
      )}
    </BrowserWindow>
  );
};
