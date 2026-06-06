import crypto from 'crypto';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { VideoStitcher } from './stitcher';
import type { MusicConfig, LayerConfig } from '../engine/layer-config';

// ─── Public path resolution ───────────────────────────────────────────────────

/**
 * Converts a public-relative asset path (e.g. "/assets/bg.mp3") to an
 * absolute filesystem path that FFmpeg can read.
 *
 * Public-relative paths start with "/" and are served from the Remotion bundle's
 * public directory at runtime. On disk they live under `packages/engine/public/`.
 */
export function resolvePublicPath(src: string, publicDir: string): string {
  const relative = src.startsWith('/') ? src.slice(1) : src;
  return path.join(publicDir, relative);
}

// ─── Music filter ─────────────────────────────────────────────────────────────

/**
 * Builds the FFmpeg `-filter_complex` string for adding a background music track
 * with fade-in and fade-out envelopes to a stitched video.
 *
 * The filter:
 *   1. Sets the target volume
 *   2. Fades in from silence over `fadeInSeconds`
 *   3. Fades out to silence starting at `fadeOutStartSeconds`
 *
 * Output stream is labelled `[a]` for use with `-map [a]`.
 */
export function buildMusicFilterComplex(
  volume: number,
  fadeInSeconds: number,
  fadeOutStartSeconds: number,
  fadeOutSeconds: number,
): string {
  return (
    `[1:a]volume=${volume.toFixed(3)},` +
    `afade=t=in:d=${fadeInSeconds.toFixed(3)},` +
    `afade=t=out:st=${fadeOutStartSeconds.toFixed(3)}:d=${fadeOutSeconds.toFixed(3)}` +
    `[a]`
  );
}

// ─── Cache hashing ────────────────────────────────────────────────────────────

/**
 * Computes a short hash of the inputs that determine what an intro slide looks
 * like. If the hash matches the stored hash, the cached render is reused.
 */
export function computeIntroHash(
  locale: string,
  pageId: string,
  title: string,
  breadcrumbs: string[],
  layerConfig: Pick<LayerConfig, 'intro' | 'watermark'>,
): string {
  const inputs = {
    locale,
    pageId,
    title,
    breadcrumbs,
    intro: layerConfig.intro,
    watermark: layerConfig.watermark,
  };
  return crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 16);
}

/**
 * Computes a short hash of the inputs that determine what an outro slide looks
 * like. The outro is shared across all pages in a locale.
 */
export function computeOutroHash(
  locale: string,
  layerConfig: Pick<LayerConfig, 'outro' | 'watermark'>,
): string {
  const inputs = { locale, outro: layerConfig.outro, watermark: layerConfig.watermark };
  return crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 16);
}

/**
 * Returns true if a cached render file exists AND its stored hash matches the
 * expected hash — meaning the inputs haven't changed since the last render.
 */
export async function isCacheValid(filePath: string, expectedHash: string): Promise<boolean> {
  const hashPath = `${filePath}.hash`;
  if (!(await fs.pathExists(filePath)) || !(await fs.pathExists(hashPath))) return false;
  const stored = await fs.readFile(hashPath, 'utf8');
  return stored.trim() === expectedHash;
}

export async function writeHashFile(filePath: string, hash: string): Promise<void> {
  await fs.writeFile(`${filePath}.hash`, hash, 'utf8');
}

// ─── Stitch and mix ───────────────────────────────────────────────────────────

export interface StitchAndMixOptions {
  /** Ordered video segments to concatenate: [intro?, content, outro?] */
  segments: string[];
  /** Final output path — same as the pre-intro output path so nothing downstream changes */
  outputFile: string;
  /** Music config, or null if no music is configured */
  music: MusicConfig | null;
  /** Total frame count across all stitched segments */
  totalFrames: number;
  /** Frames per second — used to convert frame counts to seconds for FFmpeg */
  fps: number;
  /** Absolute path to the `public/` directory — for resolving asset paths */
  publicDir: string;
}

/**
 * Stitches video segments together and optionally adds a unified background
 * music track with fade envelopes spanning the full stitched duration.
 *
 * Flow:
 *   1. If multiple segments: concat with VideoStitcher (copy codec, no re-encode)
 *   2. If music configured: add unified audio track with FFmpeg filter_complex
 *
 * The music track spans the entire stitched video as a single continuous stream,
 * avoiding the audio-boundary problem that would occur if each segment rendered
 * its own MusicLayer independently.
 *
 * When no intro/outro is configured, this function is not called — content
 * renders directly to the final output path as before.
 */
export async function stitchAndMix(opts: StitchAndMixOptions): Promise<void> {
  const { segments, outputFile, music, totalFrames, fps, publicDir } = opts;

  if (segments.length === 0) {
    throw new Error('stitchAndMix: segments array must not be empty');
  }

  const totalSeconds = totalFrames / fps;
  const needsStitch = segments.length > 1;
  const needsMusicMix = music !== null;

  // Trivial case: single segment, no music
  if (!needsStitch && !needsMusicMix) {
    await fs.move(segments[0], outputFile, { overwrite: true });
    return;
  }

  // Determine the intermediate path for the stitched (pre-music) file.
  // If music mixing follows, stitch to a temp file; otherwise stitch to final.
  const stitchedFile = needsMusicMix ? `${outputFile}.__stitch.mp4` : outputFile;

  if (needsStitch) {
    await VideoStitcher.concat(segments, stitchedFile);
  }

  if (needsMusicMix) {
    const musicSrc = needsStitch ? stitchedFile : segments[0];
    const musicPath = resolvePublicPath(music!.src, publicDir);

    const fadeInSeconds = music!.fadeInFrames / fps;
    const fadeOutSeconds = music!.fadeOutFrames / fps;
    // Start fading out so music reaches silence exactly when the video ends
    const fadeOutStart = Math.max(fadeInSeconds, totalSeconds - fadeOutSeconds);

    const filterComplex = buildMusicFilterComplex(
      music!.volume,
      fadeInSeconds,
      fadeOutStart,
      fadeOutSeconds,
    );

    await execa('ffmpeg', [
      '-i',
      musicSrc,
      '-stream_loop',
      '-1',
      '-i',
      musicPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-t',
      totalSeconds.toFixed(6),
      '-c:v',
      'copy',
      '-y',
      outputFile,
    ]);

    if (needsStitch) {
      await fs.remove(stitchedFile);
    }
  }
}
