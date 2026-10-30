# Kinetic Docs — Declarative Knowledge Graph: design and first slice

Status: Phases 1–3 and 5 implemented, including the real Astro portal inside the release. Phase 4 is partly done (procedure pages show related knowledge); 6 and 7 are planned below.

## 1. Assessment of the existing system

| Concern         | What exists                                                                                            | Contract that matters                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Procedural docs | Playwright specs call `docStep` / `docAssert` / `docNote`                                              | `DocStore.flushDocs` writes `generated/<version>/extracted-skeleton.json` (`pageId`, `steps[{type,stepId,textKey,anchor}]`)                                                           |
| Copy / locales  | `content/locales/<locale>.json`, Zod `LocaleSchema`                                                    | Locale list is derived from the filesystem; `pages`, `strings` keyed by id                                                                                                            |
| Audio / video   | `generate:audio` → `public/audio-manifest-*.json`; `assemble` → `public/video-cache/<version>/*.mp4`   | Unchanged by this work                                                                                                                                                                |
| Portal          | Astro SSG, route `[version]/[locale]/[pageId].astro`, reads skeleton + locales from disk at build time | **All URLs are root-absolute** (`/${version}/...`, `/video-cache/...`, `/assets/favicon.ico`); locale switcher does `pathname.replace`; `PageInject` calls `/api/feedback` at runtime |
| Orchestration   | Turborepo `test:docs → generate:audio → assemble → portal build`                                       | New tasks were added beside these, not into the chain                                                                                                                                 |
| CI              | **None existed**                                                                                       | `.github/workflows/ci.yml` added                                                                                                                                                      |
| Hosting         | Implicit: served at the domain root                                                                    | No base-path support anywhere                                                                                                                                                         |

Two findings drive the design:

1. The skeleton already is a machine-readable index of procedures and their steps, so procedures do not need to be re-authored. They are **derived** nodes (`procedure:<pageId>`); step ids become **evidence** that is checked against the skeleton.
2. The portal could not originally be relocated; the verifier measured 112 `root-absolute-url` errors on its output and refused to publish it. That was fixed (§6.1).

## 2. Mapping onto the repository (no second pipeline)

| Brief layer                | Where it lives                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical knowledge source | `packages/engine/content/knowledge/**/*.md` (Markdown + YAML frontmatter); localised text in `content/locales/*.json` under a new optional `knowledge` key                    |
| Knowledge engine           | `packages/engine/src/knowledge/` (pure modules with sibling `*.test.ts`), driven by scripts in `src/scripts/` — same ts-node/Zod/vitest conventions as the rest of the engine |
| Release artefacts          | `dist/release/cdn/releases/<releaseId>/` (immutable), `dist/release/cdn/current.json` (pointer), `dist/release/offline/*.zip`                                                 |
| Presentation               | Reference explorer shipped inside every release (`explorer/`). Astro integration is Phase 4                                                                                   |

New Turbo tasks: `knowledge:validate`, `release:build`. New CI job: `knowledge-release`.

## 3. Schema

```yaml
---
id: feature:project-creation # <kind>:<slug>, stable, never derived from a title or URL
kind: feature # registry: concept | feature | procedure | configuration
title: Project creation # default-locale text; other locales override via locale files
summary: Creating a new project from the projects dashboard.
aliases: [New project]
relationships:
  - type: depends_on # registry-checked: direction, source/target kinds, acyclicity, evidence policy
    target: feature:authentication
    evidence:
      - type: playwright-step # resolved against the skeleton: page + step must exist
        page: create_project
        step: login_email
evidence: # node-level evidence (e.g. the spec that exercises the feature)
  - type: file
    path: packages/engine/e2e-tests/create-project.spec.ts
    symbol: Project Creation Flow # must occur in the file
---
Markdown body (default locale). `[[concept:project]]` links are validated.
```

- **Kinds** are four, deliberately. `test`, `screen`, `rule`, `glossary-term` etc. are not added until a concrete page needs them. Tests are _evidence_, not nodes.
- **Relationships** (`registry.ts`): `depends_on`, `part_of`, `implements`, `uses`, `configured_by`, `documented_by`, `related_to` (symmetric), `supersedes`. Each declares a label and inverse label, allowed source/target kinds, whether cycles are errors, and an evidence policy (`none` / `recommended` / `required`). Edges are stored once in authored direction; incoming views use the inverse label.
- **Provenance**
  - Nodes carry `origin: authored | derived`. Derived nodes come only from the skeleton.
  - Edges carry `verification`: `verified` (≥1 machine-checked evidence entry resolved), `asserted` (prose only), `unevidenced`. Nothing is shown as verified unless the build actually checked it.
  - `documented_by` _requires_ machine-checkable evidence; prose alone fails the build.
  - `edge.origin` is `authored` only today. The field exists so inferred edges can be added later without a schema change; none are generated yet.
