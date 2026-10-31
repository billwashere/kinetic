import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from '@kinetic/renderer-compat';
import { WatermarkLayer } from './WatermarkLayer';
import type { LayerConfig } from '../engine/layer-config-schema';

export interface IntroProps {
  /** Page title from the locale JSON — e.g. "Creating a New Project" */
  title: string;
  /** Breadcrumb path — e.g. ["Workspace", "Projects"] */
  breadcrumbs: string[];
  textDirection: 'ltr' | 'rtl';
  layerConfig: LayerConfig;
}

// Animation timing constants (in frames)
const FADE_FRAMES = 10; // general in/out fade
const CONTENT_START = 12; // when title + breadcrumbs begin animating
const BREADCRUMB_SLIDE_FRAMES = 8;
const TITLE_DELAY = 4; // title appears slightly after breadcrumbs
const TITLE_SLIDE_FRAMES = 10;
const LINE_START = CONTENT_START + 6;
const LINE_EXPAND_FRAMES = 18;

/**
 * IntroSlide
 *
 * Branded opening segment. Plays for `intro.durationSeconds` before the main
 * content. Rendered once per locale × page and cached — re-rendered only when
 * the title, breadcrumbs, or relevant layer config values change.
 *
 * Animation sequence:
 *   0           → CONTENT_START : background fades in
 *   CONTENT_START               : breadcrumbs slide in from above
 *   CONTENT_START + TITLE_DELAY : title slides in from below
 *   LINE_START                  : accent separator line expands left→right
 *   totalFrames - FADE_FRAMES   : everything fades out
 */
export const IntroSlide: React.FC<IntroProps> = ({
  title,
  breadcrumbs,
  textDirection,
  layerConfig,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const intro = layerConfig.intro!;

  // Master opacity envelope — fades the entire slide in and out
  const masterOpacity = Math.min(
    interpolate(frame, [0, FADE_FRAMES], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    interpolate(frame, [durationInFrames - FADE_FRAMES, durationInFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  // Breadcrumbs: slide down from above and fade in
  const breadcrumbOpacity = interpolate(
    frame,
    [CONTENT_START, CONTENT_START + BREADCRUMB_SLIDE_FRAMES],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    },
  );
  const breadcrumbY = interpolate(
    frame,
    [CONTENT_START, CONTENT_START + BREADCRUMB_SLIDE_FRAMES],
    [-12, 0],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    },
  );

  // Accent line: expands from 0% to 60px width
  const lineWidth = interpolate(frame, [LINE_START, LINE_START + LINE_EXPAND_FRAMES], [0, 60], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Title: slides up from below and fades in, delayed after breadcrumbs
  const titleStart = CONTENT_START + TITLE_DELAY;
  const titleOpacity = interpolate(frame, [titleStart, titleStart + TITLE_SLIDE_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const titleY = interpolate(frame, [titleStart, titleStart + TITLE_SLIDE_FRAMES], [16, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const breadcrumbText = breadcrumbs.join(' / ');

  return (
    <AbsoluteFill style={{ backgroundColor: intro.backgroundColor, opacity: masterOpacity }}>
      {/* Centred content column */}
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 0,
          direction: textDirection,
        }}
      >
        {/* Breadcrumbs */}
        {intro.showBreadcrumbs && breadcrumbText && (
          <div
            style={{
              color: intro.accentColor,
              fontSize: 28,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              opacity: breadcrumbOpacity,
              transform: `translateY(${breadcrumbY}px)`,
              marginBottom: 20,
            }}
          >
            {breadcrumbText}
          </div>
        )}

        {/* Accent separator line */}
        <div
          style={{
            width: lineWidth,
            height: 3,
            backgroundColor: intro.accentColor,
            borderRadius: 2,
            marginBottom: 24,
          }}
        />

        {/* Page title */}
        <div
          style={{
            color: intro.textColor,
            fontSize: 72,
            fontWeight: 800,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            textAlign: 'center',
            maxWidth: '80%',
            lineHeight: 1.15,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
          }}
        >
          {title}
        </div>
      </AbsoluteFill>

      {/* Watermark — reuses the existing WatermarkLayer component */}
      {layerConfig.watermark && <WatermarkLayer watermark={layerConfig.watermark} />}
    </AbsoluteFill>
  );
};
