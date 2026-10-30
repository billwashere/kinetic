# Knowledge graph and portal: what's left

Status as of the merge of PR #3. Design background is in [`DESIGN.md`](./DESIGN.md). Each item has a rough
size (S ≤ half a day, M ≈ a day or two, L more) and a done-when, so it can be picked up as an issue.

## Next up

- [ ] **Release diff tool (S).** `pnpm release:diff <old> <new>` compares two `manifest.json` files and reports
      added/removed/changed knowledge nodes, edges, evidence, locales, docs files, media, and schema version.
      _Done when:_ output is deterministic, covered by tests against two built releases, and used in CI to
      print a summary on pull requests.
- [ ] **Real content from one actual spec (M).** The four sample nodes all hang off the placeholder
      `create_project` test. Model one real feature end to end (nodes, evidence, locale text) and note anything
      the schema can't express. First real use of `supersedes` and `configuration`.
      _Done when:_ `knowledge:validate` passes with the real nodes and any model changes are in `registry.ts`.
- [ ] **Run the CI workflow on GitHub (S).** `.github/workflows/ci.yml` has never run. Expect a fix or two
      (pnpm/Playwright setup, `--frozen-lockfile`). _Done when:_ the job is green on a pull request and the
      reproducibility and smoke steps actually execute.

## Publishing

- [ ] **Real CDN upload (M).** `release:promote` only moves `current.json` in a local folder. Add an
      upload step for the target host: upload `releases/<id>/` first, `current.json` last. Set
      `Cache-Control: immutable` on release files and a short TTL on `current.json`. Decide the retention policy.
      _Done when:_ promote and rollback work against the real host.
- [ ] **Locale subsets in the ZIP (M).** Every ZIP contains all locales. Support `--locales en-US` so
      `offline.json` and the manifest coverage match what is shipped (the verifier already checks declared locales).
- [ ] **Knowledge for every docs version (M).** Evidence is checked against `DOCS_VERSION` only, so v2.0 pages
      show no related knowledge. Validate against each version's skeleton, or record per-version evidence.
- [ ] **`404.html` links (S).** They are relative to the site root, so they only work where the host serves
      the 404 page from the root. Compute the root at runtime or document the host requirement.

## Portal

- [ ] **Search as a fetched file (S).** The search index is embedded in every page. Move it to a static JSON file
      in the release and load it on first use. Do this before the site passes a few hundred pages.
- [ ] **Subtree-safe imports (S).** `KnowledgeExplorer.tsx` and `DocLayout.astro` import the engine's
      `search.ts`/`query.ts` by relative path. Publish them as compiled files in `dist/knowledge/lib/` or a package.
- [ ] **Remove or title fixture pages (S).** `old_page` and `p` come from the diff-test fixtures in the v1.0
      skeleton and show in the sidebar and graph. Remove them from the generated skeleton or add locale titles.
- [ ] **Reference section (M).** There is no Reference quadrant, so no tab. Decide what belongs there
      (for example `configuration` nodes) before building it.
- [ ] **Per-step screenshots (L).** The design mock shows a UI screenshot inside a step. The pipeline records video
      and anchors only. Needs screenshot capture in `docStep` and a place for the images in the release.

## Localisation and copy

- [ ] **Native review of Arabic (S).** Interface labels and relationship labels in `config.ts`, the knowledge
      strings in `ar-AE.json`, and the Arabic step copy were not written or reviewed by a native speaker.
- [ ] **Style rules for non-English (M).** `docs:lint` only checks English. The Arabic steps still start with
      "أولاً" ("First,"). Add per-locale rules or a documented decision to skip them.
- [ ] **Regenerate narration audio (S).** The English sample copy was rewritten to pass `docs:lint`, so cached
      TTS audio and the videos for `create_project` no longer match. Run `generate:audio` and `assemble`.
- [ ] **Localise node bodies (M).** Only titles and summaries are localised; bodies are default-locale and
      labelled as such in `node-content.json`.

## Accessibility

- [ ] **Manual screen-reader pass (S).** axe-core is automated and covers the English and Arabic docs pages
      for serious/critical issues. Test the explorer island, header search and the dark theme with a real screen reader.

## Later (only when there is a reason)

- [ ] **AI context export (M).** A bounded neighbourhood JSON file per node (definition, typed edges, evidence,
      locale, version) so tools can read it directly. The traversal code exists in `query.ts`; the export doesn't.
- [ ] **DuckDB-WASM and Parquet (L).** Only when the graph outgrows in-memory traversal (thousands of
      edges). Requirements from the spike are in `DESIGN.md` §7: self-host the Parquet extension and worker,
      bundle the JS, pin versions, add `extensions.duckdb.org` to the verifier's external-dependency check, declare
      the ~39 MB cost in `offline.json`, and measure WASM memory first (not measured yet).
- [ ] **Inferred edges (M).** `edge.origin` is `authored` only. If inferred relationships are added, show them
      separately and never mark them `verified`.
