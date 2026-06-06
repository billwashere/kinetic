import type { DocPage, DocStep } from '../doc-extractor';
import type { Finding } from './types';

/**
 * Compares two skeleton arrays and returns structural findings.
 *
 * Severity rules:
 *   breaking — something that will cause a runtime failure in the pipeline
 *              (missing audio manifest key, locale lookup returning undefined)
 *   warning  — something that changes pipeline output in a potentially unintended way
 *              (step reordering desynchronises audio from video)
 *   info     — additive or neutral changes that don't break anything
 */
export function diffSkeletons(from: DocPage[], to: DocPage[]): Finding[] {
  const findings: Finding[] = [];

  const fromMap = new Map(from.map((p) => [p.pageId, p]));
  const toMap = new Map(to.map((p) => [p.pageId, p]));

  // Pages removed — breaking because audio manifests reference these page IDs
  for (const [pageId] of fromMap) {
    if (!toMap.has(pageId)) {
      findings.push({
        severity: 'breaking',
        category: 'structural',
        pageId,
        message: `Page removed: "${pageId}" — all audio manifest entries for this page will 404`,
      });
    }
  }

  // Pages added — informational, nothing breaks
  for (const [pageId] of toMap) {
    if (!fromMap.has(pageId)) {
      findings.push({
        severity: 'info',
        category: 'structural',
        pageId,
        message: `Page added: "${pageId}"`,
      });
    }
  }

  // Diff steps within every page that exists in both versions
  for (const [pageId, fromPage] of fromMap) {
    const toPage = toMap.get(pageId);
    if (!toPage) continue;
    findings.push(...diffSteps(pageId, fromPage.steps, toPage.steps));
  }

  return findings;
}

function diffSteps(pageId: string, fromSteps: DocStep[], toSteps: DocStep[]): Finding[] {
  const findings: Finding[] = [];

  const fromMap = new Map(fromSteps.map((s) => [s.stepId, s]));
  const toMap = new Map(toSteps.map((s) => [s.stepId, s]));

  // Steps removed — breaking: the audio manifest key "<locale>_<pageId>_<stepId>"
  // will be absent, causing the video compositor to render silence and a missing subtitle
  for (const [stepId] of fromMap) {
    if (!toMap.has(stepId)) {
      findings.push({
        severity: 'breaking',
        category: 'structural',
        pageId,
        stepId,
        message: `Step removed: "${stepId}" from page "${pageId}"`,
      });
    }
  }

  // Steps added — informational
  for (const [stepId] of toMap) {
    if (!fromMap.has(stepId)) {
      findings.push({
        severity: 'info',
        category: 'structural',
        pageId,
        stepId,
        message: `Step added: "${stepId}" to page "${pageId}"`,
      });
    }
  }

  // Step order — warning: if the narration order changes, the audio track will
  // play in the wrong sequence relative to the visual recording
  const fromOrder = fromSteps.map((s) => s.stepId).filter((id) => toMap.has(id));
  const toOrder = toSteps.map((s) => s.stepId).filter((id) => fromMap.has(id));

  if (JSON.stringify(fromOrder) !== JSON.stringify(toOrder)) {
    findings.push({
      severity: 'warning',
      category: 'structural',
      pageId,
      message: `Step order changed in page "${pageId}" — audio sequence will be out of sync`,
      detail: { from: fromOrder, to: toOrder },
    });
  }

  // Per-step attribute checks for steps present in both versions
  for (const [stepId, fromStep] of fromMap) {
    const toStep = toMap.get(stepId);
    if (!toStep) continue;

    // Text key change — breaking: locale files won't have a matching entry for the new key
    if (fromStep.textKey !== toStep.textKey) {
      findings.push({
        severity: 'breaking',
        category: 'structural',
        pageId,
        stepId,
        message:
          `Text key changed for step "${stepId}": ` +
          `"${fromStep.textKey}" → "${toStep.textKey}" — locale lookups will return undefined`,
        detail: { from: fromStep.textKey, to: toStep.textKey },
      });
    }

    // Step type change — warning: affects how the Astro portal renders the step
    if (fromStep.type !== toStep.type) {
      findings.push({
        severity: 'warning',
        category: 'structural',
        pageId,
        stepId,
        message: `Step type changed for "${stepId}": ${fromStep.type} → ${toStep.type}`,
        detail: { from: fromStep.type, to: toStep.type },
      });
    }
  }

  return findings;
}
