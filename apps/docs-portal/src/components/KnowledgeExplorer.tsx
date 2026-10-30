import { useEffect, useId, useMemo, useState } from 'react';
// Pure, dependency-free modules shared with the standalone explorer and CLI tools — one traversal
// implementation. (For a git-subtree deployment, adjust this path along with the other engine paths.)
import { search, type SearchIndex } from '../../../../packages/engine/src/knowledge/search';
import { neighborhood } from '../../../../packages/engine/src/knowledge/query';

interface Edge {
  source: string;
  type: string;
  target: string;
  verification: string;
}
interface Data {
  edges: Edge[];
  kinds: Record<string, string>;
  text: Record<string, { title: string; summary: string }>;
  index: SearchIndex;
  rels: Record<string, { label: string; inverseLabel: string; symmetric: boolean }>;
}

/** Interface text, passed from the page so the island follows the portal's locale. */
export interface ExplorerLabels {
  exploreGraph: string;
  searchConcepts: string;
  searchResults: string;
  noResults: string;
  relationshipTypes: string;
  relationships: string;
  noRelationships: string;
  furtherOut: string;
  nothingFurther: string;
  expand: string;
  collapse: string;
  backToProcedure: string;
  loadingGraph: string;
  graphUnavailable: string;
  boundedSubset: string;
  verification: Record<string, string>;
  relationLabels: Record<string, [string, string]>;
}

interface Props {
  rootId: string;
  locale: string;
  /** URL of the published `knowledge/` directory, relative to this page. */
  dataBase: string;
  labels: ExplorerLabels;
}

const get = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

export default function KnowledgeExplorer({ rootId, locale, dataBase, labels: L }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(rootId);
  const [depth, setDepth] = useState(1);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const uid = useId();

  useEffect(() => {
    (async () => {
      try {
        const [nodes, edges, registry, content, index] = await Promise.all([
          get(`${dataBase}graph/nodes.json`),
          get(`${dataBase}graph/edges.json`),
          get(`${dataBase}registry.json`),
          get(`${dataBase}content/${locale}.json`),
          get(`${dataBase}search/search-index.${locale}.json`),
        ]);
        setData({
          edges: edges.edges,
          kinds: Object.fromEntries(
            nodes.nodes.map((n: { id: string; kind: string }) => [n.id, n.kind]),
          ),
          text: content.nodes,
          index,
          rels: registry.relationships,
        });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [dataBase, locale]);

  const view = useMemo(() => {
    if (!data) return null;
    const present = [
      ...new Set(
        data.edges.filter((e) => e.source === current || e.target === current).map((e) => e.type),
      ),
    ].sort();
    const types = present.filter((t) => !off.has(t));
    const symmetric = Object.entries(data.rels)
      .filter(([, d]) => d.symmetric)
      .map(([k]) => k);
    const hood = neighborhood(data.edges, current, { depth, types, symmetric });
    return { present, hood };
  }, [data, current, depth, off]);

  if (error) {
    return (
      <p className="text-xs text-slate-500" role="status">
        The interactive graph is unavailable here ({error}). The related knowledge above is still
        complete.
      </p>
    );
  }
  if (!data || !view)
    return (
      <p className="mt-4 text-xs text-slate-600 dark:text-slate-400" role="status">
        {L.loadingGraph}
      </p>
    );
  const relLabel = (type: string, forward: boolean) => {
    const t = L.relationLabels[type];
    const def = data.rels[type];
    return t ? t[forward ? 0 : 1] : forward ? def.label : def.inverseLabel;
  };

  const title = (id: string) => data.text[id]?.title ?? id;
  const hits = query.trim() ? search(data.index, query, { limit: 8 }) : [];
  const incident = view.hood.edges.filter((e) => e.source === current || e.target === current);
  const further = view.hood.nodes.filter((n) => n.depth > 1);

  const NodeButton = ({ id }: { id: string }) => (
    <button
      type="button"
      className="k-text-primary underline k-focus rounded"
      onClick={() => setCurrent(id)}
    >
      {title(id)}
    </button>
  );

  return (
    <section
      className="mt-6 rounded-xl border border-slate-200 p-5 dark:border-slate-800"
      aria-labelledby={`${uid}-h`}
    >
      <h3 id={`${uid}-h`} className="text-base font-bold text-slate-900 dark:text-white">
        {L.exploreGraph}
      </h3>

      <form
        role="search"
        className="mt-2 flex gap-2 items-end"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="text-sm text-slate-700 dark:text-slate-200">
          {L.searchConcepts}
          <input
            type="search"
            className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900 k-focus"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </form>
      {query.trim() && (
        <ul className="mt-2 text-sm list-none p-0" aria-label={L.searchResults}>
          {hits.length === 0 && <li>{L.noResults}</li>}
          {hits.map((h) => (
            <li key={h.doc.id}>
              <NodeButton id={h.doc.id} />{' '}
              <span className="text-xs text-slate-600 dark:text-slate-400">({h.doc.kind})</span>
            </li>
          ))}
        </ul>
      )}

      <h4 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">
        {title(current)}{' '}
        <span className="text-xs font-normal text-slate-600 dark:text-slate-400">
          ({data.kinds[current]})
        </span>
      </h4>
      <p className="text-sm text-slate-600 dark:text-slate-300">{data.text[current]?.summary}</p>

      {view.present.length > 0 && (
        <fieldset className="mt-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <legend className="px-1 text-xs text-slate-600 dark:text-slate-400">
            {L.relationshipTypes}
          </legend>
          {view.present.map((t) => (
            <label key={t} className="me-3 text-sm">
              <input
                type="checkbox"
                checked={!off.has(t)}
                onChange={() => {
                  const next = new Set(off);
                  next.has(t) ? next.delete(t) : next.add(t);
                  setOff(next);
                }}
              />{' '}
              {t}
            </label>
          ))}
        </fieldset>
      )}

      <ul
        className="mt-2 list-none space-y-1 p-0 text-sm text-slate-700 dark:text-slate-200"
        aria-label={L.relationships}
      >
        {incident.length === 0 && <li>{L.noRelationships}</li>}
        {incident.map((e) => {
          const def = data.rels[e.type];
          const out = e.source === current;
          const other = out ? e.target : e.source;
          return (
            <li key={`${e.source}|${e.type}|${e.target}`}>
              {relLabel(e.type, out || def.symmetric)} <NodeButton id={other} />{' '}
              <span className="text-xs text-slate-600 dark:text-slate-400">
                [{L.verification[e.verification] ?? e.verification}]
              </span>
            </li>
          );
        })}
      </ul>

      {depth > 1 && (
        <>
          <h4 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
            {L.furtherOut}
          </h4>
          <ul className="text-sm list-none p-0" aria-label={L.furtherOut}>
            {further.length === 0 && <li>{L.nothingFurther}</li>}
            {further.map((n) => (
              <li key={n.id}>
                <NodeButton id={n.id} />
              </li>
            ))}
          </ul>
          {view.hood.truncated && (
            <p className="text-xs text-slate-600 dark:text-slate-400">{L.boundedSubset}</p>
          )}
        </>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 k-focus"
          onClick={() => setDepth(depth > 1 ? 1 : 2)}
        >
          {depth > 1 ? L.collapse : L.expand}
        </button>
        {current !== rootId && (
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 k-focus"
            onClick={() => setCurrent(rootId)}
          >
            {L.backToProcedure}
          </button>
        )}
      </div>
    </section>
  );
}
