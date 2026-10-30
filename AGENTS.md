# AGENTS.md — Kinetic Docs

> Canonical guide for AI coding agents (Claude Code, Cursor, Aider, etc.) working in this monorepo. Read this before making any change.

This file is the single source of truth for agent-facing context. `CLAUDE.md` and any other agent-specific files are pointers to this one.

---

## What This Project Does

Kinetic Docs is a **docs-as-code pipeline** that auto-generates localized, video-enriched documentation directly from Playwright E2E tests. Engineers annotate UI tests with `docStep` / `docAssert` calls. The pipeline:

1. **Runs Playwright tests** → records screen video + writes `extracted-skeleton.json` with step metadata and bounding boxes.
2. **Generates TTS audio** via Kokoro (local, no API key) or OpenAI for every locale, caches by SHA-256 content hash.
3. **Builds a per-page timing schedule** from the audio manifest — subtitle cues and anchor timings keyed to exact frame numbers.
4. **Composites MP4s** via `@kinetic/renderer-compat` (Playwright + esbuild + FFmpeg): subtitles, pulsing visual anchors, background music, watermark, intro/outro slides.
5. **Stitches segments** (`intro + content + outro`) and optionally adds a unified music track via FFmpeg post-stitch.
6. **Builds a static Astro portal** serving one HTML page per version × locale × page.

---

## Monorepo Layout

