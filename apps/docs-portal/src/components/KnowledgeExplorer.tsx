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

interface Props {
  rootId: string;
  locale: string;
  /** URL of the published `knowledge/` directory, relative to this page. */
  dataBase: string;
}

const get = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

export default function KnowledgeExplorer({ rootId, locale, dataBase }: Props) {
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
      <p className="text-xs text-slate-500" role="status">
        Loading graph…
      </p>
    );

  const title = (id: string) => data.text[id]?.title ?? id;
  const hits = query.trim() ? search(data.index, query, { limit: 8 }) : [];
  const incident = view.hood.edges.filter((e) => e.source === current || e.target === current);
  const further = view.hood.nodes.filter((n) => n.depth > 1);

  const NodeButton = ({ id }: { id: string }) => (
    <button type="button" className="text-blue-700 underline" onClick={() => setCurrent(id)}>
      {title(id)}
    </button>
  );

  return (
    <section className="mt-6 rounded-lg border border-slate-200 p-4" aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`} className="text-base font-bold text-slate-800">
        Explore the knowledge graph
      </h3>

      <form
        role="search"
        className="mt-2 flex gap-2 items-end"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="text-sm text-slate-700">
          Search concepts
          <input
            type="search"
            className="block border border-slate-300 rounded px-2 py-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </form>
      {query.trim() && (
        <ul className="mt-2 text-sm list-none p-0" aria-label="Search results">
          {hits.length === 0 && <li>No matches.</li>}
          {hits.map((h) => (
            <li key={h.doc.id}>
              <NodeButton id={h.doc.id} />{' '}
              <span className="text-xs text-slate-600">({h.doc.kind})</span>
            </li>
          ))}
        </ul>
      )}

      <h4 className="mt-4 text-sm font-semibold text-slate-800">
        {title(current)}{' '}
        <span className="text-xs font-normal text-slate-600">({data.kinds[current]})</span>
      </h4>
      <p className="text-sm text-slate-600">{data.text[current]?.summary}</p>

      {view.present.length > 0 && (
        <fieldset className="mt-2 border border-slate-200 rounded p-2">
          <legend className="text-xs text-slate-600 px-1">Relationship types</legend>
          {view.present.map((t) => (
            <label key={t} className="text-sm mr-3">
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

      <ul className="mt-2 text-sm list-none p-0 space-y-1" aria-label="Relationships">
        {incident.length === 0 && <li>No relationships shown.</li>}
        {incident.map((e) => {
          const def = data.rels[e.type];
          const out = e.source === current;
          const other = out ? e.target : e.source;
          return (
            <li key={`${e.source}|${e.type}|${e.target}`}>
              {out || def.symmetric ? def.label : def.inverseLabel} <NodeButton id={other} />{' '}
              <span className="text-xs text-slate-600">[{e.verification}]</span>
            </li>
          );
        })}
      </ul>

      {depth > 1 && (
        <>
          <h4 className="mt-3 text-sm font-semibold text-slate-800">Further out</h4>
          <ul className="text-sm list-none p-0" aria-label="Further out">
            {further.length === 0 && <li>Nothing further.</li>}
            {further.map((n) => (
              <li key={n.id}>
                <NodeButton id={n.id} />
              </li>
            ))}
          </ul>
          {view.hood.truncated && (
            <p className="text-xs text-slate-600">
              Showing a bounded subset; filter by relationship type to narrow.
            </p>
          )}
        </>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="border border-slate-300 rounded px-2 py-1 text-sm"
          onClick={() => setDepth(depth > 1 ? 1 : 2)}
        >
          {depth > 1 ? 'Collapse neighbourhood' : 'Expand neighbourhood'}
        </button>
        {current !== rootId && (
          <button
            type="button"
            className="border border-slate-300 rounded px-2 py-1 text-sm"
            onClick={() => setCurrent(rootId)}
          >
            Back to this procedure
          </button>
        )}
      </div>
    </section>
  );
}
