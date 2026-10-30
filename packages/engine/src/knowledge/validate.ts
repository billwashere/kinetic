import {
  RELATIONSHIPS,
  isNodeKind,
  isRelationshipType,
  type NodeKind,
  type RelationshipType,
  type Verification,
} from './registry';
import type { Evidence } from './schema';
import type {
  Diagnostic,
  Graph,
  GraphEdge,
  GraphNode,
  KnowledgeInput,
  LocalizedText,
  ValidationResult,
} from './model';

export const WIKILINK_RE = /\[\[([a-z]+:[a-z0-9_-]+)\]\]/g;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function validateKnowledge(input: KnowledgeInput): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  const err = (code: string, message: string, file?: string, nodeId?: string) =>
    diagnostics.push({ severity: 'error', code, message, file, nodeId });
  const warn = (code: string, message: string, file?: string, nodeId?: string) =>
    diagnostics.push({ severity: 'warning', code, message, file, nodeId });

  const pages = new Map(input.skeleton.map((p) => [p.pageId, p]));
  const nodes = new Map<string, GraphNode>();
  const kindOf = new Map<string, NodeKind>();

  // ── Derived nodes: every skeleton page is a procedure. Not authored, so no orphan warnings. ──
  for (const page of [...input.skeleton].sort((a, b) => a.pageId.localeCompare(b.pageId))) {
    const id = `procedure:${page.pageId}`;
    nodes.set(id, {
      id,
      kind: 'procedure',
      origin: 'derived',
      source: `skeleton:${page.pageId}`,
      aliases: [],
      pageId: page.pageId,
    });
    kindOf.set(id, 'procedure');
  }

  // ── Authored nodes: identity, kind, uniqueness ──
  const authored = [...input.nodes].sort(
    (a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file),
  );
  const accepted: typeof authored = [];
  for (const n of authored) {
    const prefix = n.id.slice(0, n.id.indexOf(':'));
    if (!isNodeKind(n.kind)) {
      err('invalid-kind', `kind "${n.kind}" is not a registered node kind`, n.file, n.id);
      continue;
    }
    if (prefix !== n.kind) {
      err(
        'id-kind-mismatch',
        `id prefix "${prefix}" does not match kind "${n.kind}"`,
        n.file,
        n.id,
      );
      continue;
    }
    if (nodes.has(n.id)) {
      const prior = nodes.get(n.id)!;
      err(
        'duplicate-id',
        prior.origin === 'derived'
          ? `id collides with the node derived from skeleton page "${prior.pageId}"`
          : `id is already defined in ${prior.source}`,
        n.file,
        n.id,
      );
      continue;
    }
    nodes.set(n.id, {
      id: n.id,
      kind: n.kind,
      origin: 'authored',
      source: n.file,
      aliases: [...n.aliases].sort(),
      ...(n.guide && {
        guide: {
          docType: n.guide.docType,
          categories: n.guide.categories,
          appliesTo: n.guide.appliesTo,
          verification: n.guide.verification.status,
        },
      }),
    });
    kindOf.set(n.id, n.kind);
    accepted.push(n);
  }

  // ── Conflicting definitions: same kind, same normalised title/alias, different id ──
  const labels = new Map<string, string>();
  for (const n of accepted) {
    for (const label of [n.title, ...n.aliases]) {
      const key = `${n.kind}|${norm(label)}`;
      const other = labels.get(key);
      if (other && other !== n.id) {
        warn(
          'conflicting-definition',
          `"${label}" also names ${other}; are these the same ${n.kind}?`,
          n.file,
          n.id,
        );
      } else labels.set(key, n.id);
    }
  }

  // ── Evidence resolution ──
  const resolveEvidence = (e: Evidence, n: { file: string; id: string }, ctx: string): boolean => {
    if (e.type === 'authored') return true;
    if (e.type === 'playwright-step') {
      const page = pages.get(e.page!);
      if (!page) {
        err('evidence-unresolved', `${ctx}: skeleton has no page "${e.page}"`, n.file, n.id);
        return false;
      }
      if (!page.steps.some((s) => s.stepId === e.step)) {
        err(
          'evidence-unresolved',
          `${ctx}: page "${e.page}" has no step "${e.step}"`,
          n.file,
          n.id,
        );
        return false;
      }
      return true;
    }
    const r = input.checkFile(e.path!, e.symbol);
    if (r === 'missing-file')
      err('evidence-unresolved', `${ctx}: file "${e.path}" does not exist`, n.file, n.id);
    if (r === 'missing-symbol')
      err('evidence-unresolved', `${ctx}: "${e.symbol}" not found in "${e.path}"`, n.file, n.id);
    return r === 'ok';
  };

  // ── Edges ──
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const n of accepted) {
    n.evidence.forEach((e, i) => resolveEvidence(e, n, `evidence[${i}]`));

    n.relationships.forEach((r, i) => {
      const ctx = `relationships[${i}] (${r.type} -> ${r.target})`;
      if (!isRelationshipType(r.type)) {
        err(
          'invalid-relationship-type',
          `${ctx}: "${r.type}" is not registered (known: ${Object.keys(RELATIONSHIPS).join(', ')})`,
          n.file,
          n.id,
        );
        return;
      }
      const def = RELATIONSHIPS[r.type];
      const targetKind = kindOf.get(r.target);
      if (!targetKind) {
        err('missing-target', `${ctx}: target node does not exist`, n.file, n.id);
        return;
      }
      if (r.target === n.id) {
        err('self-relationship', `${ctx}: a node cannot relate to itself`, n.file, n.id);
        return;
      }
      const sourceKind = n.kind as NodeKind;
      if (
        !(def.from as readonly string[]).includes(sourceKind) ||
        !(def.to as readonly string[]).includes(targetKind)
      ) {
        err(
          'invalid-relationship-target',
          `${ctx}: "${r.type}" runs ${def.from.join('|')} -> ${def.to.join('|')}, not ${sourceKind} -> ${targetKind}`,
          n.file,
          n.id,
        );
        return;
      }

      // Symmetric edges are stored once, in canonical id order.
      let [source, target] = [n.id, r.target];
      if (def.symmetric && source > target) [source, target] = [target, source];
      const key = `${source}|${r.type}|${target}`;
      if (seen.has(key)) {
        warn(
          'duplicate-relationship',
          `${ctx}: already declared${def.symmetric ? ' (symmetric edges count in both directions)' : ''}`,
          n.file,
          n.id,
        );
        return;
      }
      seen.add(key);

      const resolved = r.evidence.map((e, j) => resolveEvidence(e, n, `${ctx} evidence[${j}]`));
      const machine = r.evidence.filter((e, j) => e.type !== 'authored' && resolved[j]);
      let verification: Verification = 'unevidenced';
      if (machine.length > 0) verification = 'verified';
      else if (r.evidence.some((e) => e.type === 'authored')) verification = 'asserted';

      if (def.evidence === 'required' && machine.length === 0) {
        err(
          'evidence-required',
          `${ctx}: "${r.type}" requires at least one machine-checkable evidence entry (playwright-step or file)`,
          n.file,
          n.id,
        );
      } else if (def.evidence === 'recommended' && r.evidence.length === 0) {
        warn('evidence-recommended', `${ctx}: no evidence attached`, n.file, n.id);
      }

      edges.push({
        source,
        type: r.type,
        target,
        origin: 'authored',
        verification,
        evidence: r.evidence,
      });
    });
  }
  edges.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.type.localeCompare(b.type) ||
      a.target.localeCompare(b.target),
  );

  // ── Cycles in acyclic relationship types ──
  for (const type of Object.keys(RELATIONSHIPS) as RelationshipType[]) {
    if (!RELATIONSHIPS[type].acyclic) continue;
    const adj = new Map<string, string[]>();
    for (const e of edges)
      if (e.type === type) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const visit = (id: string): void => {
      state.set(id, 1);
      stack.push(id);
      for (const next of adj.get(id) ?? []) {
        if (state.get(next) === 1) {
          const cycle = [...stack.slice(stack.indexOf(next)), next].join(' -> ');
          err(
            'relationship-cycle',
            `"${type}" must be acyclic but forms a cycle: ${cycle}`,
            nodes.get(next)?.source,
            next,
          );
        } else if (!state.has(next)) visit(next);
      }
      stack.pop();
      state.set(id, 2);
    };
    for (const id of [...adj.keys()].sort()) if (!state.has(id)) visit(id);
  }

  // ── Body wiki-links and orphans ──
  const touched = new Set(edges.flatMap((e) => [e.source, e.target]));
  for (const n of accepted) {
    for (const m of n.body.matchAll(WIKILINK_RE)) {
      if (!nodes.has(m[1]))
        err('broken-link', `body links to [[${m[1]}]] which does not exist`, n.file, n.id);
      else (touched.add(m[1]), touched.add(n.id));
    }
  }
  for (const n of accepted) {
    if (!touched.has(n.id))
      warn('orphan-node', 'node has no relationships and nothing links to it', n.file, n.id);
  }

  // ── Localisation: default-locale text is authoritative; locales may override per node ──
  const text: ValidationResult['text'] = {};
  const localeCodes = Object.keys(input.locales).sort();
  if (!input.locales[input.defaultLocale]) {
    err('missing-default-locale', `default locale "${input.defaultLocale}" has no locale file`);
  }
  for (const code of localeCodes) {
    const overrides = input.locales[code].knowledge ?? {};
    for (const id of Object.keys(overrides)) {
      if (!nodes.has(id) || nodes.get(id)!.origin !== 'authored') {
        err(
          'locale-unknown-node',
          `locale "${code}" has knowledge text for "${id}", which is not an authored node`,
          `content/locales/${code}.json`,
          id,
        );
      }
    }
    const out: Record<string, LocalizedText> = {};
    for (const node of nodes.values()) {
      const authoredNode = accepted.find((a) => a.id === node.id);
      let title: [string, string] | undefined;
      let summary: [string, string] | undefined;
      // Fallback policy: requested locale -> default locale -> authored/source text.
      const chain = code === input.defaultLocale ? [code] : [code, input.defaultLocale];
      for (const loc of chain) {
        const l = input.locales[loc];
        if (!l) continue;
        if (node.origin === 'authored') {
          title ??= l.knowledge?.[node.id]?.title ? [l.knowledge[node.id].title!, loc] : undefined;
          summary ??= l.knowledge?.[node.id]?.summary
            ? [l.knowledge[node.id].summary!, loc]
            : undefined;
        } else {
          const p = l.pages[node.pageId!];
          title ??= p ? [p.title, loc] : undefined;
          summary ??= p ? [p.description, loc] : undefined;
        }
      }
      if (authoredNode) {
        title ??= [authoredNode.title, input.defaultLocale];
        summary ??= [authoredNode.summary, input.defaultLocale];
      } else if (!title && code === input.defaultLocale) {
        warn(
          'procedure-untitled',
          `skeleton page "${node.pageId}" has no title in default locale "${code}"; using the page id`,
          `content/locales/${code}.json`,
          node.id,
        );
      }
      const resolved: LocalizedText = {
        title: title?.[0] ?? node.pageId ?? node.id,
        titleFrom: title?.[1] ?? 'source',
        summary: summary?.[0] ?? '',
        summaryFrom: summary?.[1] ?? 'source',
      };
      out[node.id] = resolved;
      if (
        code !== input.defaultLocale &&
        node.origin === 'authored' &&
        resolved.titleFrom !== code
      ) {
        warn(
          'missing-translation',
          `no "${code}" text; falling back to "${resolved.titleFrom}"`,
          `content/locales/${code}.json`,
          node.id,
        );
      }
    }
    text[code] = out;
  }

  const graph: Graph = {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges,
  };
  const order = { error: 0, warning: 1 } as const;
  diagnostics.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.nodeId ?? '').localeCompare(b.nodeId ?? '') ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );
  return { diagnostics, graph, text };
}
