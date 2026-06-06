# CLAUDE.md — Kinetic Docs

> AI-assistant guide for the `kinetic-docs-turbo` monorepo.
> Read this file before making any changes to the codebase.

---

## What This Project Does

Kinetic Docs is a **docs-as-code pipeline** that auto-generates localized, video-enriched documentation directly from Playwright E2E tests. Engineers annotate UI tests with `docStep` / `docAssert` calls. The pipeline:

1. **Runs Playwright tests** → records screen video + writes `extracted-skeleton.json` with step metadata and bounding boxes.
2. **Generates TTS audio** via Kokoro (local, no API key) or OpenAI for every locale, caches by SHA-256 content hash.
3. **Builds a per-page timing schedule** from the audio manifest — subtitle cues and anchor timings keyed to exact frame numbers.
4. **Composites MP4s** via Remotion: subtitles, pulsing visual anchors, background music, watermark, intro/outro slides.
5. **Stitches segments** (`intro + content + outro`) and optionally adds a unified music track via FFmpeg post-stitch.
6. **Builds a static Astro portal** serving one HTML page per version × locale × page.

---

## Monorepo Layout

```
kinetic-docs-turbo/
├── turbo.json                             # Turborepo DAG (uses "tasks" key — Turbo v2)
├── pnpm-workspace.yaml
├── .prettierrc.json
├── layer-config.example.json             # Copy to layer-config.json to enable layers
│
└── packages/engine/                      # @kinetic/engine
    ├── .env.example                      # All env vars documented here
    ├── layer-config.json                 # (user-created) music, watermark, intro/outro
    ├── playwright.config.ts              # baseURL from APP_URL, globalSetup
    ├── vitest.config.ts                  # Includes src/**/*.test.ts, excludes e2e-tests/
    ├── content/locales/                  # SOURCE OF TRUTH — all copy lives here
    │   ├── en-US.json
    │   └── ar-AE.json
    ├── public/
    │   ├── assets/                       # Music files and logo images
    │   ├── audio-objects/                # OUTPUT (gitignored): hashed .mp3 files
    │   ├── audio-manifest-*.json         # OUTPUT (committed): per-locale step timings
    │   ├── visual-cache/v1.0/            # OUTPUT (gitignored): raw Playwright .webm
    │   └── video-cache/v1.0/             # OUTPUT (gitignored): final .mp4s
    │       └── .intermediate/            # OUTPUT: intro/outro cache + content temp files
    ├── e2e-tests/
    │   ├── global-setup.ts               # Pre-auth for all integration services
    │   ├── create-project.spec.ts
    │   ├── cross-domain-sync.spec.ts     # Example two-service integration test
    │   └── shared/login-flow.ts
    └── src/
        ├── index.tsx                     # Remotion root: KineticDocs, KineticIntro, KineticOutro
        ├── engine/
        │   ├── VoiceRegistry.ts          # Locale → voice profile (tone, speed, voiceId)
        │   ├── SSMLBuilder.ts            # Fluent SSML construction
        │   ├── domains.ts                # URL registry: DOMAINS, loadService(), resolveUrl()
        │   ├── layer-config.ts           # Zod: LayerConfig, IntroConfig, OutroConfig, MusicConfig …
        │   ├── locale-schema.ts          # Zod: LocaleData — validates locale JSON files
        │   └── render-config.ts          # Zod: RenderConfig + FPS / WIDTH / HEIGHT constants
        ├── components/
        │   ├── VisualAnchor.tsx          # Pulsing spotlight (accepts a single BoundingBox)
        │   ├── AnchorLayer.tsx           # Frame-aware wrapper — finds active step from StepTiming[]
        │   ├── SubtitleLayer.tsx         # Synchronized narration text with cross-fade
        │   ├── MusicLayer.tsx            # Background audio with interpolate() fade envelopes
        │   ├── WatermarkLayer.tsx        # Logo pinned to a corner with configurable margin
        │   ├── IntroSlide.tsx            # Branded opening — title/breadcrumb animation
        │   └── OutroSlide.tsx            # Branded closing — logo + CTA + fade to black
        ├── lib/
        │   ├── doc-extractor.ts          # DocStore class: page(), recordStep(), flushDocs()
        │   ├── manifest-reader.ts        # getPageContentSeconds, secondsToFrames, getPageDurationFrames
        │   ├── timing-schedule.ts        # buildPageTimingSchedule → SubtitleCue[], StepTiming[]
        │   ├── stitch-and-mix.ts         # stitchAndMix, buildMusicFilterComplex, cache hashing
        │   ├── stitcher.ts               # VideoStitcher.concat — FFmpeg copy-codec concat
        │   ├── differ/
        │   │   ├── types.ts              # Finding, DiffReport, buildReport
        │   │   ├── skeleton-diff.ts      # Structural comparison of DocPage[]
        │   │   ├── anchor-diff.ts        # Bounding-box delta with configurable thresholds
        │   │   └── visual-diff.ts        # FFmpeg pixel-diff artifacts (optional)
        │   ├── integration/
        │   │   └── actor.ts              # IntegrationActor — isolated browser context per service
        │   ├── storage/
        │   │   └── robust-text.ts        # RobustTextStorage — SHA-256 content-addressable cache
        │   └── tts/
        │       ├── adapter.ts            # TTSAdapter interface + NullTTSAdapter
        │       ├── kokoro.ts             # KokoroAdapter — Kokoro-82M via kokoro-js (local)
        │       └── openai.ts             # OpenAIAdapter — OpenAI TTS API
        └── scripts/
            ├── pre-render-audio.ts       # TTS generation + audio manifest writing
            ├── assemble.ts               # Remotion render + intro/outro stitch + music mix
            └── diff-check.ts             # Version diff CLI: --from v1.0 --to v2.0
```

