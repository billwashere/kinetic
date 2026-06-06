/**
 * Portal configuration — driven by environment variables for subtree deployments.
 *
 * ALL values can be set from OUTSIDE the git subtree via environment variables.
 * Set these in your monorepo's root .env file, never inside the subtree directory.
 *
 * KINETIC_SITE_NAME           — browser title and sidebar logo text
 * KINETIC_SITE_DESCRIPTION    — default meta description
 * KINETIC_FAVICON             — favicon URL (served from public/)
 * KINETIC_COLOR_PRIMARY       — main accent colour hex (e.g. #9333ea)
 * KINETIC_COLOR_PRIMARY_LIGHT — very light tint of primary (e.g. #faf5ff)
 * KINETIC_COLOR_PRIMARY_MID   — mid tint of primary for borders (e.g. #e9d5ff)
 * KINETIC_COLOR_BG            — page background colour
 * KINETIC_COLOR_SURFACE       — card/content background colour
 * KINETIC_COLOR_SIDEBAR       — sidebar background colour
 * KINETIC_LOCALE_LABELS       — JSON string: {"en-US":"EN","ar-AE":"AR"}
 * KINETIC_LOCALE_NAMES        — JSON string: {"en-US":"English","ar-AE":"Arabic"}
 *
 * For subtree deployments, also set:
 * KINETIC_PUBLIC_DIR          — absolute path to the public/ directory (astro.config.mjs)
 * KINETIC_LOCALES_DIR         — absolute path to locale JSON files (page route)
 * KINETIC_GENERATED_DIR       — absolute path to generated/ directory (page route)
 */

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const SITE = {
  name: env('KINETIC_SITE_NAME', 'Kinetic Docs'),
  description: env(
    'KINETIC_SITE_DESCRIPTION',
    'Step-by-step product documentation with video walkthroughs.',
  ),
  favicon: env('KINETIC_FAVICON', '/assets/favicon.ico'),
} as const;

export const THEME = {
  primary: env('KINETIC_COLOR_PRIMARY', '#2563eb'),
  primaryLight: env('KINETIC_COLOR_PRIMARY_LIGHT', '#eff6ff'),
  primaryMid: env('KINETIC_COLOR_PRIMARY_MID', '#bfdbfe'),
  bg: env('KINETIC_COLOR_BG', '#f8fafc'),
  surface: env('KINETIC_COLOR_SURFACE', '#ffffff'),
  sidebar: env('KINETIC_COLOR_SIDEBAR', '#ffffff'),
} as const;

export function themeStyleTag(): string {
  return (
    `<style>:root{` +
    `--kinetic-primary:${THEME.primary};` +
    `--kinetic-primary-light:${THEME.primaryLight};` +
    `--kinetic-primary-mid:${THEME.primaryMid};` +
    `--kinetic-bg:${THEME.bg};` +
    `--kinetic-surface:${THEME.surface};` +
    `--kinetic-sidebar:${THEME.sidebar};` +
    `}</style>`
  );
}

export const LOCALE_LABELS: Record<string, string> = process.env.KINETIC_LOCALE_LABELS
  ? JSON.parse(process.env.KINETIC_LOCALE_LABELS)
  : {
      'en-US': 'EN',
      'ar-AE': 'AR',
      'fr-FR': 'FR',
      'de-DE': 'DE',
      'es-ES': 'ES',
      'ja-JP': 'JA',
      'zh-CN': 'ZH',
      'pt-BR': 'PT',
      'ko-KR': 'KO',
    };

export const LOCALE_NAMES: Record<string, string> = process.env.KINETIC_LOCALE_NAMES
  ? JSON.parse(process.env.KINETIC_LOCALE_NAMES)
  : {
      'en-US': 'English',
      'ar-AE': 'Arabic',
      'fr-FR': 'French',
      'de-DE': 'German',
      'es-ES': 'Spanish',
      'ja-JP': 'Japanese',
      'zh-CN': 'Chinese',
      'pt-BR': 'Portuguese',
      'ko-KR': 'Korean',
    };