```
kinetic-docs-turbo/
├── turbo.json                            # Turborepo DAG (uses "tasks" key — Turbo v2)
├── pnpm-workspace.yaml                   # packages: apps/*, packages/*
├── .prettierrc.json
├── layer-config.example.json             # Copy to layer-config.json to enable layers
│
├── packages/renderer-compat/             # @kinetic/renderer-compat (MIT)
│   ├── README.md                         # Full API docs and migration notes
│   ├── LICENSE                           # MIT
│   ├── package.json                      # build, test:unit, test:watch
│   ├── tsconfig.json, tsconfig.build.json
│   ├── build.mjs                         # esbuild → dist/*.js
│   ├── vitest.config.ts
│   └── src/
│       ├── react-api.tsx                 # 'remotion' shim — AbsoluteFill, Composition, hooks
│       ├── frame-context.tsx             # FrameProvider context
│       ├── composition-registry.ts       # Module-level Composition registry
│       ├── interpolate.ts                # Pure interpolate() + interpolate.test.ts
│       ├── jsx-traversal.ts              # findCompositions() + jsx-traversal.test.ts
│       ├── bundler.ts                    # @remotion/bundler shim — esbuild
│       ├── renderer.ts                   # @remotion/renderer shim — Playwright + FFmpeg
│       ├── http-server.ts                # Static file server with path-traversal guard
│       ├── ffmpeg.ts                     # FFmpeg encode + ensureFfmpeg() health check
│       └── runner.html                   # Loaded once per Playwright page
│
├── packages/engine/                      # @kinetic/engine
│   ├── .env.example                      # All env vars documented here
│   ├── layer-config.json                 # (user-created) music, watermark, intro/outro
│   ├── playwright.config.ts              # baseURL from APP_URL, globalSetup
│   ├── vitest.config.ts                  # Includes src/**/*.test.ts, excludes e2e-tests/
│   ├── tsconfig.json                     # paths: aliases @kinetic/renderer-compat[/bundler|/renderer]
│   ├── content/locales/                  # SOURCE OF TRUTH — all copy lives here
│   │   ├── en-US.json
│   │   └── ar-AE.json
│   ├── public/
│   │   ├── assets/                       # Music files and logo images
│   │   ├── audio-objects/                # OUTPUT (gitignored): hashed .mp3 files
│   │   ├── audio-manifest-*.json         # OUTPUT (committed): per-locale step timings
│   │   ├── visual-cache/v1.0/            # OUTPUT (gitignored): raw Playwright .webm
│   │   └── video-cache/v1.0/             # OUTPUT (gitignored): final .mp4s
│   │       └── .intermediate/            # OUTPUT: intro/outro cache + content temp files
│   ├── e2e-tests/
│   │   ├── global-setup.ts               # Pre-auth for all integration services
│   │   ├── create-project.spec.ts
│   │   ├── cross-domain-sync.spec.ts     # Example two-service integration test
│   │   └── shared/login-flow.ts
│   └── src/
│       ├── index.tsx                     # Composition root: KineticDocs, KineticIntro, KineticOutro
│       ├── engine/
│       │   ├── VoiceRegistry.ts          # Locale → voice profile (tone, speed, voiceId)
│       │   ├── SSMLBuilder.ts            # Fluent SSML construction
│       │   ├── domains.ts                # URL registry: DOMAINS, loadService(), resolveUrl()
│       │   ├── layer-config.ts           # Zod: LayerConfig, IntroConfig, OutroConfig, MusicConfig …
│       │   ├── locale-schema.ts          # Zod: LocaleData — validates locale JSON files
│       │   └── render-config.ts          # Zod: RenderConfig + FPS / WIDTH / HEIGHT constants
│       ├── components/                   # React components — bundled by renderer-compat
│       │   ├── VisualAnchor.tsx          # Pulsing spotlight (accepts a single BoundingBox)
│       │   ├── AnchorLayer.tsx           # Frame-aware wrapper — finds active step from StepTiming[]
│       │   ├── SubtitleLayer.tsx         # Synchronized narration text with cross-fade
│       │   ├── MusicLayer.tsx            # Background audio with interpolate() fade envelopes
│       │   ├── WatermarkLayer.tsx        # Logo pinned to a corner with configurable margin
│       │   ├── IntroSlide.tsx            # Branded opening — title/breadcrumb animation
│       │   └── OutroSlide.tsx            # Branded closing — logo + CTA + fade to black
│       ├── lib/
│       │   ├── doc-extractor.ts          # DocStore class: page(), recordStep(), flushDocs()
│       │   ├── manifest-reader.ts        # getPageContentSeconds, secondsToFrames
│       │   ├── timing-schedule.ts        # buildPageTimingSchedule → SubtitleCue[], StepTiming[]
│       │   ├── stitch-and-mix.ts         # stitchAndMix, buildMusicFilterComplex, cache hashing
│       │   ├── stitcher.ts               # VideoStitcher.concat — FFmpeg copy-codec concat
│       │   ├── differ/
│       │   │   ├── types.ts              # Finding, DiffReport, buildReport
│       │   │   ├── skeleton-diff.ts      # Structural comparison of DocPage[]
│       │   │   ├── anchor-diff.ts        # Bounding-box delta with configurable thresholds
│       │   │   └── visual-diff.ts        # FFmpeg pixel-diff artifacts (optional)
│       │   ├── integration/
│       │   │   └── actor.ts              # IntegrationActor — isolated browser context per service
│       │   ├── storage/
│       │   │   └── robust-text.ts        # RobustTextStorage — SHA-256 content-addressable cache
│       │   └── tts/
│       │       ├── adapter.ts            # TTSAdapter interface + NullTTSAdapter
│       │       ├── kokoro.ts             # KokoroAdapter — Kokoro-82M via kokoro-js (local)
│       │       └── openai.ts             # OpenAIAdapter — OpenAI TTS API
│       └── scripts/
│           ├── pre-render-audio.ts       # TTS generation + audio manifest writing
│           ├── assemble.ts               # render + intro/outro stitch + music mix
│           └── diff-check.ts             # Version diff CLI: --from v1.0 --to v2.0
│
└── apps/docs-portal/                     # @kinetic/docs-portal — Astro SSG
    └── src/
        ├── layouts/DocLayout.astro       # Sidebar nav + version switcher
        ├── components/KineticPlayer.tsx
        └── pages/[version]/[locale]/[pageId].astro
```

---

## Key Commands

