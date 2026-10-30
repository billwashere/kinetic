/**
 * Browser-safe search over the published index. No Node imports — the same module
 * builds the index at release time and queries it in the portal, an offline bundle, or a script.
 */

export interface SearchDoc {
  id: string;
  kind: string;
  title: string;
  summary: string;
}

export interface SearchIndex {
  schemaVersion: 1;
  locale: string;
  docs: SearchDoc[];
  /** token -> doc indexes, for title and alias tokens (weighted higher). */
  title: Record<string, number[]>;
  /** token -> doc indexes, for summary and body tokens. */
  text: Record<string, number[]>;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

function invert(entries: [number, string][]): Record<string, number[]> {
  const m = new Map<string, Set<number>>();
  for (const [idx, text] of entries) {
    for (const t of tokenize(text)) {
      if (!m.has(t)) m.set(t, new Set());
      m.get(t)!.add(idx);
    }
  }
  const out: Record<string, number[]> = {};
  for (const k of [...m.keys()].sort()) out[k] = [...m.get(k)!].sort((a, b) => a - b);
  return out;
}

export function buildSearchIndex(
  locale: string,
  docs: (SearchDoc & { aliases?: string[]; body?: string })[],
): SearchIndex {
  const sorted = [...docs].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    locale,
    docs: sorted.map(({ id, kind, title, summary }) => ({ id, kind, title, summary })),
    title: invert(sorted.map((d, i) => [i, [d.title, ...(d.aliases ?? [])].join(' ')])),
    text: invert(sorted.map((d, i) => [i, `${d.summary} ${d.body ?? ''}`])),
  };
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
}

/** Every query token must match (prefix match on each). Title hits outrank text hits. */
export function search(
  index: SearchIndex,
  query: string,
  opts: { kinds?: string[]; limit?: number } = {},
): SearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const scores = new Map<number, number>();

  tokens.forEach((tok, ti) => {
    const per = new Map<number, number>();
    const collect = (table: Record<string, number[]>, weight: number) => {
      for (const [term, ids] of Object.entries(table)) {
        // Exact matches beat prefix matches.
        const w = term === tok ? weight * 2 : term.startsWith(tok) ? weight : 0;
        if (w) for (const id of ids) per.set(id, Math.max(per.get(id) ?? 0, w));
      }
    };
    collect(index.title, 4);
    collect(index.text, 1);
    if (ti === 0) per.forEach((v, k) => scores.set(k, v));
    else
      for (const k of [...scores.keys()]) {
        if (per.has(k)) scores.set(k, scores.get(k)! + per.get(k)!);
        else scores.delete(k);
      }
  });

  return [...scores.entries()]
    .map(([i, score]) => ({ doc: index.docs[i], score }))
    .filter((h) => !opts.kinds || opts.kinds.includes(h.doc.kind))
    .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
    .slice(0, opts.limit ?? 20);
}
