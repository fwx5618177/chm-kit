#!/usr/bin/env python3
"""Measure the output audio-track latency of a rendered MP4 against the SFX cues in src/sfx.tsx.

For each probe we know where the cue was placed (from = at - peakF - OFFSET) and which
sample it used. Cross-correlating the decoded sample with the rendered track gives the real
start of that sample; the difference to `from` is the latency the output pipeline adds.
Re-run after any change to Remotion version, audio codec, sample rate or container.

Usage: python3 scripts/measure-audio-offset.py out/chmkit-tutorial.mp4
"""

import subprocess
import sys
from pathlib import Path

import numpy as np

FPS = 30
SR = 48000
ROOT = Path(__file__).resolve().parent.parent

# (label, sample file, sample peak frame, cue target frame) -- must match src/sfx.tsx cue entries.
PROBES = {
    "tutorial": [
        ("click 加载演示文档", "fs-687105.mp3", 6, 230),
        ("clickSoft docs/boundaries.html", "fs-567265.mp3", 3, 345),
    ],
    "promo": [
        ("click 功能标签 1", "fs-687105.mp3", 6, 850),
    ],
}


def decode(path, extra=()):
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), *extra, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def measure(track, sample, sample_peak_f, target_f, offset_f):
    from_f = round(target_f - sample_peak_f - offset_f)
    expected_start = from_f / FPS
    search_start = max(0.0, expected_start - 0.15)
    window = track[int(search_start * SR) : int((expected_start + 0.35) * SR)]
    template = sample[: int(0.30 * SR)]
    template = template / (np.linalg.norm(template) + 1e-12)
    corr = np.correlate(window, template, mode="valid")
    lag = int(np.argmax(np.abs(corr)))
    start = search_start + lag / SR
    latency_f = (start - expected_start) * FPS
    return from_f, latency_f


def main():
    video = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "out/chmkit-tutorial.mp4"
    track_key = "tutorial" if "tutorial" in video.name else "promo"
    track = decode(video, ["-vn"])
    print(f"video: {video.name}  audio samples: {len(track)}  duration: {len(track) / SR:.3f}s")
    results = []
    for label, file, peak_f, target in PROBES[track_key]:
        sample = decode(ROOT / "public/audio/sfx" / file)
        from_f, latency_f = measure(track, sample, peak_f, target, offset_f=1.28)
        results.append(latency_f)
        print(f"  {label:<34} from={from_f:>4}f  measured latency={latency_f:+.2f}f")
    mean = float(np.mean(results))
    print(f"mean latency = {mean:+.2f} frames -> set OUTPUT_AUDIO_OFFSET_F to about {mean:.2f} in src/sfx.tsx")
    print("latency is measured against `from`, which already subtracts the offset; re-render to confirm the residual.")


if __name__ == "__main__":
    main()