```bash
# From monorepo root:
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --ignore-scripts
pnpm exec playwright install chromium     # one-time browser install
pnpm turbo run test:unit                  # all packages, ~4s, no browser/API key
pnpm turbo run build:pipeline             # full pipeline: test → audio → assemble
pnpm turbo run dev                        # Astro portal dev server
pnpm turbo run build                      # builds renderer-compat, then portal

# From packages/renderer-compat/:
pnpm build                                # esbuild → dist/, then tsc --emitDeclarationOnly
pnpm test:unit                            # 24 vitest tests for interpolate + jsx-traversal
pnpm test:watch                           # vitest in watch mode

# From packages/engine/:
pnpm test:unit                            # vitest — engine unit tests
pnpm test:docs                            # Playwright E2E → skeleton + webm
pnpm generate:audio                       # TTS → mp3 + audio manifests
pnpm assemble                             # render-compat render + stitch + mix
pnpm diff:check --from v1.0 --to v2.0
pnpm docs:lint                            # procedure style warnings (Microsoft Writing Style Guide)
```

---

## Renderer Architecture (`@kinetic/renderer-compat`)

The video compositor is a custom MIT-licensed package that re-implements the Remotion API surface used by the engine. It uses Playwright + esbuild + FFmpeg directly.

### Public API (drop-in for Remotion)

| Import path | Exports | Replaces |
| --- | --- | --- |
| `@kinetic/renderer-compat` | `AbsoluteFill`, `Composition`, `Audio`, `Img`, `Video`, `useCurrentFrame`, `useVideoConfig`, `interpolate`, `registerRoot` | `remotion` |
| `@kinetic/renderer-compat/bundler` | `bundle()` | `@remotion/bundler` |
| `@kinetic/renderer-compat/renderer` | `selectComposition()`, `renderMedia()` | `@remotion/renderer` |

### How a render works

1. `bundle({ entryPoint, outDir })` — esbuild compiles `src/index.tsx`, aliasing `'remotion'` → the shim's `react-api.tsx`. Output: `<outDir>/bundle.js` + `<outDir>/index.html`.
2. `selectComposition({ serveUrl, id, inputProps })` — starts a local HTTP server, opens one Playwright page against `?mode=list`, reads `window.__compositions`, returns the matching entry.
3. `renderMedia({ composition, serveUrl, ... })` — opens N Playwright pages (N = `concurrency`), each navigates **once** to `?mode=render` and waits for `window.__rendererReady` (signalled after `document.fonts.ready`). For each frame, the renderer calls `window.__renderFrame(id, n, propsJson)` via `page.evaluate()`. The browser-side React app updates state, triggers a re-render, and after a double-RAF (one full paint cycle) sets `window.__frameReady = true`. The renderer screenshots, then moves on.
4. After all PNG frames are written to disk, `ffmpeg` encodes them into the output MP4.

The load-once + setFrame design is critical for performance — bundles are large, and reloading per frame would multiply parse/compile cost by `durationInFrames`.

### Limitations agents should know about

- **`<Audio>` is a no-op.** Headless Chromium cannot capture audio output to a file. The engine sidesteps this by mixing music with FFmpeg in `stitch-and-mix.ts` after encoding (when intro/outro is enabled). For the no-intro path, music is currently silent — if a use case needs audio without intro, add a post-encode FFmpeg pass.
- **`<Video>` is a no-op placeholder.** Source video files (the Playwright-recorded `.webm`s) are composited by FFmpeg in the stitcher, not by React.
- **No Remotion Studio / Player.** This is render-pipeline only.

### When to modify the renderer-compat package

| Change | File to touch |
| --- | --- |
| Adding a new hook or component to the React surface | `src/react-api.tsx` |
| Adding a new render option (e.g. quality preset) | `src/renderer.ts` `RenderMediaOptions` + `src/ffmpeg.ts` `EncodeOptions` |
| Changing how compositions are extracted from JSX | `src/jsx-traversal.ts` (pure, has tests in `jsx-traversal.test.ts`) |
| Improving `interpolate` math | `src/interpolate.ts` (pure, tests in `interpolate.test.ts`) |
| Switching browser engine (e.g. Firefox) | `src/renderer.ts` — replace `chromium` import |

