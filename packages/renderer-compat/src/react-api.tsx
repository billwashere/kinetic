/**
 * react-api.tsx  —  @kinetic/renderer-compat
 *
 * MIT-licensed drop-in replacement for the `remotion` npm package.
 *
 * Exports the React surface used by the engine:
 *   AbsoluteFill, Composition, Audio, Img, Video,
 *   useCurrentFrame, useVideoConfig, interpolate, registerRoot
 *
 * Architecture
 * ────────────
 * Bundler (bundler.ts) compiles the entry point with esbuild and aliases
 * `import 'remotion'` → this file. At render time, Playwright loads the bundle
 * exactly once per page and updates the rendered frame via:
 *
 *     window.__renderFrame(compositionId, frameNumber, propsJson)
 *
 * That host-side call updates a piece of React state, triggering a re-render
 * for the new frame. After the browser has fully painted, this module sets
 * `window.__frameReady = true`, which is what the renderer waits on before
 * taking a screenshot.
 *
 * This is dramatically faster than navigating the page to a new URL per frame.
 */

import React, { useEffect, useLayoutEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { FrameProvider, useCurrentFrame, useVideoConfig } from './frame-context';
import {
  registerComposition,
  findComposition,
  getRegistry,
  type CompositionConfig,
} from './composition-registry';
import { findCompositions } from './jsx-traversal';
import { interpolate, type InterpolateOptions } from './interpolate';

// ─── AbsoluteFill ─────────────────────────────────────────────────────────────

export interface AbsoluteFillProps {
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export const AbsoluteFill: React.FC<AbsoluteFillProps> = ({ style, children }) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '100%',
      display: 'flex',
      ...style,
    }}
  >
    {children}
  </div>
);

// ─── Composition ──────────────────────────────────────────────────────────────

export type CompositionProps<P extends object> = {
  id: string;
  component: React.ComponentType<P>;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  defaultProps?: P;
};

/** Marker component — does nothing at render time; props are extracted by registerRoot. */
export function Composition<P extends object>(_props: CompositionProps<P>): null {
  return null;
}

// ─── Audio / Video / Img ─────────────────────────────────────────────────────

export interface AudioProps {
  src: string;
  volume?: number | ((frame: number) => number);
  loop?: boolean;
  startFrom?: number;
  endAt?: number;
}

/**
 * No-op during headless rendering. Headless Chrome cannot capture audio output
 * to a file. Background audio is mixed by ffmpeg post-encode (see
 * stitch-and-mix.ts in the engine package).
 */
export const Audio: React.FC<AudioProps> = () => null;

/** No-op placeholder. Source video is composited by ffmpeg, not React. */
export const Video: React.FC<React.VideoHTMLAttributes<HTMLVideoElement>> = () => null;

// eslint-disable-next-line jsx-a11y/alt-text
export const Img: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = (props) => <img {...props} />;

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { useCurrentFrame, useVideoConfig, interpolate };
export type { InterpolateOptions };

// ─── Window globals (typed) ──────────────────────────────────────────────────

interface RendererGlobals {
  /** Set after compositions have been extracted (used by selectComposition's list mode). */
  __compositionsReady?: boolean;
  /** Serialisable composition metadata for the host. */
  __compositions?: Array<Omit<CompositionConfig, 'component'>>;
  /** Set after the page is ready to receive renderFrame calls. */
  __rendererReady?: boolean;
  /** Set after each frame's render commits AND a paint cycle completes. */
  __frameReady?: boolean;
  /** Host-callable: triggers a state update to render a specific frame. */
  __renderFrame?: (compositionId: string, frame: number, propsJson: string) => void;
  /** Host-callable: surfaces any uncaught render errors back to Playwright. */
  __lastRenderError?: string;
}

type RendererWindow = Window & RendererGlobals;

declare const window: RendererWindow;

// ─── registerRoot ─────────────────────────────────────────────────────────────

/**
 * Entry point for the user's composition bundle.
 *
 * Behaviour depends on the URL `mode` query parameter:
 *   ?mode=list   → expose composition metadata and stop (used by selectComposition)
 *   ?mode=render → mount the renderer app, ready to receive __renderFrame calls
 *
 * Compositions are extracted from the JSX tree once, before either mode runs.
 */
export function registerRoot(factory: () => React.ReactElement): void {
  // Step 1: extract compositions from the JSX tree (no React render needed).
  try {
    const tree = factory();
    findCompositions(tree, Composition as React.ComponentType<unknown>, registerComposition);
  } catch (err) {
    if (typeof window !== 'undefined') {
      window.__lastRenderError = `Failed to evaluate root factory: ${(err as Error).message}`;
    }
    throw err;
  }

  // Step 2: bail out for non-browser execution (e.g. ts-node type-only imports).
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') ?? 'render';

  if (mode === 'list') {
    // Expose the registry for selectComposition() and stop here.
    window.__compositions = getRegistry().map(({ component: _c, ...rest }) => rest);
    window.__compositionsReady = true;
    return;
  }

  // mode === 'render' — mount the long-lived renderer app.
  const container = document.getElementById('root');
  if (!container) {
    console.error('[renderer-compat] No #root element found in the runner HTML.');
    return;
  }

  const root = ReactDOM.createRoot(container);
  root.render(<RendererApp />);
}

// ─── RendererApp ──────────────────────────────────────────────────────────────

interface RenderState {
  compositionId: string;
  frame: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputProps: Record<string, any>;
  /** Monotonic counter — bumped per call to ensure useEffect re-fires even if values match. */
  tick: number;
}

/**
 * Long-lived component that lives in the page across all frame renders.
 *
 * Exposes window.__renderFrame for the host (renderer.ts) to push new frame
 * requests in. Updates state on each call, which triggers a React re-render.
 * Sets window.__frameReady once the new frame has both committed and painted.
 */
const RendererApp: React.FC = () => {
  const [state, setState] = useState<RenderState | null>(null);

  // Bind the host bridge once on mount, after fonts are ready.
  useEffect(() => {
    window.__renderFrame = (compositionId, frame, propsJson) => {
      // Reset readiness on every new request — host must observe the false→true transition.
      window.__frameReady = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let props: Record<string, any> = {};
      if (propsJson) {
        try {
          props = JSON.parse(propsJson);
        } catch (e) {
          window.__lastRenderError = `Invalid inputProps JSON: ${(e as Error).message}`;
        }
      }
      setState((prev) => ({
        compositionId,
        frame,
        inputProps: props,
        tick: (prev?.tick ?? 0) + 1,
      }));
    };

    // Wait for any web fonts to load before signalling ready, so frame 0 isn't
    // painted with a fallback typeface.
    const ready = () => {
      window.__rendererReady = true;
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(ready, ready);
    } else {
      ready();
    }
  }, []);

  // After every commit, wait for two animation frames (== one full paint cycle)
  // before signalling __frameReady. This avoids screenshotting a stale frame
  // when the React commit happens but the browser hasn't painted yet.
  useLayoutEffect(() => {
    if (!state) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.__frameReady = true;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [state]);

  if (!state) return null;

  const comp = findComposition(state.compositionId);
  if (!comp) {
    window.__lastRenderError = `Composition "${state.compositionId}" not registered`;
    return null;
  }

  const mergedProps = { ...comp.defaultProps, ...state.inputProps };
  const Component = comp.component;

  return (
    <FrameProvider
      frame={state.frame}
      videoConfig={{
        fps: comp.fps,
        width: comp.width,
        height: comp.height,
        durationInFrames: comp.durationInFrames,
      }}
    >
      <Component {...(mergedProps as object)} />
    </FrameProvider>
  );
};
