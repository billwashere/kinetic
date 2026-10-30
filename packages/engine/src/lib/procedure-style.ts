/**
 * Procedure style checks based on the Microsoft Writing Style Guide ("Procedures and instructions").
 * Pure and heuristic: every finding is a warning for a writer to judge, never a build error.
 * Rules only run for English locales because they are phrased for English text.
 */

export interface StyleStep {
  type: string;
  stepId: string;
  textKey?: string;
}
export interface StylePage {
  pageId: string;
  steps: StyleStep[];
}
export interface StyleLocale {
  locale: string;
  pages: Record<string, { outcome?: string; done?: string }>;
  strings: Record<string, string>;
}

export interface StyleFinding {
  code: string;
  locale: string;
  pageId: string;
  stepId?: string;
  message: string;
}

export const MAX_STEPS = 7;

const plain = (md: string) => md.replace(/\*\*|__|[*_`]/g, '').trim();

const STEP_RULES: {
  code: string;
  applies: (t: string) => boolean;
  when: ('action' | 'assertion' | 'note')[];
  message: string;
}[] = [
  {
    code: 'use-select',
    applies: (t) => /\bclick(s|ed|ing)?\b/i.test(t),
    when: ['action'],
    message: 'Use "select" instead of "click" — it works for mouse, touch, and keyboard.',
  },
  {
    code: 'use-go-to',
    applies: (t) => /\bnavigate to\b/i.test(t),
    when: ['action', 'note'],
    message: 'Use "go to" instead of "navigate to".',
  },
  {
    code: 'no-please',
    applies: (t) => /\bplease\b/i.test(t),
    when: ['action', 'assertion', 'note'],
    message: 'Don\'t use "please" in instructions.',
  },
  {
    code: 'no-sequence-word',
    applies: (t) => /^(first|then|next|finally|now|lastly)\b/i.test(t),
    when: ['action'],
    message:
      "Don't start a numbered step with a sequence word; the step number already shows order.",
  },
  {
    code: 'imperative',
    applies: (t) => /^(you|the user|users)\b/i.test(t),
    when: ['action'],
    message: 'Start the step with an imperative verb (for example, "Enter", "Select", "Go to").',
  },
  {
    code: 'end-punctuation',
    applies: (t) => !/[.!?:]$/.test(t),
    when: ['action', 'assertion'],
    message: 'End each step with a period.',
  },
  {
    code: 'result-as-statement',
    applies: (t) => /^(notice|verify|check|ensure|make sure|confirm)\b/i.test(t),
    when: ['assertion'],
    message:
      'State the result as a fact ("A success message appears."), not as an instruction to look for it.',
  },
  {
    code: 'no-latin',
    applies: (t) => /\b(e\.g\.|i\.e\.|etc\.)/i.test(t),
    when: ['action', 'assertion', 'note'],
    message: 'Avoid "e.g.", "i.e.", and "etc."; use "for example", "that is", or a complete list.',
  },
];

export function lintProcedures(pages: StylePage[], locales: StyleLocale[]): StyleFinding[] {
  const out: StyleFinding[] = [];
  for (const loc of locales.filter((l) => l.locale.startsWith('en'))) {
    for (const page of pages) {
      const actions = page.steps.filter((s) => s.type === 'action');
      if (actions.length > MAX_STEPS) {
        out.push({
          code: 'too-many-steps',
          locale: loc.locale,
          pageId: page.pageId,
          message: `${actions.length} steps; try to keep a procedure to ${MAX_STEPS} or fewer, or split it.`,
        });
      }
      if (actions.length > 0 && !loc.pages[page.pageId]?.outcome && !loc.pages[page.pageId]?.done) {
        out.push({
          code: 'state-result',
          locale: loc.locale,
          pageId: page.pageId,
          message: 'Add an "outcome" or "done" statement so readers know what success looks like.',
        });
      }
      for (const step of page.steps) {
        if (step.type === 'comment' || !step.textKey) continue;
        const text = loc.strings[step.textKey];
        if (!text) continue;
        const t = plain(text);
        for (const rule of STEP_RULES) {
          if ((rule.when as string[]).includes(step.type) && rule.applies(t)) {
            out.push({
              code: rule.code,
              locale: loc.locale,
              pageId: page.pageId,
              stepId: step.stepId,
              message: rule.message,
            });
          }
        }
      }
    }
  }
  return out;
}