After any change, run `pnpm test:unit` in the package to confirm the pure-logic tests still pass, then `pnpm build` to regenerate `dist/`.

---

## Environment Variables (`packages/engine/.env`)

See `.env.example` for the full annotated reference.

### Application URLs

| Variable | Default | Description |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | Primary app — Playwright's `baseURL` |
| `AUTH_URL` | `APP_URL` | Separate auth/IdP service |
| `ADMIN_URL` | `APP_URL` | Back-office panel |
| `XYZ_URL` / `ABC_URL` | — | Arbitrary integration services (`loadService('xyz')`) |

### TTS

| Variable | Default | Description |
| --- | --- | --- |
| `TTS_ADAPTER` | auto | `kokoro`, `openai`, or `null` |
| `OPENAI_API_KEY` | — | Required when `TTS_ADAPTER=openai` |
| `OPENAI_BASE_URL` | — | Enterprise proxy override |

### Render

| Variable | Default | Description |
| --- | --- | --- |
| `DOCS_VERSION` | `v1.0` | Output directory namespace |
| `RENDER_CODEC` | `h264` | `h264`, `h265`, `vp9`, `vp8` |
| `RENDER_CRF` | `18` | Quality (lower = better); h264 range 0–51 |
| `RENDER_PRESET` | `medium` | Encode speed: `ultrafast` → `veryslow` |
| `RENDER_CONCURRENCY` | half CPUs | Parallel headless browser tabs |
| `RENDER_LEAD_IN_SECONDS` | `1.0` | Silence before first narration step |
| `RENDER_LEAD_OUT_SECONDS` | `2.0` | Silence after last narration step |

### Diff thresholds

| Variable | Default | Description |
| --- | --- | --- |
| `ANCHOR_WARN_PX` | `20` | Anchor drift that triggers a warning |
| `ANCHOR_FAIL_PX` | `100` | Anchor drift that is breaking |

---

## Turborepo Pipeline DAG

```
^build (= renderer-compat#build)
    │
    ├──► test:docs
    │       │
    │       ├──► diff:check (optional CI gate — cache: false)
    │       │
    │       └──► generate:audio
    │                 │
    │                 └──► assemble  ← also depends on ^build
    │                           │
    │                           └──► build:pipeline
    │                                       │
    │                                       └──► @kinetic/docs-portal#build
```

`assemble` depends on `^build` so renderer-compat's `dist/` exists before `ts-node` runs `assemble.ts`. `diff:check` is not in `build:pipeline` — it's called explicitly in CI before `generate:audio` to abort on regressions before incurring API/render costs.

---

## Adding a New Documentation Page

```typescript
// e2e-tests/my-flow.spec.ts
import { test, expect } from '@playwright/test';
import { DocStore, docStep, docAssert, flushDocs } from '../src/lib/doc-extractor';

const store = new DocStore();
test.afterAll(async () => {
  await flushDocs(store);
});

test('My Flow', async ({ page }) => {
  store.page('my_page_id');
  await page.goto('/my-feature'); // relative → resolves via APP_URL
  await docStep(store, 'my_page_id', 'step_id', page, '#selector', 'string_key');
  await docAssert(
    store,
    'my_page_id',
    'assert_id',
    async () => {
      await expect(page.locator('#result')).toBeVisible();
    },
    'result_key',
  );
});
```

Add `pages.my_page_id` and `strings.string_key` / `strings.result_key` to every locale file. Run `pnpm turbo run build:pipeline`.

For a **text-only page** with no video, pass `{ videoless: true }` — the assemble script skips render/stitch stages, the portal omits the video player:

```typescript
store.page('overview', { videoless: true });
store.recordStep('overview', 'concept_a', null, 'concept_a_key');
```

