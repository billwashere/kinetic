import type { DocPage } from '../doc-extractor';
import type { Finding } from './types';

export type BoundingBox = { x: number; y: number; width: number; height: number };

export interface AnchorDiffThresholds {
  // Drifts at or above this value emit a warning — the highlight is visibly misaligned
  warnPx: number;
  // Drifts at or above this value are breaking — the highlight points at the wrong element
  breakPx: number;
}

export const DEFAULT_THRESHOLDS: AnchorDiffThresholds = {
  warnPx: parseInt(process.env.ANCHOR_WARN_PX ?? '20', 10),
  breakPx: parseInt(process.env.ANCHOR_FAIL_PX ?? '100', 10),
};

/**
 * Max delta across all four dimensions (x, y, width, height).
 * Using the max rather than a euclidean distance gives a more intuitive threshold:
 * "the element moved more than N pixels in any direction."
 */
export function maxBoxDelta(a: BoundingBox, b: BoundingBox): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  );
}

export function diffAnchors(
  from: DocPage[],
  to: DocPage[],
  thresholds: AnchorDiffThresholds = DEFAULT_THRESHOLDS,
): Finding[] {
  const findings: Finding[] = [];

  const fromMap = new Map(from.map((p) => [p.pageId, p]));
  const toMap = new Map(to.map((p) => [p.pageId, p]));

  for (const [pageId, fromPage] of fromMap) {
    const toPage = toMap.get(pageId);
    if (!toPage) continue; // already reported as removed by skeleton-diff

    const fromStepMap = new Map(fromPage.steps.map((s) => [s.stepId, s]));
    const toStepMap = new Map(toPage.steps.map((s) => [s.stepId, s]));

    for (const [stepId, fromStep] of fromStepMap) {
      const toStep = toStepMap.get(stepId);
      if (!toStep) continue; // already reported as removed by skeleton-diff

      const a = fromStep.anchor ?? null;
      const b = toStep.anchor ?? null;

      // Both null — element was never measurable, no change
      if (!a && !b) continue;

      // Anchor appeared — element is now measurable when it wasn't before
      if (!a && b) {
        findings.push({
          severity: 'info',
          category: 'anchor',
          pageId,
          stepId,
          message: `Anchor appeared for "${stepId}" — element was not measurable in ${fromStep.type} mode before`,
          detail: { to: b },
        });
        continue;
      }

      // Anchor disappeared — could mean element is off-screen or conditionally hidden
      if (a && !b) {
        findings.push({
          severity: 'warning',
          category: 'anchor',
          pageId,
          stepId,
          message: `Anchor disappeared for "${stepId}" — element may be off-screen or hidden; visual highlight will be absent`,
          detail: { from: a },
        });
        continue;
      }

      if (!a || !b) continue; // TypeScript narrowing

      const delta = maxBoxDelta(a, b);
      if (delta === 0) continue; // identical — no finding needed

      if (delta >= thresholds.breakPx) {
        findings.push({
          severity: 'breaking',
          category: 'anchor',
          pageId,
          stepId,
          message:
            `Anchor drifted ${delta}px for "${stepId}" (break threshold: ${thresholds.breakPx}px) — ` +
            `visual highlight will point at the wrong element`,
          detail: { from: a, to: b, delta, threshold: thresholds.breakPx },
        });
      } else if (delta >= thresholds.warnPx) {
        findings.push({
          severity: 'warning',
          category: 'anchor',
          pageId,
          stepId,
          message: `Anchor drifted ${delta}px for "${stepId}" (warn threshold: ${thresholds.warnPx}px)`,
          detail: { from: a, to: b, delta, threshold: thresholds.warnPx },
        });
      }
    }
  }

  return findings;
}
