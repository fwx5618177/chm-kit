import React from 'react';
import {Composition} from 'remotion';
import {Promo, PROMO_FRAMES} from './Promo';
import {Tutorial, TUTORIAL_FRAMES} from './Tutorial';
import {FPS, HEIGHT, WIDTH} from './tokens';

// `bgm` is overridden per render with --props (see props/nobgm.json) to produce the no-BGM variants.
export const Root: React.FC = () => (
  <>
    <Composition
      id="Tutorial"
      component={Tutorial}
      durationInFrames={TUTORIAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{bgm: true}}
    />
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={PROMO_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{bgm: true}}
    />
  </>
);