---

## Adding a New Locale

1. Add `packages/engine/content/locales/<locale>.json` — must pass `LocaleSchema` (Zod validates on load).
2. Add a voice to `VOICE_REGISTRY` in `src/engine/VoiceRegistry.ts`.
3. If using Kokoro, add a mapping in `VOICE_MAP` in `src/lib/tts/kokoro.ts`.

The locale list is derived from the filesystem at runtime. No arrays to update elsewhere.

---

## Cross-Domain Integration Tests

Each service gets an `IntegrationActor` with its own isolated browser context:

```typescript
import { IntegrationActor } from '../src/lib/integration/actor';
import { loadService } from '../src/engine/domains';

const xyz = await IntegrationActor.create(browser, loadService('xyz'), {
  storageStatePath: '.auth/xyz.json',
});
try {
  await xyz.goto('/projects');
  await docStep(store, 'page_id', 'step', xyz.page, '#btn', 'key');
} finally {
  await xyz.close();
}
```

`global-setup.ts` reads `XYZ_EMAIL` / `XYZ_PASSWORD` from `.env`, logs in once, saves `.auth/xyz.json`. Add new services to the `SERVICES` array in that file.

---

## Audio Caching

`RobustTextStorage` uses SHA-256 content-addressable storage. Cache key = hash of `text|voiceId|engineVersion|speed`. Changing any of those four fields busts the cache. Changing `speed` was a known bug in the original MD5 implementation — it is now included.

---

## Video Timing — How Duration Is Calculated

`buildPageTimingSchedule()` (`src/lib/timing-schedule.ts`) walks the skeleton steps in order, looks up each step's real duration from the audio manifest (measured by `ffprobe`), and builds:

- `SubtitleCue[]` — text + `startFrame` + `durationFrames`
- `StepTiming[]` — bounding box + `startFrame` + `durationFrames`
- `totalFrames` — lead-in + content + lead-out

`assemble.ts` passes this schedule as `inputProps` to renderer-compat, so every subtitle and anchor is frame-accurate.

---

## Intro / Outro Pipeline

When `layer-config.json` contains an `intro` key, `assemble.ts` switches from direct render to a three-stage pipeline:

1. **Render** `KineticIntro` per locale × page (cached by hash of title + breadcrumbs + config)
2. **Render** `KineticDocs` content (intermediate path)
3. **Render** `KineticOutro` per locale (shared, cached by hash of config)
4. **Stitch** via `VideoStitcher.concat` (copy codec, no re-encode)
5. **Mix music** via FFmpeg filter if `music` is configured (single track, full duration, one fade envelope)

The final output path is identical to the no-intro path — the Astro portal and diff checker are unaffected.

`MusicLayer` inside `KineticDocs` is skipped when intro is configured (`!layerConfig.intro`). Music is applied post-stitch instead to avoid per-segment audio boundary jarring.

---

## Compositions

Three compositions registered in `packages/engine/src/index.tsx`:

| ID | Component | `inputProps` type |
| --- | --- | --- |
| `KineticDocs` | `KineticVideo` | `KineticVideoProps` (from `timing-schedule.ts`) |
| `KineticIntro` | `IntroSlide` | `IntroProps` (from `IntroSlide.tsx`) |
| `KineticOutro` | `OutroSlide` | `OutroProps` (from `OutroSlide.tsx`) |

`FPS`, `WIDTH`, `HEIGHT` are exported from `render-config.ts` and imported by both `index.tsx` and `assemble.ts` — the composition and the render script share the same constants and can never drift apart.

---

## Layer Config (`layer-config.json`)

Validated by `LayerConfigSchema` (Zod) in `src/engine/layer-config.ts`. All sections optional. If the file doesn't exist, defaults apply (no music, no watermark, default subtitle style, no intro/outro).

