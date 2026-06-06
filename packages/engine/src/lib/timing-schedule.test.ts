import { describe, it, expect } from 'vitest';
import { buildPageTimingSchedule } from './timing-schedule';
import type { AudioManifest } from './manifest-reader';
import type { DocStep } from './doc-extractor';

const FPS = 30;
const LEAD_IN = 1.0; // 30 frames
const LEAD_OUT = 2.0; // 60 frames

function step(
  stepId: string,
  opts: Partial<Pick<DocStep, 'type' | 'textKey' | 'anchor'>> = {},
): DocStep {
  return {
    type: 'action',
    stepId,
    textKey: `key_${stepId}`,
    anchor: null,
    ...opts,
  };
}

function manifest(
  entries: Array<{
    locale: string;
    pageId: string;
    stepId: string;
    duration: number;
    text?: string;
  }>,
): AudioManifest {
  return Object.fromEntries(
    entries.map(({ locale, pageId, stepId, duration, text }) => [
      `${locale}_${pageId}_${stepId}`,
      { file: `/audio/${stepId}.mp3`, duration, text: text ?? `Text for ${stepId}`, anchor: null },
    ]),
  );
}

// ─── Basic schedule construction ──────────────────────────────────────────────

describe('buildPageTimingSchedule — basic layout', () => {
  it('places the first step after the lead-in', () => {
    const m = manifest([{ locale: 'en-US', pageId: 'p', stepId: 'a', duration: 2 }]);
    const { subtitles, stepTimings } = buildPageTimingSchedule(
      m,
      [step('a')],
      'en-US',
      'p',
      FPS,
      LEAD_IN,
      LEAD_OUT,
    );

    // Lead-in = 1s = 30 frames; first step starts at frame 30
    expect(subtitles[0].startFrame).toBe(30);
    expect(stepTimings[0].startFrame).toBe(30);
  });

  it('chains steps consecutively with no gap between them', () => {
    const m = manifest([
      { locale: 'en-US', pageId: 'p', stepId: 'a', duration: 2 }, // 60 frames
      { locale: 'en-US', pageId: 'p', stepId: 'b', duration: 1 }, // 30 frames
    ]);
    const { subtitles } = buildPageTimingSchedule(
      m,
      [step('a'), step('b')],
      'en-US',
      'p',
      FPS,
      LEAD_IN,
      LEAD_OUT,
    );

    // a: [30, 90), b: [90, 120)
    expect(subtitles[0]).toMatchObject({ startFrame: 30, durationFrames: 60 });
    expect(subtitles[1]).toMatchObject({ startFrame: 90, durationFrames: 30 });
  });

  it('computes totalFrames = leadIn + content + leadOut', () => {
    const m = manifest([{ locale: 'en-US', pageId: 'p', stepId: 'a', duration: 3 }]); // 90 frames
    const { totalFrames } = buildPageTimingSchedule(
      m,
      [step('a')],
      'en-US',
      'p',
      FPS,
      LEAD_IN,
      LEAD_OUT,
    );
    // 30 + 90 + 60 = 180
    expect(totalFrames).toBe(180);
  });

  it('matches subtitle and step timing arrays for each step', () => {
    const m = manifest([
      { locale: 'en-US', pageId: 'p', stepId: 'x', duration: 1.5 },
      { locale: 'en-US', pageId: 'p', stepId: 'y', duration: 2.0 },
    ]);
    const { subtitles, stepTimings } = buildPageTimingSchedule(
      m,
      [step('x'), step('y')],
      'en-US',
      'p',
      FPS,
      LEAD_IN,
      LEAD_OUT,
    );

    expect(subtitles.length).toBe(stepTimings.length);
    for (let i = 0; i < subtitles.length; i++) {
      expect(subtitles[i].startFrame).toBe(stepTimings[i].startFrame);
      expect(subtitles[i].durationFrames).toBe(stepTimings[i].durationFrames);
    }
  });
});

// ─── Ordering ─────────────────────────────────────────────────────────────────

describe('buildPageTimingSchedule — step ordering', () => {
  it('follows skeleton order, not manifest key order', () => {
    // Manifest has 'b' before 'a' alphabetically — skeleton has 'a' first
    const m = manifest([
      { locale: 'en-US', pageId: 'p', stepId: 'b', duration: 1 },
      { locale: 'en-US', pageId: 'p', stepId: 'a', duration: 2 },
    ]);
    const { subtitles } = buildPageTimingSchedule(
      m,
      [step('a'), step('b')], // skeleton order: a then b
      'en-US',
      'p',
      FPS,
      LEAD_IN,
      LEAD_OUT,
    );

    expect(subtitles[0].stepId).toBe('a');
    expect(subtitles[1].stepId).toBe('b');
    // 'a' (2s = 60 frames) comes first
    expect(subtitles[0].durationFrames).toBe(60);
    expect(subtitles[1].startFrame).toBe(30 + 60); // leadIn + a duration
  });
});

// ─── Skip behaviour ───────────────────────────────────────────────────────────

describe('buildPageTimingSchedule — missing manifest entries', () => {
  it('skips steps that have no manifest entry', () => {
    const m = manifest([
      { locale: 'en-US', pageId: 'p', stepId: 'a', duration: 2 },
      // 'b' intentionally absent — e.g. an assertion with no TTS
    ]);
    const { subtitles, stepTimings } = buildPageTimingSchedule(
      m,
      [step('a'), step('b')],
      'en-US',
      'p',
      FPS,
      LEAD_IN,
      LEAD_OUT,
    );

    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].stepId).toBe('a');
    expect(stepTimings).toHaveLength(1);
  });

  it('returns empty arrays and falls back to minimum duration when no steps match', () => {
    const { subtitles, stepTimings, totalFrames } = buildPageTimingSchedule(
      {},
      [step('a')],
      'en-US',
      'p',
      FPS,
      LEAD_IN,
      LEAD_OUT,
    );
    expect(subtitles).toHaveLength(0);
    expect(stepTimings).toHaveLength(0);
    // leadIn(30) + leadOut(60) = 90, but minimum is 1s (30 frames)
    expect(totalFrames).toBe(90);
  });
});

