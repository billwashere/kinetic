import type { DocPage } from './doc-extractor';
import type { AudioManifest } from './manifest-reader';
import type { LocaleData } from '../engine/locale-schema';

export interface CorpusRecord {
  version: string;
  locale: string;
  pageId: string;
  pageTitle: string;
  stepIndex: number;
  stepId: string;
  stepType: 'action' | 'assertion' | 'note';
  text: string;
  durationSeconds: number | null;
  anchor: { x: number; y: number; width: number; height: number } | null;
}

function resolveStepText(
  step: { stepId: string; textKey?: string },
  locale: string,
  pageId: string,
  localeData: LocaleData,
  manifest: AudioManifest | null,
): string {
  const key = `${locale}_${pageId}_${step.stepId}`;
  const fromManifest = manifest?.[key]?.text;
  if (fromManifest) return fromManifest;
  if (step.textKey) return localeData.strings[step.textKey] ?? step.stepId;
  return step.stepId;
}

/**
 * Generates a Markdown page from a DocPage and its locale data.
 *
 * Step ordering:
 *   action/assertion → numbered list (assertions prefixed with ✓)
 *   note             → blockquote with "Note:" label, outside the numbered list
 *   comment          → stripped (should be absent post-flushDocs; guarded anyway)
 *
 * Text resolution priority: manifest entry text → locale string → stepId fallback.
 */
export function generateMarkdownPage(
  page: DocPage,
  localeData: LocaleData,
  manifest: AudioManifest | null,
  locale: string,
): string {
  const pageData = localeData.pages[page.pageId];
  const title = pageData?.title ?? page.pageId;
  const description = pageData?.description ?? '';
  const breadcrumbs = pageData?.breadcrumbs ?? [];

  const lines: string[] = [];
  lines.push(`# ${title}`, '');

  if (breadcrumbs.length > 0) {
    lines.push(`> ${breadcrumbs.join(' > ')}`, '');
  }

  if (description) {
    lines.push(description, '');
  }

  lines.push('---', '');

  let stepNum = 0;
  for (const step of page.steps) {
    if (step.type === 'comment') continue;

    const text = resolveStepText(step, locale, page.pageId, localeData, manifest);

    if (step.type === 'note') {
      lines.push(`> **Note:** ${text}`, '');
    } else {
      stepNum++;
      const prefix = step.type === 'assertion' ? `${stepNum}. ✓` : `${stepNum}.`;
      lines.push(`${prefix} ${text}`);
    }
  }

  if (stepNum > 0) lines.push('');

  return lines.join('\n');
}

/**
 * Returns one CorpusRecord per non-comment step — suited for JSONL export.
 * durationSeconds is null for steps with no audio manifest entry (e.g. unvoiced assertions).
 */
export function generateCorpusLines(
  page: DocPage,
  localeData: LocaleData,
  manifest: AudioManifest | null,
  locale: string,
  version: string,
): CorpusRecord[] {
  const pageTitle = localeData.pages[page.pageId]?.title ?? page.pageId;
  const records: CorpusRecord[] = [];
  let stepIndex = 0;

  for (const step of page.steps) {
    if (step.type === 'comment') continue;

    const text = resolveStepText(step, locale, page.pageId, localeData, manifest);
    const manifestEntry = manifest?.[`${locale}_${page.pageId}_${step.stepId}`] ?? null;

    records.push({
      version,
      locale,
      pageId: page.pageId,
      pageTitle,
      stepIndex: stepIndex++,
      stepId: step.stepId,
      stepType: step.type,
      text,
      durationSeconds: manifestEntry ? manifestEntry.duration : null,
      anchor: step.anchor ?? null,
    });
  }

  return records;
}
