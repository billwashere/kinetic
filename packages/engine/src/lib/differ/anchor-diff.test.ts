import { describe, it, expect } from 'vitest';
import { diffAnchors, maxBoxDelta, type BoundingBox } from './anchor-diff';
import type { DocPage } from '../doc-extractor';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const THRESHOLDS = { warnPx: 20, breakPx: 100 };

function makePage(
  pageId: string,
  steps: Array<{ stepId: string; anchor: BoundingBox | null }>,
): DocPage {
  return {
    pageId,
    steps: steps.map((s) => ({
      type: 'action' as const,
      textKey: `key_${s.stepId}`,
      ...s,
    })),
  };
}

const BOX: BoundingBox = { x: 100, y: 200, width: 150, height: 40 };

// ─── maxBoxDelta ──────────────────────────────────────────────────────────────

describe('maxBoxDelta', () => {
  it('returns 0 for identical boxes', () => {
    expect(maxBoxDelta(BOX, BOX)).toBe(0);
  });

  it('returns the x delta when x changes most', () => {
    expect(maxBoxDelta(BOX, { ...BOX, x: BOX.x + 50 })).toBe(50);
  });

  it('returns the y delta when y changes most', () => {
    expect(maxBoxDelta(BOX, { ...BOX, y: BOX.y + 30 })).toBe(30);
  });

  it('returns the larger delta when multiple dimensions change', () => {
    // x changes by 10, y changes by 25 — expect 25
    expect(maxBoxDelta(BOX, { ...BOX, x: BOX.x + 10, y: BOX.y + 25 })).toBe(25);
  });

  it('handles width and height changes', () => {
    expect(maxBoxDelta(BOX, { ...BOX, width: BOX.width + 60, height: BOX.height + 5 })).toBe(60);
  });
});

// ─── Anchor state transitions ─────────────────────────────────────────────────

describe('diffAnchors — anchor state transitions', () => {
  it('emits no finding when both anchors are null', () => {
    const page = makePage('p', [{ stepId: 's', anchor: null }]);
    expect(diffAnchors([page], [page], THRESHOLDS)).toHaveLength(0);
  });

  it('emits info when anchor appears (was null, now has coordinates)', () => {
    const from = [makePage('p', [{ stepId: 's', anchor: null }])];
    const to = [makePage('p', [{ stepId: 's', anchor: BOX }])];
    const findings = diffAnchors(from, to, THRESHOLDS);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('appeared');
  });

  it('emits warning when anchor disappears (had coordinates, now null)', () => {
    const from = [makePage('p', [{ stepId: 's', anchor: BOX }])];
    const to = [makePage('p', [{ stepId: 's', anchor: null }])];
    const findings = diffAnchors(from, to, THRESHOLDS);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('disappeared');
  });

  it('emits no finding when anchor is identical', () => {
    const page = makePage('p', [{ stepId: 's', anchor: BOX }]);
    expect(diffAnchors([page], [page], THRESHOLDS)).toHaveLength(0);
  });
});

// ─── Threshold bands ──────────────────────────────────────────────────────────

describe('diffAnchors — threshold bands', () => {
  function driftPage(delta: number): [DocPage[], DocPage[]] {
    const from = [makePage('p', [{ stepId: 's', anchor: BOX }])];
    const to = [makePage('p', [{ stepId: 's', anchor: { ...BOX, x: BOX.x + delta } }])];
    return [from, to];
  }

  it('emits no finding for drift below the warn threshold', () => {
    const [from, to] = driftPage(THRESHOLDS.warnPx - 1); // 19px
    expect(diffAnchors(from, to, THRESHOLDS)).toHaveLength(0);
  });

  it('emits warning for drift at exactly the warn threshold', () => {
    const [from, to] = driftPage(THRESHOLDS.warnPx); // 20px
    const findings = diffAnchors(from, to, THRESHOLDS);
    expect(findings[0].severity).toBe('warning');
  });

  it('emits warning for drift between warn and break thresholds', () => {
    const [from, to] = driftPage(THRESHOLDS.breakPx - 1); // 99px
    const findings = diffAnchors(from, to, THRESHOLDS);
    expect(findings[0].severity).toBe('warning');
  });

  it('emits breaking for drift at exactly the break threshold', () => {
    const [from, to] = driftPage(THRESHOLDS.breakPx); // 100px
    const findings = diffAnchors(from, to, THRESHOLDS);
    expect(findings[0].severity).toBe('breaking');
  });

  it('emits breaking for drift above the break threshold', () => {
    const [from, to] = driftPage(THRESHOLDS.breakPx + 50); // 150px
    const findings = diffAnchors(from, to, THRESHOLDS);
    expect(findings[0].severity).toBe('breaking');
  });

  it('includes the delta and thresholds in the finding detail', () => {
    const [from, to] = driftPage(THRESHOLDS.breakPx);
    const findings = diffAnchors(from, to, THRESHOLDS);
    expect(findings[0].detail).toMatchObject({
      delta: THRESHOLDS.breakPx,
      threshold: THRESHOLDS.breakPx,
    });
  });
});

// ─── Multi-step / multi-page ──────────────────────────────────────────────────

describe('diffAnchors — multi-step and multi-page', () => {
  it('emits findings for all drifted steps across multiple pages', () => {
    const from = [
      makePage('page_a', [
        { stepId: 'step_1', anchor: BOX },
        { stepId: 'step_2', anchor: BOX },
      ]),
      makePage('page_b', [{ stepId: 'step_3', anchor: BOX }]),
    ];

    const drifted = { ...BOX, x: BOX.x + 200 }; // 200px — breaking
    const to = [
      makePage('page_a', [
        { stepId: 'step_1', anchor: drifted },
        { stepId: 'step_2', anchor: BOX }, // unchanged
      ]),
      makePage('page_b', [{ stepId: 'step_3', anchor: drifted }]),
    ];

    const findings = diffAnchors(from, to, THRESHOLDS);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'breaking')).toBe(true);
    expect(findings.map((f) => f.stepId).sort()).toEqual(['step_1', 'step_3']);
  });

  it('skips pages that only exist in one version (those are handled by skeleton-diff)', () => {
    const from = [makePage('only_in_from', [{ stepId: 's', anchor: BOX }])];
    const to = [makePage('only_in_to', [{ stepId: 's', anchor: BOX }])];
    // Neither page is shared, so anchor-diff should produce no findings
    expect(diffAnchors(from, to, THRESHOLDS)).toHaveLength(0);
  });
});
