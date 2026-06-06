import os from 'os';
import { z } from 'zod';

/**
 * Shared composition constants — used by both the Remotion entry point (index.tsx)
 * and the assemble script. Keeping them here prevents the two from drifting apart.
 *
 * Resolution and FPS are intentionally not env-configurable: changing them requires
 * re-recording the Playwright screen capture at the new resolution, so they're a
 * code-level decision that applies to the whole project, not a per-run tuning knob.
 */
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// ─── Codec ───────────────────────────────────────────────────────────────────

/**
 * Supported output codecs.
 *
 * h264   — widest compatibility, good quality, moderate file size. Best default.
 * h265   — ~40% smaller files than h264 at equal quality; slower to encode;
 *           not supported in all browsers without a media source extension.
 * vp9    — royalty-free, good browser support, slower to encode than h264.
 * vp8    — older VP codec, worse quality/size ratio than vp9; avoid for new content.
 */
export const CODEC_VALUES = ['h264', 'h265', 'vp9', 'vp8'] as const;
export type RenderCodec = (typeof CODEC_VALUES)[number];

// ─── x264/x265 preset ────────────────────────────────────────────────────────

/**
 * Encoding speed preset for h264/h265. Does NOT affect output quality — CRF
 * controls quality. Preset only controls the encode time vs file size tradeoff:
 * faster presets produce slightly larger files at the same CRF.
 *
 * Recommended:
 *   ultrafast / veryfast  — CI pipelines where render time matters
 *   medium                — default, balanced
 *   slow / veryslow       — release builds where file size matters
 */
export const PRESET_VALUES = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
] as const;
export type RenderPreset = (typeof PRESET_VALUES)[number];

// ─── Schema ───────────────────────────────────────────────────────────────────

const RenderConfigSchema = z.object({
  /**
   * Output codec. Default: h264.
   * Set via RENDER_CODEC env var.
   */
  codec: z.enum(CODEC_VALUES).default('h264'),

  /**
   * Constant Rate Factor — controls quality vs file size.
   * Lower = better quality, larger file. Higher = worse quality, smaller file.
   *
   * Useful ranges (lower bound is lossless for that codec):
   *   h264:  0–51  (18–23 is a good range for documentation; 18 = near-lossless)
   *   h265:  0–51  (same scale as h264 but produces smaller files at equal CRF)
   *   vp9:   0–63  (33 is roughly equivalent to h264 CRF 23)
   *   vp8:   4–63
   *
   * Default: 18 (high quality — suitable for documentation where text legibility matters)
   * Set via RENDER_CRF env var.
   */
  crf: z.coerce.number().int().min(0).max(63).default(18),

  /**
   * Encoding speed preset (h264/h265 only; ignored for vp8/vp9).
   * Default: medium.
   * Set via RENDER_PRESET env var.
   */
  x264Preset: z.enum(PRESET_VALUES).default('medium'),

  /**
   * Number of browser tabs Remotion opens in parallel to render frames.
   * Higher values use more RAM and CPU but render faster on multi-core machines.
   * Default: half the number of logical CPU cores (Remotion's own default).
   * Set via RENDER_CONCURRENCY env var.
   */
  concurrency: z.coerce
    .number()
    .int()
    .min(1)
    .default(Math.max(1, Math.floor(os.cpus().length / 2))),

  /**
   * Seconds of silence to prepend before the first step's audio.
   * Gives the viewer time to orient before narration begins.
   * Default: 1.0 second.
   * Set via RENDER_LEAD_IN_SECONDS env var.
   */
  leadInSeconds: z.coerce.number().min(0).default(1.0),

  /**
   * Seconds of silence to append after the last step's audio.
   * Prevents the video from cutting off abruptly.
   * Default: 2.0 seconds.
   * Set via RENDER_LEAD_OUT_SECONDS env var.
   */
  leadOutSeconds: z.coerce.number().min(0).default(2.0),
});

export type RenderConfig = z.infer<typeof RenderConfigSchema>;

/**
 * Loads and validates render configuration from environment variables.
 * Throws with a clear message if any value is out of range.
 * All values have sensible defaults, so an empty .env is valid.
 */
export function loadRenderConfig(): RenderConfig {
  const raw = {
    codec: process.env.RENDER_CODEC,
    crf: process.env.RENDER_CRF,
    x264Preset: process.env.RENDER_PRESET,
    concurrency: process.env.RENDER_CONCURRENCY,
    leadInSeconds: process.env.RENDER_LEAD_IN_SECONDS,
    leadOutSeconds: process.env.RENDER_LEAD_OUT_SECONDS,
  };

  const result = RenderConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid render configuration:\n${issues}`);
  }

  return result.data;
}