- **Localisation.** Ids and edges are language-independent. Fallback policy: requested locale → default locale (`en-US`, the frontmatter text) → page id for untitled procedures. Each resolved string records which locale it came from. The manifest reports per-locale coverage and marks a locale `partial` unless every authored node is translated. **Bodies are not localised yet** and are labelled as default-locale in `node-content.json`.

## 4. Validation and generated artefacts

`pnpm knowledge:validate` (also run by `release:build`). Errors fail CI; warnings do not (`--strict` promotes them).

| Error                                                                                       | Warning                                               |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| malformed / invalid frontmatter, unknown fields, bad id                                     | orphan authored nodes                                 |
| invalid kind, id/kind mismatch, duplicate id (incl. collision with derived)                 | conflicting definitions (same kind, same title/alias) |
| unknown relationship type, missing target, wrong source/target kind, self-edge              | duplicate relationship (incl. symmetric reversed)     |
| cycles in `acyclic` types                                                                   | `recommended` evidence missing                        |
| unresolved evidence (missing page/step/file/symbol), `required` evidence missing            | missing translation (fallback applied)                |
| broken `[[wikilinks]]`, locale text for unknown node, invalid locale file, missing skeleton | untitled derived procedure                            |

Every diagnostic names the source file and node id. Not implemented yet: "unreachable content" beyond orphans, and validation of links inside the Astro-rendered pages (the verifier only checks the HTML it is given).

Generated files (`knowledge/` in the release; all deterministic — sorted, no timestamps, no absolute paths):

| File                                   | Consumer                                                    |
| -------------------------------------- | ----------------------------------------------------------- |
| `registry.json`                        | any tool; labels / constraints without importing TypeScript |
| `graph/nodes.json`, `graph/edges.json` | traversal, tooling, AI context                              |
| `graph/node-content.json`              | retrieval: authored bodies + outgoing wikilinks             |
| `content/<locale>.json`                | localised title/summary with `titleFrom` / `summaryFrom`    |
| `search/search-index.<locale>.json`    | browser/Node search (`search.ts`)                           |
| `diagrams/graph.dot`                   | Graphviz, generated from the graph — no second source       |

`manifest.json` records `releaseId`, `contentHash`, schema/manifest versions, locale coverage, graph counts by verification, capabilities, and every file with sha256, size and role. `releaseId = <docsVersion>-<first 12 hex of contentHash>`; the hash covers the sorted (path, sha256) pairs, so the id changes iff content changes, and future tools can diff two manifests file-by-file.

**Format decision:** JSON only for now. Parquet has no consumer until the explorer outgrows in-memory traversal (see §7).

## 5. Release, CDN and offline strategy

One build produces one immutable directory; the other modes are views of it.

```
dist/release/cdn/releases/<releaseId>/      # manifest.json, knowledge/, explorer/, index.html, [site/]
dist/release/cdn/current.json               # {releaseId, manifest, manifestSha256, previous} — relative paths
dist/release/offline/kinetic-docs-<id>.zip  # same files + offline.json, serve.mjs, README.md, SHA256SUMS
```

