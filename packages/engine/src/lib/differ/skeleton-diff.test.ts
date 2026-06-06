import { describe, it, expect } from 'vitest';
import { diffSkeletons } from './skeleton-diff';
import type { DocPage } from '../doc-extractor';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePage(pageId: string, steps: Partial<DocPage['steps'][number]>[] = []): DocPage {
  return {
    pageId,
    steps: steps.map((s, i) => ({
      type: 'action' as const,
      stepId: `step_${i}`,
      textKey: `key_${i}`,
      ...s,
    })),
  };
}

const baseStep = { type: 'action' as const, stepId: 'email', textKey: 'email_key', anchor: null };
const basePage = makePage('checkout', [baseStep]);

// ─── Page-level changes ───────────────────────────────────────────────────────

describe('diffSkeletons — pages', () => {
  it('returns no findings for identical skeletons', () => {
    expect(diffSkeletons([basePage], [basePage])).toHaveLength(0);
  });

  it('reports a breaking finding when a page is removed', () => {
    const findings = diffSkeletons([basePage], []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'breaking',
      category: 'structural',
      pageId: 'checkout',
    });
    expect(findings[0].message).toContain('removed');
  });

  it('reports an info finding when a page is added', () => {
    const findings = diffSkeletons([], [basePage]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'info',
      category: 'structural',
      pageId: 'checkout',
    });
    expect(findings[0].message).toContain('added');
  });

  it('handles multiple pages — removal and addition in the same diff', () => {
    const from = [makePage('old_page'), makePage('shared')];
    const to = [makePage('shared'), makePage('new_page')];
    const findings = diffSkeletons(from, to);

    const removed = findings.filter((f) => f.pageId === 'old_page');
    const added = findings.filter((f) => f.pageId === 'new_page');
    expect(removed[0].severity).toBe('breaking');
    expect(added[0].severity).toBe('info');
  });
});

// ─── Step-level changes ───────────────────────────────────────────────────────

describe('diffSkeletons — steps', () => {
  it('reports breaking when a step is removed', () => {
    const from = [makePage('checkout', [baseStep])];
    const to = [makePage('checkout', [])];
    const findings = diffSkeletons(from, to);
    expect(findings.some((f) => f.severity === 'breaking' && f.stepId === 'email')).toBe(true);
  });

  it('reports info when a step is added', () => {
    const from = [makePage('checkout', [])];
    const to = [makePage('checkout', [baseStep])];
    const findings = diffSkeletons(from, to);
    expect(findings.some((f) => f.severity === 'info' && f.stepId === 'email')).toBe(true);
  });

  it('reports warning when step order changes', () => {
    const stepA = { stepId: 'step_a', textKey: 'key_a', type: 'action' as const, anchor: null };
    const stepB = { stepId: 'step_b', textKey: 'key_b', type: 'action' as const, anchor: null };
    const from = [makePage('checkout', [stepA, stepB])];
    const to = [makePage('checkout', [stepB, stepA])];

    const findings = diffSkeletons(from, to);
    const orderFinding = findings.find(
      (f) => f.severity === 'warning' && f.message.includes('order'),
    );
    expect(orderFinding).toBeDefined();
    expect(orderFinding?.detail).toMatchObject({
      from: ['step_a', 'step_b'],
      to: ['step_b', 'step_a'],
    });
  });

  it('does not report order change when order is unchanged', () => {
    const stepA = { stepId: 'a', textKey: 'ka', type: 'action' as const, anchor: null };
    const stepB = { stepId: 'b', textKey: 'kb', type: 'action' as const, anchor: null };
    const skeleton = [makePage('p', [stepA, stepB])];
    const findings = diffSkeletons(skeleton, skeleton);
    expect(findings.filter((f) => f.message.includes('order'))).toHaveLength(0);
  });

  it('does not report order change when a step was added (new steps are excluded from order comparison)', () => {
    // Adding a new step at the end should not generate a spurious order warning
    const stepA = { stepId: 'a', textKey: 'ka', type: 'action' as const, anchor: null };
    const stepB = { stepId: 'b', textKey: 'kb', type: 'action' as const, anchor: null };
    const stepNew = { stepId: 'new', textKey: 'knew', type: 'action' as const, anchor: null };
    const from = [makePage('p', [stepA, stepB])];
    const to = [makePage('p', [stepA, stepB, stepNew])];
    const findings = diffSkeletons(from, to);
    expect(findings.filter((f) => f.message.includes('order'))).toHaveLength(0);
  });
});

// ─── Attribute-level changes ──────────────────────────────────────────────────

describe('diffSkeletons — step attributes', () => {
  it('reports breaking when a text key changes', () => {
    const from = [
      makePage('p', [{ stepId: 's', textKey: 'old_key', type: 'action', anchor: null }]),
    ];
    const to = [makePage('p', [{ stepId: 's', textKey: 'new_key', type: 'action', anchor: null }])];
    const findings = diffSkeletons(from, to);
    const textKeyFinding = findings.find((f) => f.message.includes('Text key'));
    expect(textKeyFinding?.severity).toBe('breaking');
    expect(textKeyFinding?.detail).toMatchObject({ from: 'old_key', to: 'new_key' });
  });

  it('reports warning when step type changes from action to assertion', () => {
    const from = [makePage('p', [{ stepId: 's', textKey: 'k', type: 'action', anchor: null }])];
    const to = [makePage('p', [{ stepId: 's', textKey: 'k', type: 'assertion', anchor: null }])];
    const findings = diffSkeletons(from, to);
    const typeFinding = findings.find((f) => f.message.includes('type'));
    expect(typeFinding?.severity).toBe('warning');
    expect(typeFinding?.detail).toMatchObject({ from: 'action', to: 'assertion' });
  });

  it('produces no findings for identical steps', () => {
    const step = { stepId: 's', textKey: 'k', type: 'action' as const, anchor: null };
    const skeleton = [makePage('p', [step])];
    expect(diffSkeletons(skeleton, skeleton)).toHaveLength(0);
  });
});

// ─── Multi-finding scenarios ──────────────────────────────────────────────────

describe('diffSkeletons — realistic multi-change scenarios', () => {
  it('detects multiple independent issues in the same diff', () => {
    const from = [
      makePage('create_project', [
        { stepId: 'login', textKey: 'login_key', type: 'action', anchor: null },
        { stepId: 'submit', textKey: 'submit_key', type: 'action', anchor: null },
      ]),
      makePage('old_page', []),
    ];

    const to = [
      makePage('create_project', [
        { stepId: 'login', textKey: 'login_key_RENAMED', type: 'action', anchor: null }, // text key changed
        { stepId: 'submit', textKey: 'submit_key', type: 'action', anchor: null },
        { stepId: 'new_confirm', textKey: 'confirm_key', type: 'assertion', anchor: null }, // added
      ]),
      makePage('new_page', []), // added
      // old_page removed
    ];

    const findings = diffSkeletons(from, to);

    const pageRemoved = findings.filter(
      (f) => f.pageId === 'old_page' && f.severity === 'breaking',
    );
    const pageAdded = findings.filter((f) => f.pageId === 'new_page' && f.severity === 'info');
    const textKeyChange = findings.filter(
      (f) => f.stepId === 'login' && f.message.includes('Text key'),
    );
    const stepAdded = findings.filter((f) => f.stepId === 'new_confirm' && f.severity === 'info');

    expect(pageRemoved).toHaveLength(1);
    expect(pageAdded).toHaveLength(1);
    expect(textKeyChange[0].severity).toBe('breaking');
    expect(stepAdded).toHaveLength(1);
  });
});
