/**
 * Manifest reader — extracts timing data from the audio manifest produced by
 * pre-render-audio.ts and converts it to frame counts for Remotion.
 *
 * Kept as pure functions (no I/O) so it's trivially testable without mocking
 * the filesystem. The caller (assemble.ts) handles manifest loading.
 */

export interface ManifestEntry {
  file: string;
  duration: number; // seconds, measured by ffprobe
  text: string;
  anchor: unknown;
}

export type AudioManifest = Record<string, ManifestEntry>;

/**
 * Sums the audio durations of all steps belonging to a specific page within
 * a locale's audio manifest.
 *
 * Manifest keys follow the convention: `<locale>_<pageId>_<stepId>`
 * e.g. `en-US_create_project_login_email`
 *
 * Returns 0 if no steps are found (callers should warn and fall back).
 */
export function getPageContentSeconds(
  manifest: AudioManifest,
  locale: string,
  pageId: string,
): number {
  const prefix = `${locale}_${pageId}_`;
  let total = 0;

  for (const [key, entry] of Object.entries(manifest)) {
    if (key.startsWith(prefix)) {
      total += entry.duration;
    }
  }

  return total;
}

/**
 * Converts a duration in seconds to a frame count, rounding up so the last
 * frame of audio always has a corresponding video frame.
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.ceil(seconds * fps);
}

/**
 * Calculates the total frame count for a rendered page video:
 *
 *   [lead-in] [step 1] [step 2] … [step N] [lead-out]
 *
 * @param manifest   The full audio manifest for a locale
 * @param locale     e.g. 'en-US'
 * @param pageId     e.g. 'create_project'
 * @param fps        Frames per second (must match the Remotion composition)
 * @param leadIn     Seconds of silence before the first step
 * @param leadOut    Seconds of silence after the last step
 * @param fallback   Frame count to use if no manifest entries exist for the page.
 *                   Defaults to 5 seconds worth of frames (fps * 5).
 */
export function getPageDurationFrames(
  manifest: AudioManifest,
  locale: string,
  pageId: string,
  fps: number,
  leadIn: number,
  leadOut: number,
  fallback?: number,
): number {
  const contentSeconds = getPageContentSeconds(manifest, locale, pageId);

  if (contentSeconds === 0) {
    return fallback ?? fps * 5;
  }

  const totalSeconds = leadIn + contentSeconds + leadOut;

  // Minimum of 1 second — protects against a manifest with zero-duration entries
  return Math.max(secondsToFrames(totalSeconds, fps), fps);
}
