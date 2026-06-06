import { describe, it, expect } from 'vitest';
import { interpolate } from './interpolate';

describe('interpolate', () => {
  // ── Basic linear mapping ───────────────────────────────────────────────────
  describe('linear mapping (2-point range)', () => {
    it('maps midpoint to output midpoint', () => {
      expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    });

    it('maps endpoints exactly', () => {
      expect(interpolate(0, [0, 10], [0, 100])).toBe(0);
      expect(interpolate(10, [0, 10], [0, 100])).toBe(100);
    });

    it('handles descending output range', () => {
      expect(interpolate(5, [0, 10], [100, 0])).toBe(50);
      expect(interpolate(0, [0, 10], [100, 0])).toBe(100);
      expect(interpolate(10, [0, 10], [100, 0])).toBe(0);
    });

    it('handles negative values', () => {
      expect(interpolate(-5, [-10, 0], [0, 100])).toBe(50);
    });
  });

  // ── Extrapolation: clamp ──────────────────────────────────────────────────
  describe('clamp extrapolation', () => {
    it('clamps left below input range', () => {
      expect(
        interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: 'clamp' }),
      ).toBe(0);
    });

    it('clamps right above input range', () => {
      expect(
        interpolate(15, [0, 10], [0, 100], { extrapolateRight: 'clamp' }),
      ).toBe(100);
    });

    it('clamps both sides', () => {
      const opts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
      expect(interpolate(-100, [0, 10], [0, 100], opts)).toBe(0);
      expect(interpolate(1000, [0, 10], [0, 100], opts)).toBe(100);
    });
  });

  // ── Extrapolation: extend (default) ───────────────────────────────────────
  describe('extend extrapolation (default)', () => {
    it('extends linearly below by default', () => {
      expect(interpolate(-5, [0, 10], [0, 100])).toBe(-50);
    });

    it('extends linearly above by default', () => {
      expect(interpolate(15, [0, 10], [0, 100])).toBe(150);
    });
  });

  // ── Extrapolation: identity ───────────────────────────────────────────────
  describe('identity extrapolation', () => {
    it('returns the value unchanged when out of range and identity', () => {
      expect(
        interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: 'identity' }),
      ).toBe(-5);
      expect(
        interpolate(42, [0, 10], [0, 100], { extrapolateRight: 'identity' }),
      ).toBe(42);
    });
  });

  // ── Multi-point ranges ────────────────────────────────────────────────────
  describe('multi-point ranges', () => {
    it('finds the correct segment in a 3-point range', () => {
      // Up-then-down "tent" function
      expect(interpolate(0, [0, 5, 10], [0, 100, 0])).toBe(0);
      expect(interpolate(2.5, [0, 5, 10], [0, 100, 0])).toBe(50);
      expect(interpolate(5, [0, 5, 10], [0, 100, 0])).toBe(100);
      expect(interpolate(7.5, [0, 5, 10], [0, 100, 0])).toBe(50);
      expect(interpolate(10, [0, 5, 10], [0, 100, 0])).toBe(0);
    });

    it('supports 4-point ranges', () => {
      expect(interpolate(15, [0, 10, 20, 30], [0, 50, 100, 0])).toBe(75);
    });
  });

  // ── Easing ────────────────────────────────────────────────────────────────
  describe('easing', () => {
    it('applies easing function within a segment', () => {
      // Quad ease-out should always be >= linear in [0,1]
      const easeOutQuad = (t: number) => t * (2 - t);
      const linear = interpolate(0.5, [0, 1], [0, 100]);
      const eased = interpolate(0.5, [0, 1], [0, 100], { easing: easeOutQuad });
      expect(eased).toBeGreaterThan(linear);
      expect(eased).toBe(75); // 0.5 * (2 - 0.5) = 0.75
    });
  });

  // ── Validation ────────────────────────────────────────────────────────────
  describe('input validation', () => {
    it('rejects mismatched range lengths', () => {
      expect(() => interpolate(5, [0, 10], [0, 50, 100])).toThrow(/same length/);
    });

    it('rejects ranges shorter than 2', () => {
      expect(() => interpolate(5, [0], [50])).toThrow(/at least 2/);
    });

    it('rejects non-monotonic input range', () => {
      expect(() => interpolate(5, [0, 10, 5], [0, 50, 100])).toThrow(/monotonically/);
    });
  });

  // ── Real-world usage from this project ───────────────────────────────────
  describe('project usage patterns', () => {
    it('SubtitleLayer fade-in clamping', () => {
      // From SubtitleLayer.tsx: opacity ramps 0→1 over `fade` frames at start
      const fade = 8;
      expect(interpolate(0, [0, fade], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })).toBe(0);
      expect(interpolate(4, [0, fade], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })).toBe(0.5);
      expect(interpolate(8, [0, fade], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })).toBe(1);
      expect(interpolate(100, [0, fade], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })).toBe(1);
    });
  });
});
