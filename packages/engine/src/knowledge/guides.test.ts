import { describe, expect, it } from 'vitest';
import { headingSlug, parseGuideFile, type GuideContext } from './guides';

const ctx = (extra: Record<string, string[]> = {}): GuideContext => ({
  anchors: new Map([
    ['g/a.md', new Set(['setup', '2-next-step'])],
    ...Object.entries(extra).map(([k, v]) => [k, new Set(v)] as const),
  ]),
  exists: (p) => p === 'g/readme.txt',
});

const doc = (fm: string, body: string) => `---\n${fm}\n---\n${body}`;
const codes = (r: ReturnType<typeof parseGuideFile>) => r.diagnostics.map((d) => d.code);

describe('headingSlug', () => {
  it('matches GitHub anchors', () => {
    expect(headingSlug('2. Next step')).toBe('2-next-step');
    expect(headingSlug('Variations, additional `services`')).toBe('variations-additional-services');
  });
});

describe('parseGuideFile', () => {
  it('derives id, title and summary', () => {
    const r = parseGuideFile(doc('type: explanation\nappliesTo: "1.0"', '# Parties\n\nA party is a counterparty.\n'), 'g/a.md', ctx());
    expect(r.node?.id).toBe('guide:a');
    expect(r.node?.title).toBe('Parties');
    expect(r.node?.summary).toBe('A party is a counterparty.');
    expect(r.node?.guide?.docType).toBe('explanation');
  });

  it('turns related and follows into edges', () => {
    const r = parseGuideFile(doc('type: how-to\nfollows: [guide:x]\nrelated: [guide:y]', '# T\n\nBody.'), 'g/a.md', ctx());
    expect(r.node?.relationships.map((e) => e.type)).toEqual(['follows', 'related_to']);
  });

  it('rejects an unknown type and unknown fields', () => {
    expect(codes(parseGuideFile(doc('type: essay', '# T\n\nx'), 'g/a.md', ctx()))).toContain('invalid-frontmatter');
    expect(codes(parseGuideFile(doc('type: how-to\nbogus: 1', '# T\n\nx'), 'g/a.md', ctx()))).toContain('invalid-frontmatter');
  });

  it('errors on a verified claim without machine evidence', () => {
    const fm = 'type: explanation\nverification:\n  status: verified\n  reviewedAt: 2026-01-01';
    expect(codes(parseGuideFile(doc(fm, '# T\n\nx'), 'g/a.md', ctx()))).toContain('verified-without-evidence');
    const ok = `${fm}\nevidence:\n  - type: file\n    path: a.ts`;
    expect(codes(parseGuideFile(doc(ok, '# T\n\nx'), 'g/a.md', ctx()))).not.toContain('verified-without-evidence');
  });

  it('flags broken links and anchors but not external or existing ones', () => {
    const body = '# T\n\nSee [a](#setup), [b](#nope), [c](missing.md), [d](readme.txt), [e](https://x.test/y), [f](a.md#2-next-step).';
    const r = parseGuideFile(doc('type: explanation', body), 'g/a.md', ctx());
    expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code).sort()).toEqual(['broken-anchor', 'broken-link']);
  });

  it('ignores links inside code fences', () => {
    const body = '# T\n\nx\n\n```\n[a](missing.md)\n```\n';
    expect(codes(parseGuideFile(doc('type: explanation', body), 'g/a.md', ctx()))).not.toContain('broken-link');
  });

  it('flags vague link text and unexplained diagrams', () => {
    const body = '# T\n\nSee [here](https://x.test).\n\n```\nA ──► B\n```\n\n## Next\n';
    const c = codes(parseGuideFile(doc('type: explanation', body), 'g/a.md', ctx()));
    expect(c).toContain('vague-link-text');
    expect(c).toContain('diagram-no-text');
  });

  it('applies procedure gates to how-to guides only', () => {
    const body = '# Create a thing\n\nMake a draft.\n\n- Fill the form\n';
    const howTo = codes(parseGuideFile(doc('type: how-to', body), 'g/a.md', ctx()));
    for (const c of ['no-procedure', 'no-starting-point', 'no-outcome', 'no-verification', 'no-recovery'])
      expect(howTo).toContain(c);
    expect(howTo).toContain('draft-without-activation');
    const expl = codes(parseGuideFile(doc('type: explanation', body), 'g/a.md', ctx()));
    expect(expl).not.toContain('no-procedure');
  });

  it('accepts a complete procedure', () => {
    const body = `# Do it\n\n1. Open **Settings → Things**.\n2. Select **Save**, then **Activate**.\n\nVerify that the status shows Active. If it does not, check the prerequisites.\n`;
    const fm = 'type: how-to\noutcome: A thing is active.\nappliesTo: "1.0"';
    expect(parseGuideFile(doc(fm, body), 'g/a.md', ctx()).diagnostics.filter((d) => d.code !== 'unverified-ui-labels')).toEqual([]);
  });
});