---

## Key Commands

```bash
# From monorepo root:
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --ignore-scripts
pnpm turbo run test:unit          # 187 tests, ~4s, no browser/API key
pnpm turbo run build:pipeline     # full pipeline: test → audio → assemble
pnpm turbo run dev                # Astro portal dev server
pnpm turbo run build              # Astro portal production build

# From packages/engine/:
pnpm test:docs                    # Playwright E2E → skeleton + webm
pnpm generate:audio               # TTS → mp3 + audio manifests
pnpm assemble                     # Remotion render + stitch + mix
pnpm diff:check --from v1.0 --to v2.0
```

---

## Environment Variables (`packages/engine/.env`)

See `.env.example` for the full annotated reference. Key groups:

### Application URLs

| Variable              | Default                 | Description                                           |
| --------------------- | ----------------------- | ----------------------------------------------------- |
| `APP_URL`             | `http://localhost:3000` | Primary app — Playwright's `baseURL`                  |
| `AUTH_URL`            | `APP_URL`               | Separate auth/IdP service                             |
| `ADMIN_URL`           | `APP_URL`               | Back-office panel                                     |
| `XYZ_URL` / `ABC_URL` | —                       | Arbitrary integration services (`loadService('xyz')`) |

### TTS

| Variable          | Default | Description                        |
| ----------------- | ------- | ---------------------------------- |
| `TTS_ADAPTER`     | auto    | `kokoro`, `openai`, or `null`      |
| `OPENAI_API_KEY`  | —       | Required when `TTS_ADAPTER=openai` |
| `OPENAI_BASE_URL` | —       | Enterprise proxy override          |

### Render

| Variable                  | Default   | Description                               |
| ------------------------- | --------- | ----------------------------------------- |
| `DOCS_VERSION`            | `v1.0`    | Output directory namespace                |
| `RENDER_CODEC`            | `h264`    | `h264`, `h265`, `vp9`, `vp8`              |
| `RENDER_CRF`              | `18`      | Quality (lower = better); h264 range 0–51 |
| `RENDER_PRESET`           | `medium`  | Encode speed: `ultrafast` → `veryslow`    |
| `RENDER_CONCURRENCY`      | half CPUs | Parallel Remotion browser tabs            |
| `RENDER_LEAD_IN_SECONDS`  | `1.0`     | Silence before first narration step       |
| `RENDER_LEAD_OUT_SECONDS` | `2.0`     | Silence after last narration step         |

### Diff thresholds

| Variable         | Default | Description                          |
| ---------------- | ------- | ------------------------------------ |
| `ANCHOR_WARN_PX` | `20`    | Anchor drift that triggers a warning |
| `ANCHOR_FAIL_PX` | `100`   | Anchor drift that is breaking        |

---

## Turborepo Pipeline DAG

```
test:docs
    │
    ├──► diff:check (optional CI gate — cache: false)
    │
    └──► generate:audio
              │
              └──► assemble
                        │
                        └──► build:pipeline
                                    │
                                    └──► @kinetic/docs-portal#build
```

`diff:check` is not in `build:pipeline` — it's called explicitly in CI before `generate:audio` to abort on regressions before incurring API/render costs.

---

## Adding a New Locale

1. Add `packages/engine/content/locales/<locale>.json` — must pass `LocaleSchema` (Zod validates on load).
2. Add a voice to `VOICE_REGISTRY` in `src/engine/VoiceRegistry.ts`.
3. If using Kokoro, add a mapping in `VOICE_MAP` in `src/lib/tts/kokoro.ts`.