| Section | Effect when absent |
| --- | --- |
| `music` | No background audio |
| `watermark` | No logo overlay |
| `subtitleStyle` | Default pill style (32px, bottom, rgba(0,0,0,0.8)) |
| `intro` | Content renders directly to final path; `KineticIntro` never called |
| `outro` | No outro segment; music fades inside main content if configured |

Asset paths are public-relative: `/assets/logo.png` → `packages/engine/public/assets/logo.png`.

---

## Unit Tests

| Package | File count | Test count | What it covers |
| --- | --- | --- | --- |
| `@kinetic/renderer-compat` | 2 | 24 | `interpolate` (Remotion API parity, N-point ranges, all extrapolation modes, easing, validation), `findCompositions` (fragments, arrays, nesting, edge cases) |
| `@kinetic/engine` | 13 | 187 | See per-file table below |

### `@kinetic/engine` test files

| File | What it covers |
| --- | --- |
| `engine/SSMLBuilder.test.ts` | Fluent SSML builder |
| `engine/domains.test.ts` | URL validation, resolveUrl, trailing-slash stripping |
| `engine/layer-config.test.ts` | All LayerConfig schema paths including intro/outro |
| `engine/locale-schema.test.ts` | Locale JSON validation |
| `engine/render-config.test.ts` | RenderConfig validation, defaults, env parsing |
| `lib/differ/skeleton-diff.test.ts` | Structural diff: pages, steps, ordering, text keys |
| `lib/differ/anchor-diff.test.ts` | Bounding-box delta + all threshold bands |
| `lib/doc-extractor.test.ts` | DocStore, docStep/docAssert happy path, flushDocs merge |
| `lib/integration/actor.test.ts` | IntegrationActor: context creation, storageState, login, save |
| `lib/manifest-reader.test.ts` | secondsToFrames, getPageContentSeconds, getPageDurationFrames |
| `lib/stitch-and-mix.test.ts` | buildMusicFilterComplex, resolvePublicPath, cache hashing |
| `lib/storage/robust-text.test.ts` | CAS key (including speed field), write/read roundtrip |
| `lib/timing-schedule.test.ts` | buildPageTimingSchedule: ordering, locale isolation, edge cases |

All run in seconds with no browser, network, or API key.

---

## Conventions

- **Zod schemas** for any external/user input (locale JSON, layer-config.json, env vars). Throw a clear error at the boundary, never propagate raw `any` deeper.
- **Imports** in engine components use `@kinetic/renderer-compat`, never `remotion`. The TypeScript paths in `packages/engine/tsconfig.json` make this resolvable for `ts-node`.
- **No `any` in new code** — the renderer-compat package was written without `any` in non-test code, follow the same standard.
- **Pure-logic modules** (interpolate, jsx-traversal, manifest-reader, schemas, differs) belong in their own file with a sibling `*.test.ts`. They should not import React or Playwright.
- **Side-effecting modules** (renderer.ts, scripts/) wrap their work in `try/finally` to guarantee browser/server/temp-dir cleanup.
- **Comments** explain *why*, not *what*. The "what" should be obvious from the code; "why" captures non-obvious tradeoffs (e.g. why we use double-RAF before screenshot).

---

## CI/CD Notes

- **Never commit** `.env`, `.auth/`, `public/audio-objects/`, `public/video-cache/`, `public/visual-cache/`, `packages/*/dist/`, `.rc-bundle-cache/`.
- **Do commit** `generated/`, `public/audio-manifest-*.json`, `layer-config.json`, `public/assets/` (small files).
- Use `RENDER_PRESET=ultrafast` in CI — ~10× faster encoding with negligible quality difference.
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in CI install — install Chromium separately as a cached layer.
- `ffmpeg` must be on `PATH` in the CI runner. `apt install ffmpeg` for Ubuntu runners.
- The `.intermediate/` directory under `video-cache/` holds cached intro/outro renders. Treat as a build cache artifact (safe to delete, will re-render on next run).
- `packages/renderer-compat/dist/` is generated by `pnpm build` and gitignored. It must exist before `assemble` runs — the `^build` dependency in `turbo.json` enforces this.

