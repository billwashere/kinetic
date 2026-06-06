import { describe, it, expect } from 'vitest';
import { framesToVTTTimestamp, generateWebVTT } from './vtt';
import type { SubtitleCue } from './timing-schedule';

// ─── framesToVTTTimestamp ─────────────────────────────────────────────────────

describe('framesToVTTTimestamp', () => {
  const FPS = 30;

  it('formats zero as 00:00:00.000', () => {
    expect(framesToVTTTimestamp(0, FPS)).toBe('00:00:00.000');
  });

  it('converts whole seconds correctly', () => {
    expect(framesToVTTTimestamp(30, FPS)).toBe('00:00:01.000');
    expect(framesToVTTTimestamp(60, FPS)).toBe('00:00:02.000');
    expect(framesToVTTTimestamp(1800, FPS)).toBe('00:01:00.000');
  });

  it('formats fractional seconds to millisecond precision', () => {
    // 1 frame at 30fps = 33.333ms → rounds to 33ms
    expect(framesToVTTTimestamp(1, FPS)).toBe('00:00:00.033');
  });

  it('handles minutes and hours', () => {
    expect(framesToVTTTimestamp(30 * 60 * 90, FPS)).toBe('01:30:00.000');
  });

  it('pads all fields to the correct width', () => {
    const ts = framesToVTTTimestamp(30 * 60 * 1 + 30 * 5 + 15, FPS);
    // 1 min 5 sec 15 frames = 1:05:00.500
    expect(ts).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});

// ─── generateWebVTT ───────────────────────────────────────────────────────────

const FPS = 30;

function cue(
  stepId: string,
  text: string,
  startFrame: number,
  durationFrames: number,
): SubtitleCue {
  return { stepId, text, startFrame, durationFrames };
}

describe('generateWebVTT', () => {
  it('returns a minimal valid VTT header for an empty cue array', () => {
    expect(generateWebVTT([], FPS)).toBe('WEBVTT\n');
  });

  it('starts with WEBVTT header', () => {
    const vtt = generateWebVTT([cue('s', 'Hello', 30, 60)], FPS);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('generates correct timestamps for a single cue', () => {
    // startFrame=30 (1s), durationFrames=60 (2s) → 00:00:01.000 --> 00:00:03.000
    const vtt = generateWebVTT([cue('s', 'Click the button.', 30, 60)], FPS);
    expect(vtt).toContain('00:00:01.000 --> 00:00:03.000');
    expect(vtt).toContain('Click the button.');
  });

  it('chains cues sequentially with no overlap', () => {
    const cues = [
      cue('a', 'First step.', 30, 60), // 1s → 3s
      cue('b', 'Second step.', 90, 45), // 3s → 4.5s
    ];
    const vtt = generateWebVTT(cues, FPS);
    expect(vtt).toContain('00:00:01.000 --> 00:00:03.000');
    expect(vtt).toContain('00:00:03.000 --> 00:00:04.500');
  });

  it('applies introOffset to all timestamps', () => {
    // introOffset of 120 frames (4s at 30fps) shifts all timestamps forward 4s
    const cues = [cue('s', 'Hello', 30, 60)]; // without offset: 1s → 3s
    const vtt = generateWebVTT(cues, FPS, 120);
    expect(vtt).toContain('00:00:05.000 --> 00:00:07.000'); // +4s offset
  });

  it('zero introOffset produces the same result as no offset argument', () => {
    const cues = [cue('s', 'Hello', 30, 60)];
    expect(generateWebVTT(cues, FPS, 0)).toBe(generateWebVTT(cues, FPS));
  });

  it('strips markdown bold/italic from subtitle text', () => {
    const vtt = generateWebVTT([cue('s', 'Navigate to the **dashboard**.', 30, 60)], FPS);
    expect(vtt).toContain('Navigate to the dashboard.');
    expect(vtt).not.toContain('**');
  });

  it('produces blank lines between cue blocks', () => {
    const cues = [cue('a', 'One', 0, 30), cue('b', 'Two', 30, 30)];
    const vtt = generateWebVTT(cues, FPS);
    // Each cue block is separated by a blank line — the first cue must end with \n\n
    expect(vtt).toMatch(/One\n\n/);
    // The last cue ends the file with a single newline (trailing blank line not required by spec)
    expect(vtt).toContain('Two');
  });
});
