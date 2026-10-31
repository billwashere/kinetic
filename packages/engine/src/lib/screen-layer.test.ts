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

import { plainText } from './timing-schedule';
describe('plainText', () => {
  it('strips Markdown markers from subtitle text', () => {
    expect(plainText('Select **Next week** (the `right` arrow), see [docs](http://x).')).toBe(
      'Select Next week (the right arrow), see docs.',
    );
  });
});

import { videoClockOffset } from './screen-layer';
describe('video clock offset', () => {
  it('is the gap between the step clock and the video length at the end', () => {
    expect(videoClockOffset({ endMs: 10_000, videoSeconds: 7.6 })).toBeCloseTo(2.4);
    expect(videoClockOffset({ endMs: 10_000 })).toBe(0);
  });
  it('shifts step times and never starts past the last frame', () => {
    const sched: PageTimingSchedule = { leadInFrames: 0, leadOutFrames: 0, totalFrames: 30, subtitles: [], stepTimings: [{ stepId: 'a', anchor: null, startFrame: 0, durationFrames: 30 }] };
    const [seg] = planScreenSegments(sched, { a: 9_000 }, new Set(), 30, 2.4, 7.6);
    expect(seg.srcStart).toBeCloseTo(6.3, 5);
    const [late] = planScreenSegments(sched, { a: 99_000 }, new Set(), 30, 0, 7.6);
    expect(late.srcStart).toBeCloseTo(7.4, 5);
  });
});

import { buildNarrationFilter } from './narration';
describe('buildNarrationFilter', () => {
  it('delays each clip to its start and mixes them', () => {
    const f = buildNarrationFilter([{ file: 'a.mp3', startSeconds: 4 }, { file: 'b.mp3', startSeconds: 11.25 }], false);
    expect(f).toContain('[1:a]adelay=4000:all=1[n0]');
    expect(f).toContain('[2:a]adelay=11250:all=1[n1]');
    expect(f).toContain('[n0][n1]amix=inputs=2:normalize=0');
  });
  it('keeps music already on the video', () => {
    expect(buildNarrationFilter([{ file: 'a.mp3', startSeconds: 0 }], true)).toContain('[0:a][n0]amix=inputs=2');
  });
});
