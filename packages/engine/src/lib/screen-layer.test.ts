import { describe, it, expect } from 'vitest';
import { planScreenSegments, buildScreenFilter, ACTION_LEAD_SECONDS } from './screen-layer';
import type { PageTimingSchedule } from './timing-schedule';

const FPS = 30;
const schedule: PageTimingSchedule = {
  leadInFrames: 30,
  leadOutFrames: 60,
  totalFrames: 30 + 90 + 60 + 60,
  subtitles: [],
  stepTimings: [
    { stepId: 'loaded', anchor: null, startFrame: 30, durationFrames: 90 },
    { stepId: 'click', anchor: { x: 1, y: 2, width: 3, height: 4 }, startFrame: 120, durationFrames: 60 },
  ],
};

describe('planScreenSegments', () => {
  const segs = planScreenSegments(schedule, { loaded: 25_000, click: 27_000 }, new Set(['click']), FPS);

  it('covers the whole video with no gaps', () => {
    expect(segs.reduce((n, s) => n + s.duration, 0)).toBeCloseTo(schedule.totalFrames / FPS, 5);
  });
  it('freezes the lead-in on the first step and starts actions before the click', () => {
    expect(segs[0]).toMatchObject({ freeze: true, duration: 1 });
    expect(segs[0].srcStart).toBeCloseTo(24.7, 5);
    expect(segs[2].srcStart).toBeCloseTo(27 - ACTION_LEAD_SECONDS, 5);
  });
  it('returns nothing when no step has a recorded time', () => {
    expect(planScreenSegments(schedule, {}, new Set(), FPS)).toEqual([]);
  });
  it('holds an untimed step on the previous frame instead of dropping its slot', () => {
    const s = planScreenSegments(schedule, { loaded: 25_000 }, new Set(), FPS);
    expect(s.reduce((n, x) => n + x.duration, 0)).toBeCloseTo(schedule.totalFrames / FPS, 5);
    expect(s[2].freeze).toBe(true);
  });
});

describe('buildScreenFilter', () => {
  it('joins every segment and overlays the transparent layer', () => {
    const f = buildScreenFilter([{ srcStart: 1, duration: 2, freeze: false }, { srcStart: 3, duration: 1, freeze: true }], FPS, 1920, 1080);
    expect(f).toContain('[s0][s1]concat=n=2');
    expect(f).toContain('[screen][1:v]overlay');
    expect(f).toContain('trim=start=3.000:end=3.033');
  });
});
