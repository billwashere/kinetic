// Reference consumer of the published release. It reads only static files via relative URLs
// (no server, no absolute paths), so it works from a CDN path, an intranet host, or the offline ZIP.
import { search } from './lib/search.js';
import { neighborhood } from './lib/query.js';

const $ = (id) => document.getElementById(id);
const getJson = async (p) => {
  const r = await fetch(p);
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json();
};
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k.includes('-') ? n.setAttribute(k, v) : (n[k] = v);
  for (const k of kids) n.append(k);
  return n;
};

const state = { locale: null, depth: 1, types: null, content: {}, index: {} };
let manifest, registry, nodes, edges, nodeContent;
const byId = new Map();

async function loadLocale(code) {
  if (!state.content[code]) {
    [state.content[code], state.index[code]] = await Promise.all([
      getJson(`../knowledge/content/${code}.json`),
      getJson(`../knowledge/search/search-index.${code}.json`),
    ]);
  }
}

const textOf = (id) => state.content[state.locale].nodes[id] ?? { title: id, summary: '' };
const nodeHref = (id) => `#${encodeURIComponent(id)}`;

function applyLocale() {
  const l = manifest.locales.find((x) => x.code === state.locale);
  document.documentElement.lang = state.locale;
  document.documentElement.dir = l?.dir ?? 'ltr';
}

function nodeLink(id) {
  const n = byId.get(id);
  return el(
    'a',
    { href: nodeHref(id), textContent: textOf(id).title },
    el('span', { className: 'badge', textContent: n?.kind ?? '' }),
  );
}

function renderResults(hits) {
  $('results-count').textContent = `${hits.length} result${hits.length === 1 ? '' : 's'}`;
  $('results').replaceChildren(...hits.map((h) => el('li', {}, nodeLink(h.doc.id))));
}

function renderBody(text) {
  return text.split(/\n{2,}/).map((para) => {
    const p = el('p');
    let last = 0;
    for (const m of para.matchAll(/\[\[([a-z]+:[a-z0-9_-]+)\]\]/g)) {
      p.append(para.slice(last, m.index), byId.has(m[1]) ? nodeLink(m[1]) : m[0]);
      last = m.index + m[0].length;
    }
    p.append(para.slice(last));
    return p;
  });
}

function evidenceView(e) {
  const where =
    e.type === 'playwright-step'
      ? `${e.page} / ${e.step}`
      : e.type === 'file'
        ? e.path + (e.symbol ? ` ("${e.symbol}")` : '')
        : '';
  return el('li', { textContent: [e.type, where, e.description].filter(Boolean).join(' — ') });
}

