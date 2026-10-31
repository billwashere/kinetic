import type { AudioManifest } from './manifest-reader';
import type { DocStep } from './doc-extractor';
import type { LayerConfig } from '../engine/layer-config';
import { secondsToFrames } from './manifest-reader';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single narration step rendered as a subtitle cue */
export interface SubtitleCue {
  stepId: string;
  /** Display text — the localized string from the audio manifest */
  text: string;
  /** Frame at which this cue becomes active (inclusive) */
  startFrame: number;
  /** Number of frames this cue is active */
  durationFrames: number;
}

/** A single step's bounding box positioned in time */
export interface StepTiming {
  stepId: string;
  /** Screen coordinates of the element Playwright clicked, or null if off-screen */
  anchor: BoundingBox | null;
  startFrame: number;
  durationFrames: number;
}

/** The complete computed timing schedule for one rendered page */
export interface PageTimingSchedule {
  subtitles: SubtitleCue[];
  stepTimings: StepTiming[];
  /** Total frame count — use this as durationInFrames in renderMedia() */
  totalFrames: number;
  leadInFrames: number;
  leadOutFrames: number;
}

/**
 * The full set of props the composition receives.
 * Defined here (not in index.tsx) so assemble.ts can import the type
 * and get compile-time checking when building inputProps.
 */
export interface KineticVideoProps {
  locale: string;
  pageId: string;
  version: string;
  textDirection: 'ltr' | 'rtl';
  subtitles: SubtitleCue[];
  stepTimings: StepTiming[];
  leadInFrames: number;
  leadOutFrames: number;
  layerConfig: LayerConfig;
  /** Render only the overlay on a transparent background; assemble.ts composites it over the screen recording. */
  screenLayer?: boolean;
}

// ─── Schedule builder ─────────────────────────────────────────────────────────

/**
 * Converts the audio manifest and skeleton steps into a frame-accurate
 * timing schedule for the composition.
 *
 * Layout:
 *   [lead-in silence] [step 1] [step 2] … [step N] [lead-out silence]
 *
 * Steps are placed in skeleton order (the order they appear in the E2E test),
 * not manifest key order, so the visual sequence always matches the recorded flow.
 *
 * Steps with no manifest entry (e.g. an assertion with no TTS string) are
 * skipped — they produce no subtitle cue or anchor timing.
 *
 * @param manifest    Audio manifest for a specific locale+version
 * @param steps       Steps from the DocPage skeleton (preserves order)
 * @param locale      e.g. 'en-US'
 * @param pageId      e.g. 'create_project'
 * @param fps         Must match the composition FPS constant
 * @param leadIn      Lead-in silence in seconds
 * @param leadOut     Lead-out silence in seconds
 */
export function buildPageTimingSchedule(
  manifest: AudioManifest,
  steps: DocStep[],
  locale: string,
  pageId: string,
  fps: number,
  leadIn: number,
  leadOut: number,
): PageTimingSchedule {
  const leadInFrames = secondsToFrames(leadIn, fps);
  const leadOutFrames = secondsToFrames(leadOut, fps);

  let currentFrame = leadInFrames;
  const subtitles: SubtitleCue[] = [];
  const stepTimings: StepTiming[] = [];

  for (const step of steps) {
    // Notes are display-only callouts with no audio — excluded from the timing schedule.
    // Comments are stripped by flushDocs() and should never reach here, but guard anyway.
    if (step.type === 'note' || step.type === 'comment') continue;

    const key = `${locale}_${pageId}_${step.stepId}`;
    const entry = manifest[key];

    if (!entry) {
      // Step exists in the skeleton but has no audio (common for assertions).
      // Skip the timing entry — no cue is emitted.
      continue;
    }

    // Minimum 1 frame so zero-duration entries don't collapse
    const durationFrames = Math.max(secondsToFrames(entry.duration, fps), 1);

    subtitles.push({
      stepId: step.stepId,
      text: entry.text,
      startFrame: currentFrame,
      durationFrames,
    });

    stepTimings.push({
      stepId: step.stepId,
      anchor: isValidBox(step.anchor) ? (step.anchor as BoundingBox) : null,
      startFrame: currentFrame,
      durationFrames,
    });

    currentFrame += durationFrames;
  }

  // Minimum 1 second of total video
  const totalFrames = Math.max(currentFrame + leadOutFrames, fps);

  return { subtitles, stepTimings, totalFrames, leadInFrames, leadOutFrames };
}

function isValidBox(anchor: unknown): anchor is BoundingBox {
  if (!anchor || typeof anchor !== 'object') return false;
  const b = anchor as Record<string, unknown>;
  return (
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.width === 'number' &&
    typeof b.height === 'number'
  );
}
