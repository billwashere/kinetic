import { resolvePath } from './workspace-config';
import path from 'path';
import fs from 'fs-extra';
import { z } from 'zod';

/**
 * Layer configuration — controls music, watermark, and subtitle styling.
 *
 * Store as `packages/engine/layer-config.json`. All sections are optional;
 * omitting one disables that layer entirely. The file is validated at
 * assemble-time with clear error messages.
 *
 * Asset paths (music.src, watermark.src) must be public-relative paths:
 *   "/assets/background.mp3"  → packages/engine/public/assets/background.mp3
 *   "/assets/logo.png"        → packages/engine/public/assets/logo.png
 *
 * Copy `layer-config.example.json` to `layer-config.json` to get started.
 */

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

export const MusicConfigSchema = z.object({
  /** Public-relative path to the audio file, e.g. "/assets/background.mp3" */
  src: z.string().min(1),
  /** 0–1. Ambient music sits naturally around 0.10–0.20. Default: 0.15 */
  volume: z.number().min(0).max(1).default(0.15),
  /** Frames to fade in from silence at the start. Default: 30 (1 s at 30 fps) */
  fadeInFrames: z.number().int().min(0).default(30),
  /** Frames to fade out to silence at the end. Default: 60 (2 s at 30 fps) */
  fadeOutFrames: z.number().int().min(0).default(60),
  /** Loop the track for the duration of the video. Default: true */
  loop: z.boolean().default(true),
});

export const WatermarkConfigSchema = z.object({
  /** Public-relative path to the image file, e.g. "/assets/logo.png" */
  src: z.string().min(1),
  /** Which corner to place the watermark in. Default: bottom-right */
  position: z
    .enum(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    .default('bottom-right'),
  /** 0–1 opacity. Default: 0.7 */
  opacity: z.number().min(0).max(1).default(0.7),
  /** Rendered width in pixels. Height scales proportionally. Default: 180 */
  widthPx: z.number().int().min(1).default(180),
  /** Distance from the nearest corner in pixels. Default: 24 */
  marginPx: z.number().int().min(0).default(24),
});

export const SubtitleStyleSchema = z.object({
  /** Font size in pixels. Default: 32 */
  fontSize: z.number().int().min(8).default(32),
  /** CSS background colour string. Default: "rgba(0,0,0,0.8)" */
  backgroundColor: z.string().default('rgba(0,0,0,0.8)'),
  /** CSS text colour string. Default: "#ffffff" */
  textColor: z.string().default('#ffffff'),
  /** Vertical placement — "bottom" for most content, "top" for bottom-heavy UIs. Default: "bottom" */
  position: z.enum(['top', 'bottom']).default('bottom'),
  /** Horizontal padding inside the pill, in pixels. Default: 24 */
  paddingX: z.number().int().min(0).default(24),
  /** Vertical padding inside the pill, in pixels. Default: 10 */
  paddingY: z.number().int().min(0).default(10),
  /** Border-radius of the pill, in pixels. Default: 8 */
  borderRadius: z.number().int().min(0).default(8),
  /** Maximum width as a percentage of the video width. Default: 80 */
  maxWidthPct: z.number().min(10).max(100).default(80),
  /** Frames to cross-fade subtitle text in and out at step boundaries. Default: 5 */
  fadeFrames: z.number().int().min(0).default(5),
});

export const LayerConfigSchema = z.object({
  music: MusicConfigSchema.optional(),
  watermark: WatermarkConfigSchema.optional(),
  // Zod v4 doesn't recursively apply nested schema defaults when the outer
  // .default({}) fires, so we pre-compute the fully-defaulted value here.
  subtitleStyle: SubtitleStyleSchema.default(() => SubtitleStyleSchema.parse({})),

  /**
   * Intro slide — branded opening segment prepended to each page video.
   * When present, triggers the full stitch-and-mix pipeline:
   *   [intro] + [content] + [outro] → stitched → music overlay → final MP4
   * When absent, content is written directly to the final path (as before).
   */
  intro: z
    .object({
      /** Duration of the intro slide in seconds. Default: 4 */
      durationSeconds: z.number().min(1).max(30).default(4),
      /** Background fill colour. Default: #0f172a */
      backgroundColor: z.string().default('#0f172a'),
      /** Accent colour for the separator line and highlights. Default: #3b82f6 */
      accentColor: z.string().default('#3b82f6'),
      /** Primary text colour. Default: #ffffff */
      textColor: z.string().default('#ffffff'),
      /** Whether to render the breadcrumb path above the title. Default: true */
      showBreadcrumbs: z.boolean().default(true),
    })
    .optional(),

  /**
   * Outro slide — branded closing segment appended to each page video.
   * Only rendered when `intro` is also configured (they always appear as a pair).
   */
  outro: z
    .object({
      /** Duration of the outro slide in seconds. Default: 3 */
      durationSeconds: z.number().min(1).max(30).default(3),
      /** Background fill colour. Default: #0f172a */
      backgroundColor: z.string().default('#0f172a'),
      /** Primary text colour. Default: #ffffff */
      textColor: z.string().default('#ffffff'),
      /**
       * Optional call-to-action line, e.g. "docs.mycompany.com".
       * Rendered below the logo in a muted accent colour.
       */
      ctaText: z.string().optional(),
    })
    .optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type MusicConfig = z.infer<typeof MusicConfigSchema>;
export type WatermarkConfig = z.infer<typeof WatermarkConfigSchema>;
export type SubtitleStyle = z.infer<typeof SubtitleStyleSchema>;
export type LayerConfig = z.infer<typeof LayerConfigSchema>;
export type IntroConfig = NonNullable<LayerConfig['intro']>;
export type OutroConfig = NonNullable<LayerConfig['outro']>;

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = SubtitleStyleSchema.parse({});

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Loads and validates layer-config.json from the engine package root.
 * Returns defaults if the file doesn't exist — music and watermark are absent,
 * subtitle style uses defaults.
 */
export async function loadLayerConfig(): Promise<LayerConfig> {
  const configPath = resolvePath('layerConfig', path.join(process.cwd(), 'layer-config.json'));

  if (!(await fs.pathExists(configPath))) {
    return LayerConfigSchema.parse({});
  }

  const raw = await fs.readJson(configPath);
  const result = LayerConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(
      `Invalid layer-config.json:\n${issues}\n\nSee layer-config.example.json for reference.`,
    );
  }

  return result.data;
}
