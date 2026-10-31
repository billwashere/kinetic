import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from '@kinetic/renderer-compat';
import type { LayerConfig } from '../engine/layer-config-schema';

export interface OutroProps {
  textDirection: 'ltr' | 'rtl';
  layerConfig: LayerConfig;
}

const FADE_IN_FRAMES = 10;
const FADE_OUT_FRAMES = 15;
const CTA_DELAY = 18; // frames after fade-in before CTA appears

/**
 * OutroSlide
 *
 * Branded closing segment. Shared across all pages within a locale — rendered
 * once and cached. Re-rendered only when the outro config or watermark changes.
 *
 * Shows:
 *   - Brand background
 *   - Centered watermark logo (if configured) — larger than the corner placement
 *   - Optional CTA text below the logo (e.g. "docs.mycompany.com")
 *   - Fade to black at the end
 */
export const OutroSlide: React.FC<OutroProps> = ({ textDirection, layerConfig }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const outro = layerConfig.outro!;

  const masterOpacity = Math.min(
    interpolate(frame, [0, FADE_IN_FRAMES], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    // Fade to black at the very end — gives a clean chapter close feeling
    interpolate(frame, [durationInFrames - FADE_OUT_FRAMES, durationInFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  const ctaOpacity = interpolate(
    frame,
    [FADE_IN_FRAMES + CTA_DELAY, FADE_IN_FRAMES + CTA_DELAY + 10],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: outro.backgroundColor,
        opacity: masterOpacity,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        direction: textDirection,
      }}
    >
      {/* Logo — centered, larger than the corner watermark placement */}
      {layerConfig.watermark && (
        <Img
          src={layerConfig.watermark.src}
          style={{
            width: Math.min(layerConfig.watermark.widthPx * 1.5, 360),
            height: 'auto',
            opacity: layerConfig.watermark.opacity,
            marginBottom: outro.ctaText ? 32 : 0,
          }}
        />
      )}

      {/* CTA line */}
      {outro.ctaText && (
        <div
          style={{
            color: outro.textColor,
            fontSize: 36,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            opacity: ctaOpacity * 0.75, // slightly muted relative to a full logo
            letterSpacing: '0.02em',
          }}
        >
          {outro.ctaText}
        </div>
      )}
    </AbsoluteFill>
  );
};
