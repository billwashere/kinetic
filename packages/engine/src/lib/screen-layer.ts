import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import type { PageTimingSchedule } from './timing-schedule';
import type { RecordingTimings } from './doc-extractor';

/**
 * The screen-recording layer. The React composition only draws the overlay (subtitles, anchors,
 * watermark) on a transparent background; FFmpeg puts it over the Playwright recording here.
 *
 * The recording is real time (remote pages can take 20 s to render) while narration sets the pace of
 * the video, so each narrated step shows a window of the recording that starts shortly before the
 * step happened, runs for the step's narration slot, and holds its last frame if the recording ends
 * first. Waiting between steps is simply never shown.
 */

export interface ScreenSegment {
  /** Where in the recording this segment starts, in seconds. */
  srcStart: number;
  /** How long it plays in the final video, in seconds. */
  duration: number;
  /** Hold the single frame at srcStart instead of playing. */
  freeze: boolean;
}

/** Seconds of the recording shown before an action's click, so the viewer sees what is being clicked. */
export const ACTION_LEAD_SECONDS = 1.2;
/** Seconds shown before an assertion held, so the result is on screen for its narration. */
export const ASSERTION_LEAD_SECONDS = 0.3;

/**
 * The recording's clock starts at its first painted frame, not at page creation, so step times are
 * shifted by the offset between the two clocks (negative when the video clock runs ahead).
 */
export function videoClockOffset(
  t: Pick<RecordingTimings, 'endMs' | 'videoSeconds' | 'syncMs' | 'videoSyncSeconds'>,
): number {
  // Exact: the sync marker was flashed at syncMs and found at videoSyncSeconds in the recording.
  if (t.syncMs !== undefined && t.videoSyncSeconds !== undefined) return t.syncMs / 1000 - t.videoSyncSeconds;
  // Fallback: both clocks end when the page closes. Only ever moves the cut later in the recording.
  if (t.endMs === undefined || t.videoSeconds === undefined) return 0;
  return Math.max(0, t.endMs / 1000 - t.videoSeconds);
}

export function planScreenSegments(
  schedule: PageTimingSchedule,
  stepMs: RecordingTimings['stepMs'],
  actionStepIds: ReadonlySet<string>,
  fps: number,
  /** Seconds the video clock lags the step clock (see videoClockOffset). */
  offsetSec = 0,
  /** Length of the recording; segments never start past its last frame. */
  videoSeconds = Infinity,
): ScreenSegment[] {
  const timed = schedule.stepTimings.filter((s) => stepMs[s.stepId] !== undefined);
  if (timed.length === 0) return [];

  const segs: ScreenSegment[] = [];
  const startOf = (stepId: string) => {
    const lead = actionStepIds.has(stepId) ? ACTION_LEAD_SECONDS : ASSERTION_LEAD_SECONDS;
    return Math.min(Math.max(0, stepMs[stepId] / 1000 - offsetSec - lead), Math.max(0, videoSeconds - 0.2));
  };

  // Frames not covered by a step (lead-in, steps with no recorded time) show the nearest timed step's frame.
  let cursor = 0; // frames laid down so far
  let lastSrc = startOf(timed[0].stepId);
  for (const t of schedule.stepTimings) {
    const gap = t.startFrame - cursor;
    if (gap > 0) {
      segs.push({ srcStart: lastSrc, duration: gap / fps, freeze: true });
      cursor += gap;
    }
    if (stepMs[t.stepId] !== undefined) lastSrc = startOf(t.stepId);
    segs.push({ srcStart: lastSrc, duration: t.durationFrames / fps, freeze: stepMs[t.stepId] === undefined });
    cursor += t.durationFrames;
  }
  const tail = schedule.totalFrames - cursor;
  if (tail > 0) segs.push({ srcStart: lastSrc, duration: tail / fps, freeze: true });
  return segs;
}

/** The ffmpeg filter graph that cuts, pads and joins the segments, then overlays the transparent layer. */
export function buildScreenFilter(
  segments: ScreenSegment[],
  fps: number,
  width: number,
  height: number,
  crop?: { width: number; height: number } | null,
): string {
  // Playwright records the viewport in the corner of a larger canvas; keep only the viewport.
  const cropFilter = crop ? `crop=${crop.width}:${crop.height}:0:0,` : '';
  const parts = segments.map((s, i) => {
    const end = s.freeze ? s.srcStart + 1 / fps : s.srcStart + s.duration;
    return (
      `[0:v]trim=start=${s.srcStart.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,${cropFilter}` +
      `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0f172a,setsar=1,` +
      `tpad=stop_mode=clone:stop_duration=${s.duration.toFixed(3)},trim=duration=${s.duration.toFixed(3)},` +
      `setpts=PTS-STARTPTS[s${i}]`
    );
  });
  const concat = `${segments.map((_, i) => `[s${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[screen]`;
  const overlay = `[screen][1:v]overlay=format=auto:shortest=1,format=yuv420p[out]`;
  return [...parts, concat, overlay].join(';');
}

export interface ComposeScreenOptions {
  source: string;
  overlay: string;
  outputFile: string;
  segments: ScreenSegment[];
  fps: number;
  width: number;
  height: number;
  /** The recorded viewport, cropped out of the video canvas before scaling. */
  crop?: { width: number; height: number } | null;
  crf: number;
  x264Preset: string;
}

export async function composeScreenLayer(o: ComposeScreenOptions): Promise<void> {
  const script = `${o.outputFile}.filter.txt`;
  await fs.writeFile(script, buildScreenFilter(o.segments, o.fps, o.width, o.height, o.crop), 'utf8');
  try {
    await execa(
      'ffmpeg',
      [
        '-y', '-i', path.resolve(o.source),
        '-c:v', 'libvpx-vp9', '-i', path.resolve(o.overlay),
        '-filter_complex_script', script,
        '-map', '[out]',
        '-c:v', 'libx264', '-crf', String(o.crf), '-preset', o.x264Preset,
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(o.fps),
        path.resolve(o.outputFile),
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`screen layer compose failed: ${e.message}\n${(e.stderr ?? '').split('\n').slice(-12).join('\n')}`);
  } finally {
    await fs.remove(script).catch(() => {});
  }
}
