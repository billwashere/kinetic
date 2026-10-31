import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';

/**
 * Narration track. The TTS clips are generated per step (pre-render-audio.ts) and the schedule places
 * each step's subtitle at a frame; this lays the clips at those frames on the finished video.
 */

export interface NarrationCue {
  /** Absolute path of the narration clip. */
  file: string;
  /** Seconds from the start of the final video. */
  startSeconds: number;
}

/** ffmpeg filter graph that delays each clip (input 1..n) to its start and mixes them to `[a]`. */
export function buildNarrationFilter(cues: NarrationCue[], keepExistingAudio: boolean): string {
  const delayed = cues.map((c, i) => {
    const ms = Math.round(c.startSeconds * 1000);
    return `[${i + 1}:a]adelay=${ms}:all=1[n${i}]`;
  });
  const inputs = [...(keepExistingAudio ? ['[0:a]'] : []), ...cues.map((_, i) => `[n${i}]`)];
  // normalize=0 keeps each clip at its own level; clips do not overlap, music (if any) keeps its volume.
  const mix = `${inputs.join('')}amix=inputs=${inputs.length}:normalize=0:duration=longest,apad[a]`;
  return [...delayed, mix].join(';');
}

async function hasAudio(file: string): Promise<boolean> {
  const { stdout } = await execa('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return stdout.trim().length > 0;
}

/** Adds the narration to `videoFile` in place (video stream copied). A no-op when there are no cues. */
export async function mixNarration(videoFile: string, cues: NarrationCue[], totalSeconds: number): Promise<void> {
  const present = [];
  for (const c of cues) if (await fs.pathExists(c.file)) present.push(c);
  if (present.length === 0) return;

  const out = `${videoFile}.__narrated.mp4`;
  const filter = buildNarrationFilter(present, await hasAudio(videoFile));
  const args = ['-y', '-i', path.resolve(videoFile), ...present.flatMap((c) => ['-i', path.resolve(c.file)])];
  args.push(
    '-filter_complex', filter, '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-t', totalSeconds.toFixed(3), '-movflags', '+faststart', out,
  );
  try {
    await execa('ffmpeg', args, { stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`narration mix failed: ${e.message}\n${(e.stderr ?? '').split('\n').slice(-10).join('\n')}`);
  }
  await fs.move(out, videoFile, { overwrite: true });
}
