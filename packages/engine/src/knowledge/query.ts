/**
 * Bounded graph traversal over the published nodes/edges. Pure and browser-safe:
 * the explorer, CLI tools and AI-context exporters all call this instead of re-implementing
 * traversal, so the rendering library can change without touching the model.
 */

export interface QNode {
  id: string;
  kind: string;
}
export interface QEdge {
  source: string;
  type: string;
  target: string;
  verification?: string;
}

export interface NeighborhoodOptions {
  depth?: number;
  /** Restrict traversal to these relationship types. */
  types?: string[];
  direction?: 'out' | 'in' | 'both';
  /** Hard cap on returned nodes. Defaults are deliberately small. */
  maxNodes?: number;
  /** Symmetric relationship types, which always traverse both ways. */
  symmetric?: string[];
}

export interface Neighborhood {
  root: string;
  nodes: { id: string; depth: number }[];
  edges: QEdge[];
  /** True when maxNodes cut the traversal short — callers should offer "expand". */
  truncated: boolean;
}

export function neighborhood(
  edges: QEdge[],
  root: string,
  opts: NeighborhoodOptions = {},
): Neighborhood {
  const { depth = 1, types, direction = 'both', maxNodes = 25, symmetric = [] } = opts;
  const allowed = types ? new Set(types) : null;
  const sym = new Set(symmetric);

  const adj = new Map<string, QEdge[]>();
  const push = (id: string, e: QEdge) => adj.set(id, [...(adj.get(id) ?? []), e]);
  for (const e of edges) {
    if (allowed && !allowed.has(e.type)) continue;
    if (direction !== 'in' || sym.has(e.type)) push(e.source, e);
    if (direction !== 'out' || sym.has(e.type)) push(e.target, e);
  }

  const depthOf = new Map<string, number>([[root, 0]]);
  const picked = new Map<string, QEdge>();
  let truncated = false;
  let frontier = [root];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const incident = [...(adj.get(id) ?? [])].sort(
        (a, b) =>
          a.type.localeCompare(b.type) ||
          a.source.localeCompare(b.source) ||
          a.target.localeCompare(b.target),
      );
      for (const e of incident) {
        const other = e.source === id ? e.target : e.source;
        if (!depthOf.has(other)) {
          if (depthOf.size >= maxNodes) {
            truncated = true;
            continue;
          }
          depthOf.set(other, d);
          next.push(other);
        }
        picked.set(`${e.source}|${e.type}|${e.target}`, e);
      }
    }
    frontier = next;
  }

  return {
    root,
    nodes: [...depthOf.entries()]
      .map(([id, depth]) => ({ id, depth }))
      .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)),
    // Only keep edges whose endpoints both made the cut.
    edges: [...picked.values()].filter((e) => depthOf.has(e.source) && depthOf.has(e.target)),
    truncated,
  };
}
