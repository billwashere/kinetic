import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from '@kinetic/renderer-compat';
import type { SubtitleCue } from '../lib/timing-schedule';
import type { SubtitleStyle } from '../engine/layer-config';
import { DEFAULT_SUBTITLE_STYLE } from '../engine/layer-config';

interface SubtitleLayerProps {
  subtitles: SubtitleCue[];
  style?: SubtitleStyle;
  /** Text direction — drives text-align and RTL layout for Arabic, Hebrew, etc. */
  dir?: 'ltr' | 'rtl';
}

/**
 * SubtitleLayer
 *
 * Displays one subtitle cue at a time, driven by the timing schedule computed
 * from the audio manifest. Cues cross-fade in and out at step boundaries so
 * the subtitle text never cuts abruptly.
 *
 * When no cue is active (lead-in, lead-out, or between steps) the layer is
 * invisible — no empty pill is shown.
 */
export const SubtitleLayer: React.FC<SubtitleLayerProps> = ({
  subtitles,
  style = DEFAULT_SUBTITLE_STYLE,
  dir = 'ltr',
}) => {
  const frame = useCurrentFrame();

  const activeCue = subtitles.find(
    (c) => frame >= c.startFrame && frame < c.startFrame + c.durationFrames,
  );

  if (!activeCue) return null;

  const frameInCue = frame - activeCue.startFrame;
  const framesFromEnd = activeCue.durationFrames - frameInCue;
  const fade = style.fadeFrames;

  // Fade opacity in at the start and out at the end of each cue.
  // Math.min of the two curves gives a smooth tent function:
  //   0 → 1 over the first `fade` frames, 1 → 0 over the last `fade` frames.
  const opacity = Math.min(
    interpolate(frameInCue, [0, fade], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    interpolate(framesFromEnd, [0, fade], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  const verticalAnchor = style.position === 'bottom' ? { bottom: 50 } : { top: 50 };

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          ...verticalAnchor,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          direction: dir,
        }}
      >
        <div
          style={{
            backgroundColor: style.backgroundColor,
            color: style.textColor,
            padding: `${style.paddingY}px ${style.paddingX}px`,
            borderRadius: style.borderRadius,
            fontSize: style.fontSize,
            maxWidth: `${style.maxWidthPct}%`,
            textAlign: 'center',
            lineHeight: 1.4,
            opacity,
          }}
        >
          {activeCue.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
