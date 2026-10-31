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
  guide?: { docType: string; categories: string[]; appliesTo?: string; verification: string };
}

export interface Knowledge {
  docsVersion: string;
  nodes: Map<string, Node>;
  edges: Edge[];
  relationships: Record<string, RegistryRel>;
  text: Record<string, Record<string, { title: string; summary: string }>>;
  /** Authored node bodies (Markdown), keyed by node id. Not localised yet. */
  bodies: Record<string, { body: string }>;
}

export interface RelatedItem {
  id: string;
  title: string;
  kind: string;
  summary: string;
  type: string;
  /** True when the other node is the edge's source ("<other> is documented by this procedure"). */
  otherIsSource: boolean;
  /** Registry (English) label to use when the UI has no translation. */
  registryLabel: string;
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
      bodies: readBodies(dir),
    };
  } catch {
    return null;
  }
}

function readBodies(dir: string): Knowledge['bodies'] {
  try {
    return fs.readJsonSync(path.join(dir, 'graph/node-content.json')).nodes ?? {};
  } catch {
    return {};
  }
}

export interface GuideItem {
  id: string;
  /** URL segment: the part of the node id after "guide:". */
  slug: string;
  title: string;
  summary: string;
  docType: string;
  categories: string[];
  appliesTo?: string;
  verification: string;
  body: string;
}

/** Plain-text card blurb: Markdown markers removed, cut at a word boundary. */
export function blurb(md: string, max = 170): string {
  const t = md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/** Authored guides in title order, with their Markdown body. */
export function guidesFor(k: Knowledge, locale: string): GuideItem[] {
  const texts = k.text[locale] ?? k.text[Object.keys(k.text)[0]] ?? {};
  const out: GuideItem[] = [];
  for (const n of k.nodes.values()) {
    if (n.kind !== 'guide' || !n.guide) continue;
    out.push({
      id: n.id,
      slug: n.id.slice(n.id.indexOf(':') + 1),
      title: texts[n.id]?.title ?? n.id,
      summary: blurb(texts[n.id]?.summary ?? ''),
      docType: n.guide.docType,
      categories: n.guide.categories,
      appliesTo: n.guide.appliesTo,
      verification: n.guide.verification,
      body: k.bodies[n.id]?.body ?? '',
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
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
      type: e.type,
      otherIsSource: e.target === id,
      // Phrased with the other node first: "<Project> is documented by this procedure".
      registryLabel: e.source === id ? def.inverseLabel : def.label,
      verification: e.verification,
      evidence: e.evidence.map(describeEvidence),
    });
  }
  return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
}

/** Authored knowledge nodes as header-search entries, linking into the explorer. */
export function searchEntriesFor(
  k: Knowledge,
  locale: string,
  explorerUrl: (id: string) => string | null,
): { url: string; title: string; summary: string; kind: string }[] {
  const texts = k.text[locale] ?? {};
  const out = [];
  for (const n of k.nodes.values()) {
    const url = explorerUrl(n.id);
    if (n.origin !== 'authored' || !url) continue;
    out.push({
      url,
      title: texts[n.id]?.title ?? n.id,
      summary: texts[n.id]?.summary ?? '',
      kind: n.kind,
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** "<other> is documented by this procedure", localised where the UI has relationship labels. */
export function relationPhrase(
  item: RelatedItem,
  ui: { relationLabels: Record<string, [string, string]>; thisProcedure: string },
): string {
  const t = ui.relationLabels[item.type];
  const label = t ? t[item.otherIsSource ? 0 : 1] : item.registryLabel;
  return `${label} ${ui.thisProcedure}`;
}
