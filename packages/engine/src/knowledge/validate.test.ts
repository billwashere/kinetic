import { describe, it, expect } from 'vitest';
import { parseNodeFile } from './loader';
import { validateKnowledge } from './validate';
import type { KnowledgeInput, ParsedNode } from './model';

const node = (over: Partial<ParsedNode> & { id: string }): ParsedNode => ({
  file: `content/knowledge/${over.id.replace(':', '-')}.md`,
  kind: over.id.split(':')[0],
  title: over.id,
  summary: 's',
  aliases: [],
  relationships: [],
  evidence: [],
  body: '',
  ...over,
});

const base = (nodes: ParsedNode[], extra: Partial<KnowledgeInput> = {}): KnowledgeInput => ({
  nodes,
  skeleton: [{ pageId: 'create_project', steps: [{ type: 'action', stepId: 'submit' }] }],
  locales: {
    'en-US': { pages: { create_project: { title: 'Create', description: 'd' } } },
    'ar-AE': { pages: {}, knowledge: {} },
  },
  defaultLocale: 'en-US',
  checkFile: () => 'ok',
  ...extra,
});

const codes = (i: KnowledgeInput) =>
  validateKnowledge(i).diagnostics.map((d) => `${d.severity}:${d.code}`);

describe('parseNodeFile', () => {
  it('parses frontmatter and body', () => {
    const r = parseNodeFile(
      '---\nid: concept:a\nkind: concept\ntitle: A\nsummary: S\n---\n\nBody [[concept:b]]\n',
      'a.md',
    );
    expect(r.node?.body).toBe('Body [[concept:b]]');
    expect(r.diagnostics).toEqual([]);
  });
  it('reports malformed YAML and missing delimiters with the file', () => {
    expect(parseNodeFile('no frontmatter', 'x.md').diagnostics[0]).toMatchObject({
      code: 'malformed-frontmatter',
      file: 'x.md',
    });
    expect(parseNodeFile('---\nid: [unclosed\n---\n', 'y.md').diagnostics[0].code).toBe(
      'malformed-frontmatter',
    );
  });
  it('rejects bad ids, unknown fields and missing required properties', () => {
    const r = parseNodeFile(
      '---\nid: Invoice Approval\nkind: concept\ntitle: T\nsurprise: 1\n---\n',
      'z.md',
    );
    const msgs = r.diagnostics.map((d) => d.message).join('\n');
    expect(msgs).toMatch(/id:/);
    expect(msgs).toMatch(/summary/);
    expect(msgs).toMatch(/surprise|Unrecognized/);
  });
  it('requires evidence fields to match their type', () => {
    const r = parseNodeFile(
      '---\nid: concept:a\nkind: concept\ntitle: A\nsummary: S\nevidence:\n  - type: playwright-step\n    page: p\n---\n',
      'e.md',
    );
    expect(r.diagnostics.some((d) => /needs "page" and "step"/.test(d.message))).toBe(true);
  });
});

