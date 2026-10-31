import React from 'react';
import { registerRoot, Composition, AbsoluteFill, useVideoConfig } from '@kinetic/renderer-compat';
import { AnchorLayer } from './components/AnchorLayer';
import { SubtitleLayer } from './components/SubtitleLayer';
import { MusicLayer } from './components/MusicLayer';
import { WatermarkLayer } from './components/WatermarkLayer';
import { IntroSlide } from './components/IntroSlide';
import { OutroSlide } from './components/OutroSlide';
import { FPS, WIDTH, HEIGHT } from './engine/render-config';
import { DEFAULT_SUBTITLE_STYLE } from './engine/layer-config';
import type { KineticVideoProps } from './lib/timing-schedule';
import type { IntroProps } from './components/IntroSlide';
import type { OutroProps } from './components/OutroSlide';

/**
 * KineticVideo — the root KineticDocs composition.
 *
 * Renders in layers from back to front:
 *   1. Screen recording (the Playwright-captured webm — injected at render time)
 *   2. Music          (background audio with fade envelopes)
 *   3. AnchorLayer    (pulsing bounding-box highlight over the active element)
 *   4. SubtitleLayer  (narration text, frame-accurate from the audio manifest)
 *   5. WatermarkLayer (logo pinned to a corner)
 *
 * All timing data arrives via inputProps, computed by assemble.ts from the
 * audio manifest. The composition itself contains no I/O — it is a pure
 * function of props and the current frame number.
 */
export const KineticVideo: React.FC<KineticVideoProps> = ({
  textDirection,
  subtitles,
  stepTimings,
  leadInFrames,
  leadOutFrames,
  layerConfig,
  screenLayer,
}) => {
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: screenLayer ? 'transparent' : '#0f172a' }}>
      {/* ── Layer 1: Screen recording placeholder ─────────────────────────────
          The recording itself is not drawn here: with `screenLayer` set, this composition is rendered
          transparent and assemble.ts overlays it on the Playwright webm with FFmpeg (screen-layer.ts). */}
      {!screenLayer && (
        <AbsoluteFill
          style={{ backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' }}
        >
          <p style={{ color: '#475569', fontSize: 28, fontFamily: 'monospace' }}>
            [ Screen recording layer ]
          </p>
        </AbsoluteFill>
      )}

      {/* ── Layer 2: Background music ─────────────────────────────────────────
          When intro/outro is configured, music is added post-stitch as a single
          unified FFmpeg audio track (see stitch-and-mix.ts). Rendering it here
          too would cause audio-boundary jarring at every segment cut.            */}
      {layerConfig.music && !layerConfig.intro && (
        <MusicLayer
          music={layerConfig.music}
          totalFrames={durationInFrames}
          leadOutFrames={leadOutFrames}
        />
      )}

      {/* ── Layer 3: Visual anchor highlight ─────────────────────────────── */}
      <AnchorLayer stepTimings={stepTimings} />

      {/* ── Layer 4: Subtitles ────────────────────────────────────────────── */}
      <SubtitleLayer subtitles={subtitles} style={layerConfig.subtitleStyle} dir={textDirection} />

      {/* ── Layer 5: Watermark ────────────────────────────────────────────── */}
      {layerConfig.watermark && <WatermarkLayer watermark={layerConfig.watermark} />}
    </AbsoluteFill>
  );
};

// Default props shown in preview — overridden at render time by assemble.ts.
// assemble.ts overrides every field with real per-page values at render time.
const defaultProps: KineticVideoProps = {
  locale: 'en-US',
  pageId: 'create_project',
  version: 'v1.0',
  textDirection: 'ltr',
  subtitles: [
    {
      stepId: 'preview',
      text: 'Preview subtitle — driven by audio manifest at render time',
      startFrame: FPS,
      durationFrames: FPS * 3,
    },
  ],
  stepTimings: [
    {
      stepId: 'preview',
      anchor: { x: 760, y: 460, width: 400, height: 80 },
      startFrame: FPS,
      durationFrames: FPS * 3,
    },
  ],
  leadInFrames: FPS,
  leadOutFrames: FPS * 2,
  layerConfig: {
    subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  },
};

const defaultIntroProps: IntroProps = {
  title: 'Creating a New Project',
  breadcrumbs: ['Workspace', 'Projects'],
  textDirection: 'ltr',
  layerConfig: {
    subtitleStyle: DEFAULT_SUBTITLE_STYLE,
    intro: {
      durationSeconds: 4,
      backgroundColor: '#0f172a',
      accentColor: '#3b82f6',
      textColor: '#ffffff',
      showBreadcrumbs: true,
    },
  },
};

const defaultOutroProps: OutroProps = {
  textDirection: 'ltr',
  layerConfig: {
    subtitleStyle: DEFAULT_SUBTITLE_STYLE,
    outro: {
      durationSeconds: 3,
      backgroundColor: '#0f172a',
      textColor: '#ffffff',
      ctaText: 'docs.mycompany.com',
    },
  },
};

registerRoot(() => (
  <>
    <Composition
      id="KineticDocs"
      component={KineticVideo}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 5}
      defaultProps={defaultProps}
    />
    <Composition
      id="KineticIntro"
      component={IntroSlide}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      // Studio preview default — overridden at render time by intro.durationSeconds
      durationInFrames={FPS * 4}
      defaultProps={defaultIntroProps}
    />
    <Composition
      id="KineticOutro"
      component={OutroSlide}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      // Studio preview default — overridden at render time by outro.durationSeconds
      durationInFrames={FPS * 3}
      defaultProps={defaultOutroProps}
    />
  </>
));
