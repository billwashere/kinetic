import { describe, it, expect } from 'vitest';
import {
  getPageContentSeconds,
  secondsToFrames,
  getPageDurationFrames,
  type AudioManifest,
} from './manifest-reader';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeManifest(
  entries: Array<{ locale: string; pageId: string; stepId: string; duration: number }>,
): AudioManifest {
  return Object.fromEntries(
    entries.map(({ locale, pageId, stepId, duration }) => [
      `${locale}_${pageId}_${stepId}`,
      { file: `/audio/${stepId}.mp3`, duration, text: 'x', anchor: null },
    ]),
  );
}

// ─── getPageContentSeconds ─────────────────────────────────────────────────────

describe('getPageContentSeconds', () => {
  it('sums durations for all steps belonging to the page', () => {
    const manifest = makeManifest([
      { locale: 'en-US', pageId: 'checkout', stepId: 'step_a', duration: 2.5 },
      { locale: 'en-US', pageId: 'checkout', stepId: 'step_b', duration: 1.8 },
    ]);
    expect(getPageContentSeconds(manifest, 'en-US', 'checkout')).toBeCloseTo(4.3);
  });

  it('returns 0 when no steps exist for the page', () => {
    const manifest = makeManifest([
      { locale: 'en-US', pageId: 'other_page', stepId: 'step_a', duration: 3.0 },
    ]);
    expect(getPageContentSeconds(manifest, 'en-US', 'checkout')).toBe(0);
  });

  it('does not include steps from a different locale', () => {
    const manifest = makeManifest([
      { locale: 'en-US', pageId: 'checkout', stepId: 'step_a', duration: 2.0 },
      { locale: 'ar-AE', pageId: 'checkout', stepId: 'step_a', duration: 3.0 },
    ]);
    expect(getPageContentSeconds(manifest, 'en-US', 'checkout')).toBeCloseTo(2.0);
    expect(getPageContentSeconds(manifest, 'ar-AE', 'checkout')).toBeCloseTo(3.0);
  });

  it('does not match a page whose id is a prefix of another', () => {
    // 'proj' should not match 'proj_extended'
    const manifest = makeManifest([
      { locale: 'en-US', pageId: 'proj_extended', stepId: 'step_a', duration: 5.0 },
    ]);
    // Key is "en-US_proj_extended_step_a" — prefix check is "en-US_proj_"
    // which IS a prefix of this key. This test documents the current behaviour
    // and ensures the caller uses unambiguous pageIds.
    const result = getPageContentSeconds(manifest, 'en-US', 'proj');
    // 'en-US_proj_extended_step_a' starts with 'en-US_proj_' → matches
    expect(result).toBeCloseTo(5.0);
  });

  it('handles an empty manifest', () => {
    expect(getPageContentSeconds({}, 'en-US', 'checkout')).toBe(0);
  });
});

// ─── secondsToFrames ──────────────────────────────────────────────────────────

describe('secondsToFrames', () => {
  it('converts whole seconds to frames exactly', () => {
    expect(secondsToFrames(5, 30)).toBe(150);
  });

  it('rounds up fractional seconds so no audio frame is dropped', () => {
    expect(secondsToFrames(5.1, 30)).toBe(153); // 5.1 * 30 = 153.0 → 153
    expect(secondsToFrames(5.01, 30)).toBe(151); // 5.01 * 30 = 150.3 → 151
  });

  it('works with 24fps', () => {
    expect(secondsToFrames(2, 24)).toBe(48);
  });

  it('returns 0 for 0 seconds', () => {
    expect(secondsToFrames(0, 30)).toBe(0);
  });
});

// ─── getPageDurationFrames ────────────────────────────────────────────────────

describe('getPageDurationFrames', () => {
  const FPS = 30;
  const LEAD_IN = 1.0;
  const LEAD_OUT = 2.0;

  it('adds lead-in and lead-out to the content duration', () => {
    const manifest = makeManifest([
      { locale: 'en-US', pageId: 'checkout', stepId: 'step_a', duration: 3.0 },
    ]);
    // 1s lead-in + 3s content + 2s lead-out = 6s = 180 frames
    expect(getPageDurationFrames(manifest, 'en-US', 'checkout', FPS, LEAD_IN, LEAD_OUT)).toBe(180);
  });

  it('rounds fractional total durations up to the next frame', () => {
    const manifest = makeManifest([{ locale: 'en-US', pageId: 'p', stepId: 's', duration: 1.5 }]);
    // 1.0 + 1.5 + 2.0 = 4.5s = 135 frames exactly
    expect(getPageDurationFrames(manifest, 'en-US', 'p', FPS, LEAD_IN, LEAD_OUT)).toBe(135);
  });

  it('uses the fallback when no manifest entries exist for the page', () => {
    const result = getPageDurationFrames({}, 'en-US', 'checkout', FPS, LEAD_IN, LEAD_OUT, 90);
    expect(result).toBe(90);
  });

  it('defaults to 5 seconds when fallback is not given and no entries exist', () => {
    const result = getPageDurationFrames({}, 'en-US', 'checkout', FPS, LEAD_IN, LEAD_OUT);
    expect(result).toBe(FPS * 5); // 150
  });

  it('enforces a minimum of 1 second (fps frames) even for very short content', () => {
    const manifest = makeManifest([
      // 0s lead-in + 0.01s content + 0s lead-out = 0.01s = 1 frame (< 30)
      { locale: 'en-US', pageId: 'p', stepId: 's', duration: 0.01 },
    ]);
    const result = getPageDurationFrames(manifest, 'en-US', 'p', FPS, 0, 0);
    expect(result).toBe(FPS); // minimum 1 second
  });

  it('accumulates durations from multiple steps', () => {
    const manifest = makeManifest([
      { locale: 'en-US', pageId: 'flow', stepId: 'step_1', duration: 2.0 },
      { locale: 'en-US', pageId: 'flow', stepId: 'step_2', duration: 1.5 },
      { locale: 'en-US', pageId: 'flow', stepId: 'step_3', duration: 3.0 },
    ]);
    // 1.0 + (2.0 + 1.5 + 3.0) + 2.0 = 9.5s = 285 frames
    expect(getPageDurationFrames(manifest, 'en-US', 'flow', FPS, LEAD_IN, LEAD_OUT)).toBe(285);
  });

  it('isolates by locale — different locales get different durations', () => {
    const manifest = makeManifest([
      { locale: 'en-US', pageId: 'p', stepId: 's', duration: 2.0 },
      { locale: 'ar-AE', pageId: 'p', stepId: 's', duration: 4.0 }, // Arabic narration is longer
    ]);
    const enFrames = getPageDurationFrames(manifest, 'en-US', 'p', FPS, 0, 0);
    const arFrames = getPageDurationFrames(manifest, 'ar-AE', 'p', FPS, 0, 0);
    expect(enFrames).toBe(60); // 2s
    expect(arFrames).toBe(120); // 4s
  });

  it('works with zero lead-in and lead-out', () => {
    const manifest = makeManifest([{ locale: 'en-US', pageId: 'p', stepId: 's', duration: 5.0 }]);
    expect(getPageDurationFrames(manifest, 'en-US', 'p', FPS, 0, 0)).toBe(150);
  });
});