describe('validateKnowledge', () => {
  it('accepts a minimal valid graph and derives procedure nodes from the skeleton', () => {
    const v = validateKnowledge(
      base([
        node({
          id: 'concept:a',
          relationships: [
            {
              type: 'documented_by',
              target: 'procedure:create_project',
              evidence: [{ type: 'playwright-step', page: 'create_project', step: 'submit' }],
            },
          ],
        }),
      ]),
    );
    expect(v.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(v.graph.nodes.map((n) => [n.id, n.origin])).toEqual([
      ['concept:a', 'authored'],
      ['procedure:create_project', 'derived'],
    ]);
    expect(v.graph.edges[0].verification).toBe('verified');
  });

  it('flags duplicate ids, kind mismatches, and collisions with derived nodes', () => {
    const c = codes(
      base([
        node({ id: 'concept:a' }),
        node({ id: 'concept:a', file: 'other.md' }),
        node({ id: 'concept:b', kind: 'feature' }),
        node({ id: 'procedure:create_project' }),
      ]),
    );
    expect(c).toContain('error:duplicate-id');
    expect(c).toContain('error:id-kind-mismatch');
    expect(c.filter((x) => x === 'error:duplicate-id')).toHaveLength(2);
  });

  it('rejects unknown kinds and relationship types, missing targets, and bad type constraints', () => {
    const c = codes(
      base([
        node({ id: 'concept:a', kind: 'widget' }),
        node({
          id: 'feature:f',
          relationships: [
            { type: 'loves', target: 'feature:f2', evidence: [] },
            { type: 'depends_on', target: 'feature:ghost', evidence: [] },
            { type: 'implements', target: 'feature:f2', evidence: [] },
          ],
        }),
        node({ id: 'feature:f2' }),
      ]),
    );
    expect(c).toEqual(
      expect.arrayContaining([
        'error:invalid-kind',
        'error:invalid-relationship-type',
        'error:missing-target',
        'error:invalid-relationship-target',
      ]),
    );
  });

  it('requires machine-checkable evidence where the registry says so; prose alone does not verify', () => {
    const rel = (evidence: never[] | object[]) =>
      base([
        node({
          id: 'concept:a',
          relationships: [
            {
              type: 'documented_by',
              target: 'procedure:create_project',
              evidence: evidence as never,
            },
          ],
        }),
      ]);
    expect(codes(rel([]))).toContain('error:evidence-required');
    expect(codes(rel([{ type: 'authored', description: 'trust me' }]))).toContain(
      'error:evidence-required',
    );
    const soft = validateKnowledge(
      base([
        node({
          id: 'feature:f',
          relationships: [
            {
              type: 'depends_on',
              target: 'feature:g',
              evidence: [{ type: 'authored', description: 'x' }],
            },
          ],
        }),
        node({ id: 'feature:g' }),
      ]),
    );
    expect(soft.graph.edges[0].verification).toBe('asserted');
  });

  it('resolves playwright-step and file evidence against real sources', () => {
    const ev = (e: object) =>
      base([node({ id: 'concept:a', evidence: [e as never] })], {
        checkFile: (p, s) =>
          p !== 'a.ts' ? 'missing-file' : s === 'nope' ? 'missing-symbol' : 'ok',
      });
    expect(
      codes(ev({ type: 'playwright-step', page: 'create_project', step: 'submit' })),
    ).not.toContain('error:evidence-unresolved');
    expect(codes(ev({ type: 'playwright-step', page: 'create_project', step: 'gone' }))).toContain(
      'error:evidence-unresolved',
    );
    expect(codes(ev({ type: 'playwright-step', page: 'nopage', step: 'x' }))).toContain(
      'error:evidence-unresolved',
    );
    expect(codes(ev({ type: 'file', path: 'missing.ts' }))).toContain('error:evidence-unresolved');
    expect(codes(ev({ type: 'file', path: 'a.ts', symbol: 'nope' }))).toContain(
      'error:evidence-unresolved',
    );
    expect(codes(ev({ type: 'file', path: 'a.ts', symbol: 'ok' }))).not.toContain(
      'error:evidence-unresolved',
    );
  });

  it('detects cycles only in relationship types declared acyclic', () => {
    const ring = (type: string) =>
      base([
        node({ id: 'feature:a', relationships: [{ type, target: 'feature:b', evidence: [] }] }),
        node({ id: 'feature:b', relationships: [{ type, target: 'feature:a', evidence: [] }] }),
      ]);
    expect(codes(ring('depends_on'))).toContain('error:relationship-cycle');
    expect(codes(ring('uses'))).not.toContain('error:relationship-cycle');
  });

  it('stores symmetric edges once and warns on the duplicate', () => {
    const v = validateKnowledge(
      base([
        node({
          id: 'concept:a',
          relationships: [{ type: 'related_to', target: 'concept:b', evidence: [] }],
        }),
        node({
          id: 'concept:b',
          relationships: [{ type: 'related_to', target: 'concept:a', evidence: [] }],
        }),
      ]),
    );
    expect(v.graph.edges).toHaveLength(1);
    expect(v.diagnostics.map((d) => d.code)).toContain('duplicate-relationship');
  });

  it('warns (not errors) on orphans and conflicting definitions; errors on broken body links', () => {
    const v = validateKnowledge(
      base([
        node({ id: 'concept:a', title: 'Invoice', body: 'see [[concept:missing]]' }),
        node({ id: 'concept:b', title: ' invoice ' }),
      ]),
    );
    const by = (c: string) => v.diagnostics.find((d) => d.code === c)?.severity;
    expect(by('orphan-node')).toBe('warning');
    expect(by('conflicting-definition')).toBe('warning');
    expect(by('broken-link')).toBe('error');
  });

  it('applies the locale fallback policy and reports unknown locale keys', () => {
    const i = base([
      node({ id: 'concept:a', title: 'Source', summary: 'Src sum' }),
      node({ id: 'concept:b', title: 'B' }),
    ]);
    i.locales['ar-AE'].knowledge = {
      'concept:a': { title: 'مصدر' },
      'concept:zzz': { title: 'x' },
    };
    const v = validateKnowledge(i);
    expect(v.text['ar-AE']['concept:a']).toMatchObject({
      title: 'مصدر',
      titleFrom: 'ar-AE',
      summary: 'Src sum',
      summaryFrom: 'en-US',
    });
    expect(v.text['ar-AE']['concept:b'].titleFrom).toBe('en-US');
    expect(v.diagnostics.find((d) => d.code === 'locale-unknown-node')?.severity).toBe('error');
    expect(
      v.diagnostics.some((d) => d.code === 'missing-translation' && d.nodeId === 'concept:b'),
    ).toBe(true);
  });

  it('is deterministic regardless of input order', () => {
    const a = node({
      id: 'concept:a',
      relationships: [{ type: 'related_to', target: 'concept:b', evidence: [] }],
    });
    const b = node({ id: 'concept:b' });
    expect(JSON.stringify(validateKnowledge(base([a, b])))).toBe(
      JSON.stringify(validateKnowledge(base([b, a]))),
    );
  });
});