---

## Knowledge Graph & Releases

Declarative knowledge lives in `packages/engine/content/knowledge/*.md` (YAML frontmatter + Markdown) and is compiled with the existing pipeline into versioned static releases. Full design, schema, and decisions: [`docs/knowledge/DESIGN.md`](./docs/knowledge/DESIGN.md).

```bash
cd packages/engine
pnpm knowledge:validate                       # errors fail; --strict also fails on warnings
pnpm release:build [--no-media] [--site DIR]  # CDN tree + offline ZIP, both verified
pnpm release:verify <dir|file.zip> [--offline]
pnpm release:promote <cdn-root> [<release-id>]  # promote or roll back; no id lists releases
pnpm knowledge:compile                        # dist/knowledge/ — the portal reads these files (run before the Astro build)
pnpm release:smoke                            # extracted ZIP + launcher + Chromium, non-root base
pnpm knowledge:query <release-dir> node <id> --depth 2
```

- Registries (node kinds, relationship types, evidence policy) are in `src/knowledge/registry.ts`. Change them deliberately and update tests.
- Procedures are **derived** from `extracted-skeleton.json` (`procedure:<pageId>`); reference them as targets, never re-author them. `playwright-step` evidence is checked against the skeleton.
- Only default-locale (`en-US`) text lives in the node file; other locales go under `knowledge` in `content/locales/<locale>.json` (ids must exist).
- Output must stay deterministic: no timestamps, no absolute paths, sorted keys/arrays. `release.test.ts` asserts identical ZIP bytes.
- URLs in the portal and release content must be document-relative (portal pages use `ROOT = '../../../'`). `verify.ts` rejects root-absolute URLs; Astro's `/_astro/` URLs are rewritten once in `relativizeAstroAssets`. Never add a `/…` link to the portal.
- `release:build --site ../../apps/docs-portal/dist [--declare-missing-media]` includes the built Astro portal; undeclared missing media fails the build.
- The portal's "Related knowledge" section (`RelatedKnowledge.astro`, `src/lib/knowledge.ts`) reads only the compiled files, never engine code. It is shown only for `compiled.json`'s `docsVersion`. Set `KINETIC_EXPLORER_PATH=` (empty) for a portal deployed without the explorer.
- `KnowledgeExplorer.tsx` (island) fetches `${ROOT}../knowledge/` at runtime (`KINETIC_KNOWLEDGE_PATH=` empty disables it). The smoke test runs axe-core; keep new portal UI at WCAG AA contrast (use `slate-600` or darker for small text).
- `file://` is unsupported for releases; use the bundled `serve.mjs`.

---

## User Guides (Diátaxis `guide` nodes)

Hand-written Markdown guides in a host repo can be imported into the knowledge graph, so they get the same graph, search index, release, CDN and offline ZIP as everything else. Set `paths.guides` in `kinetic.config.json` (or `KINETIC_GUIDES_DIR`); unset means no guides. Code: `packages/engine/src/knowledge/guides.ts` (pure, tests in `guides.test.ts`).