// ─── Anchor handling ──────────────────────────────────────────────────────────

describe('buildPageTimingSchedule — anchor data', () => {
  it('passes bounding boxes through to stepTimings', () => {
    const m = manifest([{ locale: 'en-US', pageId: 'p', stepId: 'a', duration: 1 }]);
    const box = { x: 100, y: 200, width: 300, height: 50 };
    const { stepTimings } = buildPageTimingSchedule(
      m,
      [step('a', { anchor: box })],
      'en-US',
      'p',
      FPS,
      0,
      0,
    );
    expect(stepTimings[0].anchor).toEqual(box);
  });

  it('sets anchor to null when the step has no bounding box', () => {
    const m = manifest([{ locale: 'en-US', pageId: 'p', stepId: 'a', duration: 1 }]);
    const { stepTimings } = buildPageTimingSchedule(
      m,
      [step('a', { anchor: null })],
      'en-US',
      'p',
      FPS,
      0,
      0,
    );
    expect(stepTimings[0].anchor).toBeNull();
  });
});

// ─── Locale isolation ─────────────────────────────────────────────────────────

describe('buildPageTimingSchedule — locale isolation', () => {
  it('uses only entries for the requested locale', () => {
    const m = manifest([
      { locale: 'en-US', pageId: 'p', stepId: 'a', duration: 2, text: 'English' },
      { locale: 'ar-AE', pageId: 'p', stepId: 'a', duration: 3, text: 'Arabic' },
    ]);

    const en = buildPageTimingSchedule(m, [step('a')], 'en-US', 'p', FPS, 0, 0);
    const ar = buildPageTimingSchedule(m, [step('a')], 'ar-AE', 'p', FPS, 0, 0);

    expect(en.subtitles[0].text).toBe('English');
    expect(en.subtitles[0].durationFrames).toBe(60);
    expect(ar.subtitles[0].text).toBe('Arabic');
    expect(ar.subtitles[0].durationFrames).toBe(90);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('buildPageTimingSchedule — edge cases', () => {
  it('enforces a minimum of 1 frame per step', () => {
    const m = manifest([{ locale: 'en-US', pageId: 'p', stepId: 'a', duration: 0.001 }]);
    const { subtitles } = buildPageTimingSchedule(m, [step('a')], 'en-US', 'p', FPS, 0, 0);
    expect(subtitles[0].durationFrames).toBeGreaterThanOrEqual(1);
  });

  it('enforces a minimum total of 1 second', () => {
    const { totalFrames } = buildPageTimingSchedule({}, [], 'en-US', 'p', FPS, 0, 0);
    expect(totalFrames).toBeGreaterThanOrEqual(FPS);
  });

  it('stores subtitle text from the manifest, not the textKey', () => {
    const m = manifest([
      { locale: 'en-US', pageId: 'p', stepId: 'a', duration: 1, text: 'Click the button.' },
    ]);
    const { subtitles } = buildPageTimingSchedule(m, [step('a')], 'en-US', 'p', FPS, 0, 0);
    expect(subtitles[0].text).toBe('Click the button.');
  });

  it('excludes note steps from subtitle cues and step timings', () => {
    const m = manifest([
      { locale: 'en-US', pageId: 'p', stepId: 'step_a', duration: 2 },
      // note_b is intentionally in the manifest to confirm exclusion is by type, not absence
      { locale: 'en-US', pageId: 'p', stepId: 'note_b', duration: 1 },
    ]);
    const steps: DocStep[] = [
      { type: 'action', stepId: 'step_a', textKey: 'key_a', anchor: null },
      { type: 'note', stepId: 'note_b', textKey: 'note_key', anchor: null },
    ];
    const { subtitles, stepTimings } = buildPageTimingSchedule(m, steps, 'en-US', 'p', FPS, 0, 0);
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].stepId).toBe('step_a');
    expect(stepTimings).toHaveLength(1);
  });

  it('excludes comment steps (defensive — flushDocs should strip them before here)', () => {
    const m = manifest([{ locale: 'en-US', pageId: 'p', stepId: 'step_a', duration: 2 }]);
    const steps: DocStep[] = [
      { type: 'action', stepId: 'step_a', textKey: 'key_a', anchor: null },
      { type: 'comment', stepId: '__comment_1', comment: 'Internal note' },
    ];
    const { subtitles } = buildPageTimingSchedule(m, steps, 'en-US', 'p', FPS, 0, 0);
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].stepId).toBe('step_a');
  });

  it('notes do not contribute to total duration', () => {
    const m = manifest([{ locale: 'en-US', pageId: 'p', stepId: 'step_a', duration: 3 }]); // 90 frames
    const steps: DocStep[] = [
      { type: 'action', stepId: 'step_a', textKey: 'key_a', anchor: null },
      { type: 'note', stepId: 'note_b', textKey: 'note_key', anchor: null },
    ];
    const { totalFrames } = buildPageTimingSchedule(m, steps, 'en-US', 'p', FPS, 0, 0);
    expect(totalFrames).toBe(90); // note adds nothing
  });
});