function renderNode(id) {
  const n = byId.get(id);
  const root = $('node');
  if (!n)
    return void root.replaceChildren(el('p', { textContent: `No node "${id}" in this release.` }));
  const t = textOf(id);
  const out = [
    el('h2', { textContent: t.title }),
    el('p', { className: 'meta', textContent: `${id} · ${n.origin}` }),
    el('p', { textContent: t.summary }),
    ...(nodeContent.nodes[id] ? renderBody(nodeContent.nodes[id].body) : []),
  ];

  if (n.pageId && manifest.capabilities.includes('docs-site')) {
    out.push(
      el(
        'p',
        {},
        el('a', {
          href: `../site/${manifest.docsVersion}/${state.locale}/${n.pageId}/`,
          textContent: 'Open the documentation page',
        }),
      ),
    );
  }

  const typesPresent = [
    ...new Set(edges.filter((e) => e.source === id || e.target === id).map((e) => e.type)),
  ].sort();
  if (typesPresent.length) {
    const fs = el('fieldset', {}, el('legend', { textContent: 'Relationship types' }));
    for (const ty of typesPresent) {
      const cb = el('input', { type: 'checkbox', checked: !state.types || state.types.has(ty) });
      cb.addEventListener('change', () => {
        state.types = new Set(
          typesPresent.filter((x) => (x === ty ? cb.checked : !state.types || state.types.has(x))),
        );
        renderNode(id);
      });
      fs.append(el('label', {}, cb, ` ${ty} `));
    }
    out.push(fs);
  }

  const sym = Object.entries(registry.relationships)
    .filter(([, d]) => d.symmetric)
    .map(([k]) => k);
  const hood = neighborhood(edges, id, {
    depth: state.depth,
    types: state.types ? [...state.types] : undefined,
    symmetric: sym,
  });
  const incident = hood.edges.filter((e) => e.source === id || e.target === id);
  const list = el('ul', { 'aria-label': 'Relationships' });
  for (const e of incident) {
    const def = registry.relationships[e.type];
    const outgoing = e.source === id || def.symmetric;
    const other = e.source === id ? e.target : e.source;
    const full = edges.find(
      (x) => x.source === e.source && x.type === e.type && x.target === e.target,
    );
    const li = el(
      'li',
      {},
      `${outgoing ? def.label : def.inverseLabel} `,
      nodeLink(other),
      el('span', { className: `badge ${e.verification}`, textContent: e.verification }),
    );
    if (full.evidence.length)
      li.append(
        el(
          'details',
          {},
          el('summary', { textContent: `Evidence (${full.evidence.length})` }),
          el('ul', {}, ...full.evidence.map(evidenceView)),
        ),
      );
    list.append(li);
  }
  out.push(
    el('h3', { textContent: 'Relationships' }),
    incident.length ? list : el('p', { textContent: 'None.' }),
  );

  const further = hood.nodes.filter((x) => x.depth > 1);
  if (state.depth > 1) {
    out.push(
      el('h3', { textContent: 'Further out' }),
      further.length
        ? el('ul', {}, ...further.map((x) => el('li', {}, nodeLink(x.id))))
        : el('p', { textContent: 'Nothing further.' }),
    );
    if (hood.truncated)
      out.push(
        el('p', {
          className: 'meta',
          textContent: 'Showing a bounded subset; narrow by relationship type to see more.',
        }),
      );
  }
  const btn = el('button', {
    type: 'button',
    textContent: state.depth > 1 ? 'Collapse neighbourhood' : 'Expand neighbourhood',
  });
  btn.addEventListener('click', () => {
    state.depth = state.depth > 1 ? 1 : 2;
    renderNode(id);
  });
  out.push(btn);
  root.replaceChildren(...out);
}

function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id) renderNode(id);
}

async function init() {
  [manifest, registry, nodes, edges, nodeContent] = await Promise.all([
    getJson('../manifest.json'),
    getJson('../knowledge/registry.json'),
    getJson('../knowledge/graph/nodes.json').then((x) => x.nodes),
    getJson('../knowledge/graph/edges.json').then((x) => x.edges),
    getJson('../knowledge/graph/node-content.json'),
  ]);
  nodes.forEach((n) => byId.set(n.id, n));
  $('release').textContent = `Release ${manifest.releaseId}`;

  const sel = $('locale');
  for (const l of manifest.locales)
    sel.append(
      el('option', {
        value: l.code,
        textContent: `${l.code}${l.support === 'partial' ? ' (partial)' : ''}`,
      }),
    );
  state.locale = manifest.defaultLocale;
  sel.value = state.locale;
  await loadLocale(state.locale);
  applyLocale();

  sel.addEventListener('change', async () => {
    state.locale = sel.value;
    await loadLocale(state.locale);
    applyLocale();
    renderResults(search(state.index[state.locale], $('q').value));
    route();
  });
  $('search-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    renderResults(search(state.index[state.locale], $('q').value));
  });
  addEventListener('hashchange', route);
  route();
  document.body.dataset.ready = 'true';
}

init().catch((e) => {
  $('node').textContent = `Failed to load release: ${e.message}`;
});
