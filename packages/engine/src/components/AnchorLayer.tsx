import React from 'react';
import { useCurrentFrame } from 'remotion';
import { VisualAnchor } from './VisualAnchor';
import type { StepTiming } from '../lib/timing-schedule';

interface AnchorLayerProps {
  stepTimings: StepTiming[];
}

/**
 * AnchorLayer
 *
 * Bridges the timing schedule and VisualAnchor: given the current frame, it
 * finds which step is active and renders the pulsing highlight over the correct
 * bounding box.
 *
 * Separation of concerns:
 *   AnchorLayer  — knows about time (frame lookup, schedule)
 *   VisualAnchor — knows about drawing (pulse animation, vignette)
 *
 * When no step is active (lead-in, lead-out, or between steps) this layer
 * renders nothing — the vignette lifts and the full screen is visible.
 */
export const AnchorLayer: React.FC<AnchorLayerProps> = ({ stepTimings }) => {
  const frame = useCurrentFrame();

  const activeStep = stepTimings.find(
    (s) => frame >= s.startFrame && frame < s.startFrame + s.durationFrames,
  );

  // VisualAnchor returns null when anchor is null/undefined, so no guard needed.
  return <VisualAnchor anchor={activeStep?.anchor ?? null} />;
};
