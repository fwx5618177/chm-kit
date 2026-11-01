import React from 'react';
import {Audio, interpolate, Sequence, staticFile} from 'remotion';
import {FPS} from './tokens';

// Measured onset offset of the rendered AAC track (Remotion 4.0.484, AAC 48 kHz MP4).
// Initial value from sound-design §4.6; re-measure with scripts/measure-audio-offset.py after each render setup change.
export const OUTPUT_AUDIO_OFFSET_F = 1.28;

// peakF: frame offset of the sample's 10 ms energy peak (manifest analysis.energy_peak_seconds × 30).
export const SAMPLES = {
  click: {file: 'fs-687105.mp3', peakF: 6}, // Mouse 1 Button Fast Click (CC0, aphom000)
  clickSoft: {file: 'fs-567265.mp3', peakF: 3}, // Mouse Click (CC0, D4XX)
  typing: {file: 'fs-645921.mp3', peakF: 89}, // keyboard typing (CC0), start-anchored
  whoosh: {file: 'fs-443466.mp3', peakF: 24}, // iron whoosh (CC0)
  impact: {file: 'fs-812735.mp3', peakF: 7}, // Sound Design Elements Impact PS 069 (CC0)
  riser: {file: 'fs-685256.mp3', peakF: 82}, // Riser sound effect short (CC0, syntheffects)
  sparkle: {file: 'fs-545238.mp3', peakF: 0}, // Item Sparkle (CC0)
} as const;

export type SampleName = keyof typeof SAMPLES;

export type Cue = {
  sample: SampleName;
  at: number; // target frame: the sample's peak lands here (anchor 'peak') or its start does ('start')
  volume: number;
  anchor?: 'peak' | 'start';
  duration?: number;
  note: string;
};

// Keystroke onsets (seconds) of fs-645921.mp3, found at -18 dB below its peak. Typed characters
// appear on these onsets, so the picture and the sound move together.
const KEYSTROKE_ONSETS_S = [0.066, 0.143, 0.331, 0.408, 0.65, 0.756, 0.952];
const KEYSTROKE_INDEX = [0, 2, 4, 6]; // one onset per character, at a human-speed rhythm

export const typedFrames = (start: number) => KEYSTROKE_INDEX.map((i) => start + Math.round(KEYSTROKE_ONSETS_S[i] * FPS));

export const typingCue = (start: number, volume: number, note: string): Cue => ({
  sample: 'typing',
  at: start,
  anchor: 'start',
  duration: typedFrames(start)[KEYSTROKE_INDEX.length - 1] - start + 6,
  volume,
  note,
});

export const cueFrom = (cue: Cue) => {
  const sample = SAMPLES[cue.sample];
  const from =
    cue.anchor === 'start'
      ? Math.round(cue.at - OUTPUT_AUDIO_OFFSET_F)
      : Math.round(cue.at - sample.peakF - OUTPUT_AUDIO_OFFSET_F);
  if (from < 0) throw new Error(`cue "${cue.note}" starts before frame 0 (${from})`);
  return from;
};

export const SfxTrack: React.FC<{cues: Cue[]}> = ({cues}) => (
  <>
    {cues.map((cue) => (
      <Sequence key={`${cue.sample}-${cue.at}`} from={cueFrom(cue)} durationInFrames={cue.duration}>
        <Audio src={staticFile(`audio/sfx/${SAMPLES[cue.sample].file}`)} volume={cue.volume} />
      </Sequence>
    ))}
  </>
);

// Source file is mastered at -10.8 LUFS integrated; 0.11 gain brings it to about -30 LUFS,
// roughly 7 LU under the sound effects' integrated level so it never competes with the clicks.
const BGM_FILE = 'audio/bgm/house-vibez.mp3';
const BGM_VOLUME = 0.11;
const BGM_FADE_IN_F = 30;
const BGM_FADE_OUT_F = 60;

export const BgmTrack: React.FC<{durationInFrames: number}> = ({durationInFrames}) => (
  <Audio
    src={staticFile(BGM_FILE)}
    loop
    volume={(f) =>
      BGM_VOLUME *
      interpolate(
        f,
        [0, BGM_FADE_IN_F, durationInFrames - BGM_FADE_OUT_F, durationInFrames],
        [0, 1, 1, 0],
        {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
      )
    }
  />
);