- **CDN.** Upload `releases/<id>/` first (long-lived `immutable` caching is safe: the path contains the content hash), then `current.json` last with a short TTL. `pnpm release:promote <cdn-root> <id>` verifies the release and only then moves the pointer (tmp + rename). **Rollback is the same command aimed at an older retained release**; nothing is rebuilt. Re-promoting after tampering is refused.
- **Self-hosted.** Extract/copy the release under any path. All generated links are relative.
- **Offline ZIP.** Built _from_ the release directory by `package.ts`, not by zipping a deploy folder. Single top-level folder; reproducible (sorted entries, fixed DOS timestamp; verified identical under a different `TZ`). Adds a zero-dependency static launcher (`node serve.mjs [--base /x/]`, honours `Range`, traversal-guarded), `offline.json` (capabilities after omissions, locales + coverage, omitted files, online-only features), a README, and `SHA256SUMS`. Optional media can be dropped (`--no-media`); omissions are listed in `offline.json` and the verifier does not treat references to declared-omitted files as breakage, but does flag any undeclared one.
- **`file://` is not supported.** Confirmed in Chromium: ES modules are blocked by CORS from a `null` origin. The README says so and ships the launcher.
- **Verification** (`verify.ts`, run on the release dir and on the extracted ZIP): manifest/content-hash/id consistency, per-file size and sha256, unlisted files, SHA256SUMS coverage, graph/edge consistency, declared locales actually present, ZIP path-traversal rejection, root-absolute URLs, unresolved relative references, and — offline only — any resource loaded from an external host. Plain `<a href="https://…">` links are not treated as dependencies.
- **Smoke test** (`pnpm release:smoke`): extract the ZIP, run the bundled launcher under `/docs/offline/`, drive the explorer in Chromium with all non-local requests aborted and recorded. Covers keyboard search, node view, typed/inverse relationships, verification badges, evidence disclosure, relationship-type filter, bounded expansion, locale switch to RTL Arabic with fallback, `Range` → 206, and zero external or failed requests.

## 6. Known gaps and the main open decision

1. **Portal relocation (done, Phase 5b).** Option (a) was implemented: the route, layout, 404 and index emit document-relative URLs (`../../../v1.0/en-US/x/`), `trailingSlash: 'always'` keeps that valid in dev, and the root page uses a relative meta-refresh. Astro's own `/_astro/…` bundle URLs cannot be made relative in config, so `relativizeAstroAssets` rewrites them once while the release is staged, _before_ hashing — one transform, so CDN, self-hosted and ZIP carry identical bytes. `release:build --site` now verifies clean and the smoke test loads the real portal under `/docs/offline/` and under `/`. Residual: `404.html` links are relative to the site root, which is correct only where the host serves it from the root.
2. **Media in CI.** Videos are not rendered in a doc-edit build. `--declare-missing-media` records exactly the unrendered files in `manifest.missingMedia` (part of the release identity and listed in `offline.json`); any other broken reference still fails. A release built that way has no video and says so. `/api/feedback` appears only in a _commented example_ in `PageInject.astro` (annotated as online-only); no live code needs a server.
3. Locale subsets are not implemented: every ZIP contains all locales the release has. Bodies are default-locale only.
4. The explorer is a dependency-free _reference consumer_ (outline, not a drawn graph) that proves the artefacts and a11y patterns. It is not the portal integration.
5. The Arabic strings in `ar-AE.json` were written by the assistant and need native review.
6. The committed v1.0 skeleton contains fixture pages (`old_page`, `p`) from the diff tests; they appear as derived procedures with an `untitled` warning.

## 7. DuckDB-WASM feasibility (measured)

Tested `@duckdb/duckdb-wasm@1.29.0` (DuckDB core v1.1.1, `eh` bundle) in Playwright Chromium 148, served by the release's own launcher under `/docs/spike/`, with all non-local requests blocked. Data: the real release graph (7 nodes / 7 edges) plus a **synthetic** 100k-node / 400k-edge graph shaped like the registry (the real graph is too small to say anything about scale).

| Question                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Remote HTTP + range requests                 | Works via `registerFileURL(…, HTTP, directIO=true)`; native `httpfs` is not used. All 64 data requests were `Range` GETs; there were no HEADs.                                                                                                                                                                                                                                                                                                                                                   |
| Query latency (over HTTP, same page session) | Real 7-edge graph: 551 ms for the first query (includes loading the Parquet extension), 85 ms for the next. Synthetic 400k edges: 135 ms (1-hop), 275 ms (group by), 330 ms (join), 507 ms (bounded 2-hop). Single runs on one machine, not benchmarks.                                                                                                                                                                                                                                          |
| **Hidden CDN dependency**                    | **First Parquet use downloads `parquet.duckdb_extension.wasm` from `extensions.duckdb.org`.** With the network blocked this fails as an opaque `table index is out of bounds`. Fix: self-host the extension at `<repo>/v1.1.1/wasm_eh/parquet.duckdb_extension.wasm` and `SET custom_extension_repository='<local url>'`. With that, zero external requests. This is exactly the "accidental CDN dependency" the offline verifier must catch; the extension is version-pinned to the WASM build. |
| CORS                                         | Cross-origin Parquet fails without `Access-Control-Allow-Origin`; works with it (`Range` request header allowed, `Content-Length`/`Content-Range` exposed). Same-origin (our default) needs nothing.                                                                                                                                                                                                                                                                                             |
| `file://`                                    | Fails (module CORS). Needs the launcher, as above.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Base path                                    | Works under `/docs/spike/` (relative `URL`s only).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Size                                         | `duckdb-eh.wasm` 35.7 MB raw / 7.0 MB gzip; worker 0.76 MB; JS bundle 0.43 MB (needs bundling — the published `.mjs` imports bare `apache-arrow`); Parquet extension 2.8 MB / 0.69 MB gzip. ≈39 MB raw added to every offline ZIP.                                                                                                                                                                                                                                                               |
| Data size                                    | Synthetic edges: 3.75 MB Parquet vs 49 MB JSON (4.7 MB gzip).                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Memory                                       | JS heap stayed ~10 MB; **WASM linear memory was not measured** and should be before committing.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Not tested                                   | Threaded (`coi`) bundle (needs COOP/COEP, which many static hosts cannot set), Safari/Firefox, mobile, a real CDN.                                                                                                                                                                                                                                                                                                                                                                               |

