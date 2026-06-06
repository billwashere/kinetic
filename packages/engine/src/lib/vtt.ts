import type { SubtitleCue } from './timing-schedule';

/**
 * Converts a frame count to a WebVTT timestamp string.
 * Format: HH:MM:SS.mmm  (e.g. 00:00:01.033)
 */
export function framesToVTTTimestamp(frames: number, fps: number): string {
  const totalMs = Math.round((frames / fps) * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hours = Math.floor(totalMin / 60);
  return `${pad2(hours)}:${pad2(min)}:${pad2(sec)}.` + ms.toString().padStart(3, '0');
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Generates a WebVTT subtitle file from an array of SubtitleCues.
 *
 * The generated file can be linked to a video via a <track> element:
 *   <track kind="subtitles" src="/video-cache/v1.0/en-US_create_project.vtt"
 *          srclang="en" default />
 *
 * When intro/outro is configured, pass introOffset = introFrames so that
 * timestamps align with the full stitched video rather than the content segment.
 *
 * @param cues        Subtitle cues from buildPageTimingSchedule()
 * @param fps         Must match the Remotion composition FPS constant
 * @param introOffset Frames to add to every timestamp (default: 0)
 */
export function generateWebVTT(cues: SubtitleCue[], fps: number, introOffset = 0): string {
  if (cues.length === 0) return 'WEBVTT\n';

  const lines: string[] = ['WEBVTT', ''];

  for (const cue of cues) {
    const start = framesToVTTTimestamp(cue.startFrame + introOffset, fps);
    const end = framesToVTTTimestamp(cue.startFrame + cue.durationFrames + introOffset, fps);
    lines.push(`${start} --> ${end}`);
    // Strip any residual Markdown from the subtitle text
    lines.push(cue.text.replace(/[*_~`]/g, ''));
    lines.push('');
  }

  return lines.join('\n');
}
