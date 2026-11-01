import {Easing, interpolate} from 'remotion';

export type Cam = {f: number; x: number; y: number; z: number};
export type CursorKey = {f: number; x: number; y: number; click?: boolean};

export const RIPPLE_FRAMES = 20;

const ease = Easing.bezier(0.25, 0, 0.2, 1);

const clamped = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const fadeIn = (frame: number, at: number, duration: number) =>
  interpolate(frame, [at, at + duration], [0, 1], {...clamped, easing: ease});

export const camAt = (frame: number, keys: Cam[]) => {
  const input = keys.map((key) => key.f);
  const pick = (name: 'x' | 'y' | 'z') =>
    interpolate(
      frame,
      input,
      keys.map((key) => key[name]),
      {...clamped, easing: ease},
    );
  return {x: pick('x'), y: pick('y'), z: pick('z')};
};

export const cursorAt = (frame: number, path: CursorKey[]) => {
  if (frame < path[0].f) return null;
  const input = path.map((key) => key.f);
  const x = interpolate(frame, input, path.map((key) => key.x), {...clamped, easing: ease});
  const y = interpolate(frame, input, path.map((key) => key.y), {...clamped, easing: ease});
  const lastClick = path.filter((key) => key.click && key.f <= frame).at(-1);
  const progress = lastClick ? (frame - lastClick.f) / RIPPLE_FRAMES : null;
  return {x, y, ripple: progress !== null && progress <= 1 ? progress : null};
};