**Decision.** Do not add DuckDB-WASM to the first slice. At the current size (and for graphs up to a few thousand edges) the TypeScript `neighborhood()` / `search()` modules are faster to load by orders of magnitude and add no runtime. Keep DuckDB-WASM as an opt-in, lazily loaded `sql` capability (Phase 6) behind a measured threshold, with Parquet emitted only then, and with these requirements captured now: self-host the extension and worker, bundle the JS, pin versions, add `external-dependency` coverage for `extensions.duckdb.org`, and declare the ~39 MB cost in `offline.json`. SQLite-WASM is not introduced.

## 8. Incremental plan and acceptance tests

| Phase                | Scope                                                                                                                                                                                                                                                                                                                                                             | Acceptance (✔ = covered today)                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1 Assessment         | this document, DuckDB spike                                                                                                                                                                                                                                                                                                                                       | ✔                                                                                                                            |
| 2 Model              | registry, schema, loader, validator, 4 sample nodes + 1 derived page                                                                                                                                                                                                                                                                                              | ✔ `validate.test.ts` (negative cases per error code), `knowledge:validate` on repo                                           |
| 3 Artefacts          | graph/content/search/DOT, manifest, determinism                                                                                                                                                                                                                                                                                                                   | ✔ `release.test.ts` (same id + same ZIP bytes; id changes with content); `knowledge:query` CLI reads artefacts with no Astro |
| 5 Release (partial)  | CDN tree, pointer, promote/rollback, ZIP, verifier, launcher, smoke                                                                                                                                                                                                                                                                                               | ✔ tamper/missing/unlisted/dangling/root-absolute/external/zip-slip tests; rollback test; Chromium smoke; CI job.             |
| 4 Portal (partial)   | ✔ "Related knowledge" on procedure pages (relation, summary, verification, evidence, link into the explorer), read from compiled files via `knowledge:compile`, localised, shown only for the docs version the evidence was checked against. ☐ explorer as an Astro island; ☐ knowledge nodes in portal search (the portal has no search today); ☐ axe/a11y audit | ✔ smoke asserts the section, verification text, evidence and a resolving explorer link under two bases                       |
| 5b Portal relocation | §6.1(a), feature-flag `/api/feedback`, add `--site` to CI                                                                                                                                                                                                                                                                                                         | ☐ release with `site/` verifies clean; smoke covers a docs page under `/docs/offline/` and a second non-root base            |
| 6 Query              | DuckDB-WASM + Parquet behind threshold; AI context export (bounded neighbourhood JSON per node)                                                                                                                                                                                                                                                                   | ☐ §7 requirements; memory measured; offline run with extension self-hosted                                                   |
| 7 Adoption           | more nodes from real specs; `supersedes` use for version diffs; release-to-release diff tool over manifests                                                                                                                                                                                                                                                       | ☐                                                                                                                            |

## 9. Authoring workflow

1. Add `content/knowledge/<dir>/<slug>.md` with frontmatter as in §3.
2. Link to existing ids; attach `playwright-step` / `file` evidence.
3. `pnpm --filter @kinetic/engine knowledge:validate`.
4. `pnpm --filter @kinetic/engine release:build` then open `dist/release/cdn/releases/<id>/explorer/` through any static server, or `release:smoke`.
5. Inspect with `pnpm --filter @kinetic/engine knowledge:query <release-dir> node <id> --depth 2`.

Generated JSON, manifests and ZIPs are never edited by hand and are not committed (`dist/` is ignored).
