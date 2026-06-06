/**
 * ffmpeg.ts
 *
 * Small wrapper around the system `ffmpeg` binary.  Centralised so renderer.ts
 * stays focused on browser orchestration.
 *
 * Intentionally uses the system ffmpeg on PATH (no @remotion/bundled-ffmpeg
 * dependency).  Install via:
 *   apt-get install ffmpeg     # Debian / Ubuntu
 *   brew install ffmpeg        # macOS
 *   choco install ffmpeg       # Windows
 */

import path from 'path';
import { execa } from 'execa';

export type RenderCodec = 'h264' | 'h265' | 'vp9' | 'vp8';

const CODEC_LIB: Record<RenderCodec, string> = {
  h264: 'libx264',
  h265: 'libx265',
  vp9: 'libvpx-vp9',
  vp8: 'libvpx',
};

let healthCheckPassed = false;

/**
 * Verify ffmpeg is on PATH and abort early with a helpful message if not.
 * Cached across calls within a process — only the first call actually runs ffmpeg.
 */
export async function ensureFfmpeg(): Promise<void> {
  if (healthCheckPassed) return;
  try {
    await execa('ffmpeg', ['-version']);
    healthCheckPassed = true;
  } catch (err) {
    throw new Error(
      'ffmpeg not found on PATH.\n' +
        '  Install:  apt install ffmpeg  |  brew install ffmpeg  |  choco install ffmpeg\n' +
        `  Underlying error: ${(err as Error).message}`,
    );
  }
}

export interface EncodeOptions {
  framesDir: string;
  /** sprintf-style filename pattern within framesDir, e.g. 'frame_%06d.png'. */
  framePattern: string;
  outputLocation: string;
  fps: number;
  codec: RenderCodec;
  /** Constant Rate Factor — lower = better quality. */
  crf: number;
  /** Encoding speed preset (h264/h265 only). */
  x264Preset?: string;
}

/**
 * Encodes the PNG frame sequence into the output video file.
 * Throws with the ffmpeg stderr appended if encoding fails.
 */
export async function encodeFramesToVideo(opts: EncodeOptions): Promise<void> {
  await ensureFfmpeg();

  const vcodec = CODEC_LIB[opts.codec] ?? 'libx264';
  const args: string[] = [
    '-framerate',
    String(opts.fps),
    '-i',
    path.join(opts.framesDir, opts.framePattern),
  ];

  if (opts.codec === 'h264' || opts.codec === 'h265') {
    args.push(
      '-c:v', vcodec,
      '-crf', String(opts.crf),
      '-preset', opts.x264Preset ?? 'medium',
      '-pix_fmt', 'yuv420p',           // broad player compatibility
      '-movflags', '+faststart',       // enables progressive download / streaming
    );
  } else {
    // VP8 / VP9 — CQ (constant quality) mode
    args.push('-c:v', vcodec, '-crf', String(opts.crf), '-b:v', '0', '-pix_fmt', 'yuv420p');
  }

  args.push('-y', path.resolve(opts.outputLocation));

  try {
    await execa('ffmpeg', args, { stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    const tail = e.stderr ? e.stderr.split('\n').slice(-12).join('\n') : '';
    throw new Error(`ffmpeg encode failed: ${e.message}\n--- ffmpeg stderr (tail) ---\n${tail}`);
  }
}