The locale list is derived from the filesystem at runtime. No arrays to update elsewhere.

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

Add `pages.my_page_id` and `strings.string_key`/`strings.result_key` to every locale file. Run `pnpm turbo run build:pipeline`.

For a **text-only page** with no video, pass `{ videoless: true }` — the assemble script skips all render/stitch stages, the portal omits the video player:

```typescript
store.page('overview', { videoless: true });
store.recordStep('overview', 'concept_a', null, 'concept_a_key');
```

The `videoless` flag is serialized to `extracted-skeleton.json` and round-trips cleanly through `flushDocs`. Steps on videoless pages still render as numbered written instructions in the portal.

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

`assemble.ts` passes this schedule as `inputProps` to Remotion, so every subtitle and anchor is frame-accurate. The `durationInFrames: 150` hardcode is gone.

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

## Remotion Compositions

Three compositions registered in `src/index.tsx`:

| ID             | Component      | `inputProps` type                               |
| -------------- | -------------- | ----------------------------------------------- |
| `KineticDocs`  | `KineticVideo` | `KineticVideoProps` (from `timing-schedule.ts`) |
| `KineticIntro` | `IntroSlide`   | `IntroProps` (from `IntroSlide.tsx`)            |
| `KineticOutro` | `OutroSlide`   | `OutroProps` (from `OutroSlide.tsx`)            |

`FPS`, `WIDTH`, `HEIGHT` are exported from `render-config.ts` and imported by both `index.tsx` and `assemble.ts` — the composition and the render script share the same constants and can never drift apart.

---

## Layer Config (`layer-config.json`)

Validated by `LayerConfigSchema` (Zod) in `src/engine/layer-config.ts`. All sections optional. If the file doesn't exist, defaults apply (no music, no watermark, default subtitle style, no intro/outro).

| Section         | Effect when absent                                                  |
| --------------- | ------------------------------------------------------------------- |
| `music`         | No background audio                                                 |
| `watermark`     | No logo overlay                                                     |
| `subtitleStyle` | Default pill style (32px, bottom, rgba(0,0,0,0.8))                  |
| `intro`         | Content renders directly to final path; `KineticIntro` never called |
| `outro`         | No outro segment; music fades inside main content if configured     |

Asset paths are public-relative: `/assets/logo.png` → `packages/engine/public/assets/logo.png`.

---

## Unit Tests

13 test files, 187 tests. All run in ~4s with no browser, network, or API key.

| File                               | What it covers                                                  |
| ---------------------------------- | --------------------------------------------------------------- |
| `engine/SSMLBuilder.test.ts`       | Fluent SSML builder                                             |
| `engine/domains.test.ts`           | URL validation, resolveUrl, trailing-slash stripping            |
| `engine/layer-config.test.ts`      | All LayerConfig schema paths including intro/outro              |
| `engine/locale-schema.test.ts`     | Locale JSON validation                                          |
| `engine/render-config.test.ts`     | RenderConfig validation, defaults, env parsing                  |
| `lib/differ/skeleton-diff.test.ts` | Structural diff: pages, steps, ordering, text keys              |
| `lib/differ/anchor-diff.test.ts`   | Bounding-box delta + all threshold bands                        |
| `lib/doc-extractor.test.ts`        | DocStore, docStep/docAssert happy path, flushDocs merge         |
| `lib/integration/actor.test.ts`    | IntegrationActor: context creation, storageState, login, save   |
| `lib/manifest-reader.test.ts`      | secondsToFrames, getPageContentSeconds, getPageDurationFrames   |
| `lib/stitch-and-mix.test.ts`       | buildMusicFilterComplex, resolvePublicPath, cache hashing       |
| `lib/storage/robust-text.test.ts`  | CAS key (including speed field), write/read roundtrip           |
| `lib/timing-schedule.test.ts`      | buildPageTimingSchedule: ordering, locale isolation, edge cases |

---

## CI/CD Notes

- **Never commit** `.env`, `.auth/`, `public/audio-objects/`, `public/video-cache/`, `public/visual-cache/`.
- **Do commit** `generated/`, `public/audio-manifest-*.json`, `layer-config.json`, `public/assets/` (small files).
- Use `RENDER_PRESET=ultrafast` in CI — ~10× faster encoding with negligible quality difference.
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in CI install — install Chromium separately as a cached layer.
- The `.intermediate/` directory under `video-cache/` holds cached intro/outro renders. Treat as a build cache artifact (safe to delete, will re-render on next run).
