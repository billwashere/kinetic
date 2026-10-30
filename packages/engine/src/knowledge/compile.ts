import { NODE_KINDS, RELATIONSHIPS, SCHEMA_VERSION } from './registry';
import { buildSearchIndex } from './search';
import { toDot } from './dot';
import { WIKILINK_RE } from './validate';
import type { ParsedNode, ValidationResult } from './model';

export type ArtifactMap = Map<string, string>;

const json = (v: unknown, compact = false) => JSON.stringify(v, null, compact ? 0 : 2) + '\n';

/**
 * Pure: validated graph -> published knowledge files, keyed by path relative to `knowledge/`.
 * Output depends only on its inputs — no timestamps, no absolute paths — so builds are reproducible.
 */
export function compileKnowledge(
  validation: ValidationResult,
  authored: ParsedNode[],
  dirOf: Record<string, 'ltr' | 'rtl'>,
  defaultLocale: string,
): ArtifactMap {
  const out: ArtifactMap = new Map();
  const { graph, text } = validation;

  out.set(
    'registry.json',
    json({ schemaVersion: SCHEMA_VERSION, nodeKinds: NODE_KINDS, relationships: RELATIONSHIPS }),
  );
  out.set('graph/nodes.json', json({ schemaVersion: SCHEMA_VERSION, nodes: graph.nodes }));
  out.set('graph/edges.json', json({ schemaVersion: SCHEMA_VERSION, edges: graph.edges }));

  const bodies: Record<string, { body: string; links: string[]; locale: string }> = {};
  for (const n of [...authored].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!graph.nodes.some((g) => g.id === n.id && g.origin === 'authored')) continue;
    bodies[n.id] = {
      body: n.body,
      links: [...new Set([...n.body.matchAll(WIKILINK_RE)].map((m) => m[1]))].sort(),
      // Bodies are not localised yet; say so rather than implying they are.
      locale: defaultLocale,
    };
  }
  out.set('graph/node-content.json', json({ schemaVersion: SCHEMA_VERSION, nodes: bodies }));

  for (const locale of Object.keys(text).sort()) {
    out.set(
      `content/${locale}.json`,
      json({
        schemaVersion: SCHEMA_VERSION,
        locale,
        dir: dirOf[locale] ?? 'ltr',
        nodes: text[locale],
      }),
    );
    const docs = graph.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: text[locale][n.id].title,
      summary: text[locale][n.id].summary,
      aliases: n.aliases,
      body: bodies[n.id]?.body,
    }));
    out.set(`search/search-index.${locale}.json`, json(buildSearchIndex(locale, docs), true));
  }

  out.set('diagrams/graph.dot', toDot(graph, text[defaultLocale] ?? {}));
  return out;
}