- **Id.** `guide:<file name>` unless frontmatter sets `id`. Title defaults to the first `#` heading, summary to the first paragraph.
- **Frontmatter** (strict; unknown keys fail): `type` (required: `tutorial | how-to | explanation | reference`), `categories` (`business-process | configuration | troubleshooting | role-tasks | release`, navigation only), `audience`, `prerequisites`, `startingPoint`, `outcome`, `result`, `appliesTo` (product version), `follows` / `related` (guide ids → `follows` / `related_to` edges), `verification` (`status: verified | partial | unverified`, `reviewedAt`, `reviewedBy`), `evidence` (same types as nodes), `provenance` (internal; never emitted).
- **Evidence rules.** `verified` without a machine-checkable `evidence` entry is an error. `partial` means evidence covers only part of the guide. Evidence `file` paths resolve against the Kinetic repo root and the directory holding `kinetic.config.json`.
- **Quality gates** run inside `pnpm knowledge:validate`. Errors: bad frontmatter, broken relative link or anchor, empty mermaid block, verified claim with no evidence. Warnings (heuristics that find suspicious gaps, not proof a procedure works; `--strict` fails on them): no numbered steps, starting point, outcome, verification or recovery in a how-to/tutorial; draft with no activate/approve/submit/post action; UI labels with no verification evidence; vague link text; diagram with no text explanation; stale review; missing `appliesTo`.
- **Relationships.** `follows` (guide → guide, acyclic) orders guides in a process. `related_to` and `supersedes` accept guides. `related_to` is symmetric, so declare each pair once.
- **Not done yet:** guides are not rendered as portal pages (they appear in the explorer, graph and search), and bodies are default-locale only.

---

## Portal Layout, Diátaxis and Procedure Style

- **Diátaxis.** Pages extracted from Playwright tests are procedures, so they are *How-to guides* by default; `store.page(id, { diataxis: 'tutorial' })` marks a learning walkthrough. Knowledge concepts/features are *Explanation* (the explorer). Header tabs are those quadrants; the sidebar only lists the current quadrant, grouped by `breadcrumbs[0]` › `breadcrumbs[1]`.
- **Procedure framing** lives in each locale's `pages.<id>`: optional `audience`, `duration`, `prerequisites[]`, `outcome`, `overview`, `done`. Optional `stepTitles.<textKey>` gives a step a short heading (narration still reads `strings`). Missing fields simply hide their UI.
- **Microsoft Writing Style Guide** (procedures): one action per numbered step, imperative verb first, "select" not "click", "go to" not "navigate to", no "please" or sequence words ("First,"), state results as facts, ≤ 7 steps, end with a completion statement. An assertion (`docAssert`) renders as the *result* of the step before it, not as a numbered step. `pnpm docs:lint` checks these heuristically for English locales (warnings only; `--strict` fails).
- **Chrome strings** (labels, not content) are in `apps/docs-portal/src/config.ts` → `uiStrings(locale)`, including Arabic relationship labels. Arabic chrome text was written for this portal and needs native review.
- **Icons** are `lucide-react` components rendered to static SVG at build time (no client JS). Use `className`, pass `aria-hidden="true"` for decorative icons, and add `rtl:rotate-180` to directional arrows/chevrons.
- **Dark mode** is Tailwind `darkMode: 'class'`, set before first paint from `localStorage['kinetic-theme']` or the OS setting. Every new surface needs `dark:` variants; use `k-text-primary` (lightened in dark) for brand-coloured text. The smoke test runs axe in light, dark and Arabic.
- **Optional env:** `KINETIC_LOGO` (header image), `KINETIC_SUPPORT_URL` (shows the "Need help?" card).
- The video player only renders when the MP4 exists in the public dir at build time, so doc-only builds show no broken player.

---

## Common Gotchas

- **Frame 0 is at time 0**, not at `1/fps`. The first narration step starts at `leadInFrames`, not at frame 0.
- **`FPS` lives in one place** (`src/engine/render-config.ts`). Never hardcode 30.
- **Locale files drive everything.** Adding a new page requires entries in *every* locale file. Zod will fail-fast if any locale is missing a referenced key.
- **`videoless: true` pages** still need locale entries. The portal renders them as text; the assembler skips them entirely.
- **The `<Audio>` no-op surprise.** When inspecting rendered video, music will only be present if intro/outro is enabled (see "Limitations" above).
- **Path traversal in the renderer's HTTP server is guarded.** Don't relax the `startsWith(rootWithSep)` check in `http-server.ts` without thinking — it stops `?path=../../etc/passwd` style attacks if the bundle is ever served beyond localhost.
- **`pnpm install` does not run `playwright install`.** Run `pnpm exec playwright install chromium` once after cloning.
