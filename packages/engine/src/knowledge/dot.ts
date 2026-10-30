import { RELATIONSHIPS, type RelationshipType } from './registry';
import type { Graph, LocalizedText } from './model';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

/**
 * Generates Graphviz DOT from the canonical graph, so no one maintains a second diagram source.
 * Isolated derived procedures are omitted — they are not part of any authored claim.
 */
export function toDot(graph: Graph, text: Record<string, LocalizedText>): string {
  const used = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
  graph.nodes.filter((n) => n.origin === 'authored').forEach((n) => used.add(n.id));

  const lines = [
    'digraph knowledge {',
    '  rankdir=LR;',
    '  node [shape=box, fontname="Helvetica"];',
  ];
  for (const n of graph.nodes.filter((n) => used.has(n.id))) {
    const style = n.origin === 'derived' ? ', style=dashed' : '';
    lines.push(
      `  "${esc(n.id)}" [label="${esc(text[n.id]?.title ?? n.id)}\\n(${n.kind})"${style}];`,
    );
  }
  for (const e of graph.edges) {
    const def = RELATIONSHIPS[e.type as RelationshipType];
    const style = e.verification === 'verified' ? '' : ', style=dotted';
    const dir = def.symmetric ? ', dir=none' : '';
    lines.push(`  "${esc(e.source)}" -> "${esc(e.target)}" [label="${e.type}"${style}${dir}];`);
  }
  lines.push('}', '');
  return lines.join('\n');
}
