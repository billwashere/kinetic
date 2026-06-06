/**
 * frame-context.tsx
 *
 * React context that carries the current frame number and video configuration
 * down the component tree. Components call useCurrentFrame() / useVideoConfig()
 * exactly like they do with Remotion — the API surface is identical.
 */

import React, { createContext, useContext } from 'react';

export interface VideoConfig {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
}

const FrameContext = createContext<number>(0);
const VideoConfigContext = createContext<VideoConfig>({
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 30,
});

export interface FrameProviderProps {
  frame: number;
  videoConfig: VideoConfig;
  children: React.ReactNode;
}

export function FrameProvider({ frame, videoConfig, children }: FrameProviderProps) {
  return (
    <VideoConfigContext.Provider value={videoConfig}>
      <FrameContext.Provider value={frame}>{children}</FrameContext.Provider>
    </VideoConfigContext.Provider>
  );
}

/** Returns the frame number currently being rendered (0-based). */
export function useCurrentFrame(): number {
  return useContext(FrameContext);
}

/** Returns fps, width, height, durationInFrames for the active composition. */
export function useVideoConfig(): VideoConfig {
  return useContext(VideoConfigContext);
}
