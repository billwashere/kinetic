import React from 'react';
import { Audio, interpolate, useCurrentFrame } from 'remotion';
import type { MusicConfig } from '../engine/layer-config';

interface MusicLayerProps {
  music: MusicConfig;
  /** Total frame count of the composition — needed to time the fade-out */
  totalFrames: number;
  /** Frames of lead-out silence — music fade-out begins here */
  leadOutFrames: number;
}

/**
 * MusicLayer
 *
 * Plays a background audio track with smooth volume envelopes at the start and
 * end of the video. The track loops for the full duration of the composition
 * when `music.loop` is true.
 *
 * Volume envelope:
 *
 *   0 ─── fadeIn ─────────────── fadeOutStart ─── totalFrames
 *   0      volume                   volume              0
 *
 * The fade-out begins at `totalFrames - leadOutFrames - fadeOutFrames` so the
 * music reaches silence exactly when narration ends, before the lead-out silence.
 *
 * Edge case: if the video is shorter than `fadeInFrames + fadeOutFrames`, the
 * two envelopes overlap — `Math.min` naturally resolves this to a tent shape
 * that peaks in the middle.
 */
export const MusicLayer: React.FC<MusicLayerProps> = ({ music, totalFrames, leadOutFrames }) => {
  const frame = useCurrentFrame();

  // Fade-out begins this many frames before the end of narration content
  const fadeOutStart = Math.max(
    music.fadeInFrames,
    totalFrames - leadOutFrames - music.fadeOutFrames,
  );

  const volume = Math.min(
    // Fade in: silence → target volume over the first `fadeInFrames` frames
    interpolate(frame, [0, music.fadeInFrames], [0, music.volume], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    // Fade out: target volume → silence over the last `fadeOutFrames` frames
    interpolate(frame, [fadeOutStart, fadeOutStart + music.fadeOutFrames], [music.volume, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  return <Audio src={music.src} volume={volume} loop={music.loop} />;
};
