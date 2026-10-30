import { describe, it, expect } from 'vitest';
import { buildSearchIndex, search, tokenize } from './search';
import { neighborhood, type QEdge } from './query';

describe('search', () => {
  const idx = buildSearchIndex('en-US', [
    {
      id: 'concept:project',
      kind: 'concept',
      title: 'Project',
      summary: 'A unit of work',
      aliases: ['Initiative'],
    },
    {
      id: 'feature:project-creation',
      kind: 'feature',
      title: 'Project creation',
      summary: 'Creating things',
      body: 'dashboard form',
    },
    {
      id: 'feature:authentication',
      kind: 'feature',
      title: 'Authentication',
      summary: 'Sign in with email',
    },
  ]);
  it('tokenises unicode text', () =>
    expect(tokenize('مساحة العمل, v2! a')).toEqual(['مساحة', 'العمل', 'v2']));
  it('ranks title matches above text matches and supports prefix + AND semantics', () => {
    expect(search(idx, 'proj').map((h) => h.doc.id)).toEqual([
      'concept:project',
      'feature:project-creation',
    ]);
    expect(search(idx, 'project creat').map((h) => h.doc.id)).toEqual(['feature:project-creation']);
    expect(search(idx, 'dashboard')[0].doc.id).toBe('feature:project-creation');
    expect(search(idx, 'initiative')[0].doc.id).toBe('concept:project');
  });
  it('filters by kind and returns nothing for no match', () => {
    expect(search(idx, 'project', { kinds: ['concept'] })).toHaveLength(1);
    expect(search(idx, 'zzzz')).toEqual([]);
  });
  it('builds identical bytes for the same docs in any order', () => {
    const docs = [
      { id: 'b', kind: 'k', title: 'B', summary: '' },
      { id: 'a', kind: 'k', title: 'A', summary: '' },
    ];
    expect(JSON.stringify(buildSearchIndex('x', docs))).toBe(
      JSON.stringify(buildSearchIndex('x', [...docs].reverse())),
    );
  });
});

describe('neighborhood', () => {
  const edges: QEdge[] = [
    { source: 'a', type: 'depends_on', target: 'b' },
    { source: 'b', type: 'depends_on', target: 'c' },
    { source: 'c', type: 'uses', target: 'd' },
    { source: 'x', type: 'related_to', target: 'a' },
  ];
  it('respects depth and direction', () => {
    expect(neighborhood(edges, 'a', { depth: 1, direction: 'out' }).nodes.map((n) => n.id)).toEqual(
      ['a', 'b'],
    );
    expect(neighborhood(edges, 'a', { depth: 2, direction: 'out' }).nodes.map((n) => n.id)).toEqual(
      ['a', 'b', 'c'],
    );
    expect(neighborhood(edges, 'b', { direction: 'in' }).nodes.map((n) => n.id)).toEqual([
      'b',
      'a',
    ]);
  });
  it('treats symmetric types as bidirectional even when direction=out', () => {
    expect(
      neighborhood(edges, 'a', { direction: 'out', symmetric: ['related_to'] }).nodes.map(
        (n) => n.id,
      ),
    ).toContain('x');
    expect(neighborhood(edges, 'a', { direction: 'out' }).nodes.map((n) => n.id)).not.toContain(
      'x',
    );
  });
  it('filters by relationship type and reports truncation', () => {
    expect(
      neighborhood(edges, 'a', { depth: 3, types: ['depends_on'] }).nodes.map((n) => n.id),
    ).toEqual(['a', 'b', 'c']);
    const t = neighborhood(edges, 'a', { depth: 3, maxNodes: 2 });
    expect(t.truncated).toBe(true);
    expect(t.nodes).toHaveLength(2);
    expect(
      t.edges.every((e) => [e.source, e.target].every((id) => t.nodes.some((n) => n.id === id))),
    ).toBe(true);
  });
});
