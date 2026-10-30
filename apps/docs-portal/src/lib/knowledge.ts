import fs from 'fs-extra';
import path from 'path';

/**
 * Reads the compiled knowledge files (dist/knowledge from `knowledge:compile`). The portal consumes the
 * published artefacts only — it never imports engine code — so the model stays independent of Astro.
 * When the files are absent the portal simply renders without a knowledge section.
 */

interface RegistryRel {
  label: string;
  inverseLabel: string;
}
interface Evidence {
  type: string;
  page?: string;
  step?: string;
  path?: string;
  symbol?: string;
  description?: string;
}
interface Edge {
  source: string;
  type: string;
  target: string;
  verification: string;
  evidence: Evidence[];
}
interface Node {
  id: string;
  kind: string;
  origin: string;
}

export interface Knowledge {
  docsVersion: string;
  nodes: Map<string, Node>;
  edges: Edge[];
  relationships: Record<string, RegistryRel>;
  text: Record<string, Record<string, { title: string; summary: string }>>;
}

export interface RelatedItem {
  id: string;
  title: string;
  kind: string;
  summary: string;
  /** Full phrase, e.g. "is documented by this procedure". */
  relation: string;
  verification: string;
  evidence: string[];
}

export function knowledgeDir(): string {
  return (
    process.env.KINETIC_KNOWLEDGE_DIR_COMPILED ??
    path.resolve('../../packages/engine/dist/knowledge')
  );
}

export function loadKnowledge(dir = knowledgeDir()): Knowledge | null {
  const read = (p: string) => fs.readJsonSync(path.join(dir, p));
  try {
    const compiled = read('compiled.json');
    const nodes = new Map<string, Node>(
      (read('graph/nodes.json').nodes as Node[]).map((n) => [n.id, n]),
    );
    const text: Knowledge['text'] = {};
    for (const f of fs.readdirSync(path.join(dir, 'content')).filter((x) => x.endsWith('.json'))) {
      text[path.basename(f, '.json')] = read(`content/${f}`).nodes;
    }
    return {
      docsVersion: compiled.docsVersion,
      nodes,
      edges: read('graph/edges.json').edges,
      relationships: read('registry.json').relationships,
      text,
    };
  } catch {
    return null;
  }
}

function describeEvidence(e: Evidence): string {
  const where =
    e.type === 'playwright-step'
      ? `${e.page} / ${e.step}`
      : e.type === 'file'
        ? `${e.path}${e.symbol ? ` ("${e.symbol}")` : ''}`
        : '';
  return [e.type, where, e.description].filter(Boolean).join(' — ');
}

/** Knowledge directly connected to a documentation page, in a stable order. */
export function relatedFor(
  k: Knowledge,
  version: string,
  locale: string,
  pageId: string,
): RelatedItem[] {
  // Evidence was checked against one docs version; do not claim it for others.
  if (version !== k.docsVersion) return [];
  const id = `procedure:${pageId}`;
  if (!k.nodes.has(id)) return [];
  const texts = k.text[locale] ?? k.text[Object.keys(k.text)[0]] ?? {};
  const items: RelatedItem[] = [];
  for (const e of k.edges) {
    if (e.source !== id && e.target !== id) continue;
    const otherId = e.source === id ? e.target : e.source;
    const other = k.nodes.get(otherId);
    const def = k.relationships[e.type];
    if (!other || !def) continue;
    const t = texts[otherId];
    items.push({
      id: otherId,
      title: t?.title ?? otherId,
      kind: other.kind,
      summary: t?.summary ?? '',
      // Phrased with the other node first: "<Project> is documented by this procedure".
      relation: `${e.source === id ? def.inverseLabel : def.label} this procedure`,
      verification: e.verification,
      evidence: e.evidence.map(describeEvidence),
    });
  }
  return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
}
