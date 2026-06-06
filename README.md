# Kinetic Docs

> **Docs-as-Code pipeline** — auto-generates localized, video-enriched documentation directly from Playwright E2E tests. No manual screencasts. No copy-paste drift.

Engineers annotate their existing UI tests with `docStep` and `docAssert` calls. The pipeline extracts step metadata, generates AI voiceover for every locale, and composites final MP4 tutorials with synchronized subtitles, pulsing visual anchors, branded intro/outro slides, and optional background music.

---

## How It Works

```
Playwright E2E tests
       │  annotated with docStep / docAssert
       ▼
┌─────────────────────┐
│  1. test:docs       │  Runs tests → records screen video (webm) + writes
│  (Playwright)       │  extracted-skeleton.json with step metadata & bounding boxes
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  2. diff:check      │  Compares skeleton against previous version.
│  (optional CI gate) │  Exits 1 on breaking changes before any API spend.
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  3. generate:audio  │  For each locale × step: generates TTS (Kokoro locally
│  (Kokoro / OpenAI)  │  or OpenAI), caches by content hash, writes audio-manifest
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  4. assemble        │  Remotion renders per-page MP4s with subtitles, anchors,
│  (Remotion)         │  music, watermark. Stitches intro + content + outro.
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  5. build           │  Astro compiles a static portal — one HTML page per
│  (Astro SSG)        │  version × locale × page, with embedded video player
└─────────────────────┘
```

---

## Monorepo Structure

```
kinetic-docs-turbo/
├── layer-config.example.json     # Copy to layer-config.json — music, watermark, intro/outro
├── packages/engine/              # @kinetic/engine — the pipeline core
│   ├── content/locales/          # Source of truth for all copy (en-US, ar-AE, …)
│   ├── public/assets/            # Static assets: music files, logo images
│   ├── e2e-tests/
│   │   ├── global-setup.ts       # Pre-authenticates all integration services once
│   │   ├── create-project.spec.ts
│   │   ├── cross-domain-sync.spec.ts  # Example cross-domain integration test
│   │   └── shared/login-flow.ts
│   └── src/
│       ├── engine/
│       │   ├── VoiceRegistry.ts       # Locale → voice profile mapping
│       │   ├── SSMLBuilder.ts         # Programmatic speech markup
│       │   ├── domains.ts             # URL registry (APP_URL, AUTH_URL, loadService())
│       │   ├── layer-config.ts        # Zod schema for layer-config.json
│       │   ├── locale-schema.ts       # Zod schema for locale JSON files
│       │   └── render-config.ts       # Zod schema for RENDER_* env vars + FPS/WIDTH/HEIGHT
│       ├── components/
│       │   ├── VisualAnchor.tsx       # Pulsing bounding-box highlight (single step)
│       │   ├── AnchorLayer.tsx        # Frame-aware wrapper — picks active anchor
│       │   ├── SubtitleLayer.tsx      # Synchronized narration text with cross-fade
│       │   ├── MusicLayer.tsx         # Background audio with fade envelopes
│       │   ├── WatermarkLayer.tsx     # Logo pinned to a corner
│       │   ├── IntroSlide.tsx         # Branded opening (title + breadcrumbs animation)
│       │   └── OutroSlide.tsx         # Branded closing (logo + optional CTA)
│       ├── lib/
│       │   ├── doc-extractor.ts       # DocStore, docStep, docAssert, flushDocs
│       │   ├── manifest-reader.ts     # Audio manifest → frame counts
│       │   ├── timing-schedule.ts     # buildPageTimingSchedule — SubtitleCue[], StepTiming[]
│       │   ├── stitch-and-mix.ts      # Concat segments + add music post-stitch
│       │   ├── stitcher.ts            # FFmpeg concat wrapper
│       │   ├── differ/                # Version diff engine (structural + anchor + visual)
│       │   ├── integration/
│       │   │   └── actor.ts           # IntegrationActor — isolated browser context per service
│       │   ├── storage/robust-text.ts # Content-addressable audio cache (SHA-256)
│       │   └── tts/
│       │       ├── adapter.ts         # TTSAdapter interface + NullTTSAdapter
│       │       ├── kokoro.ts          # Local Kokoro-82M adapter (no API key)
│       │       └── openai.ts          # OpenAI TTS adapter
│       ├── scripts/
│       │   ├── pre-render-audio.ts    # Step 2: TTS generation
│       │   ├── assemble.ts            # Step 3: render + stitch + mix
│       │   └── diff-check.ts          # CI: version diff report
│       └── index.tsx                  # Remotion root — KineticDocs, KineticIntro, KineticOutro
└── apps/docs-portal/                  # @kinetic/docs-portal — Astro static site
    └── src/
        ├── layouts/DocLayout.astro    # Sidebar nav + version switcher
        ├── components/KineticPlayer.tsx
        └── pages/[version]/[locale]/[pageId].astro
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- pnpm ≥ 8 (`npm install -g pnpm`)
- ffmpeg in `$PATH` (required for `diff:check --visual`, `assemble`, and the music post-stitch step)

### Install

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --ignore-scripts
```

### Configure

```bash
cp packages/engine/.env.example packages/engine/.env
# Set APP_URL to your application's base URL
# Leave OPENAI_API_KEY blank to use Kokoro (local TTS, no API key required)
```

### Run the full pipeline

```bash
pnpm turbo run build:pipeline
```

### Unit tests only

```bash
pnpm turbo run test:unit
# 187 tests across 13 files, ~4s, no browser or API key required
```

### Launch the docs portal locally

```bash
pnpm turbo run dev
```

---

## Configuring URLs

All URLs are set in `packages/engine/.env`. No code changes required to switch environments.

### Environment switching

```bash
APP_URL=http://localhost:3000        # local dev (default)
APP_URL=https://staging.myapp.com   # staging
APP_URL=https://myapp.com           # production
```

`APP_URL` becomes Playwright's `baseURL` — all relative paths in tests (`page.goto('/projects')`) resolve against it.

### Cross-domain integration

For products spanning multiple origins (separate auth service, admin panel, external API):

```bash
APP_URL=https://app.myapp.com      # primary — relative paths resolve here
AUTH_URL=https://auth.myapp.com    # separate IdP / SSO
ADMIN_URL=https://admin.myapp.com  # back-office
```

For arbitrary integration services, use `loadService()` by convention:

```bash
XYZ_URL=https://au.xyz.com         # loadService('xyz') reads XYZ_URL
ABC_URL=https://abc.com            # loadService('abc') reads ABC_URL
```

All URLs are validated with Zod at import time — a malformed URL or missing protocol throws immediately before any test runs.

### Cross-domain integration tests

`IntegrationActor` gives each service its own isolated browser context (separate cookie jar):

```typescript
import { IntegrationActor } from '../src/lib/integration/actor';
import { loadService } from '../src/engine/domains';

const xyzUrl = loadService('xyz');
const abcUrl = loadService('abc');

const xyz = await IntegrationActor.create(browser, xyzUrl, {
  storageStatePath: '.auth/xyz.json', // restored from global-setup.ts
});
const abc = await IntegrationActor.create(browser, abcUrl, {
  storageStatePath: '.auth/abc.json',
});

try {
  await xyz.goto('/projects');
  await docStep(store, 'sync_flow', 'create', xyz.page, '#create-btn', 'create_key');

  await abc.goto('/dashboard');
  await docAssert(
    store,
    'sync_flow',
    'verify',
    async () => {
      await expect(abc.page.locator('.synced-project')).toBeVisible({ timeout: 15_000 });
    },
    'verify_key',
  );
} finally {
  await xyz.close();
  await abc.close();
}
```

`e2e-tests/global-setup.ts` authenticates all configured services once before the suite runs and saves sessions to `.auth/<service>.json`. Configure credentials in `.env` (`XYZ_EMAIL`, `XYZ_PASSWORD`, etc.).

---

## TTS Configuration

The pipeline selects a TTS adapter automatically. Control it explicitly with `TTS_ADAPTER`:

| `TTS_ADAPTER`      | Description                                          | Requires                     |
| ------------------ | ---------------------------------------------------- | ---------------------------- |
| `kokoro` (default) | Kokoro-82M local model, ~90 MB download on first run | Nothing — just `npm install` |
| `openai`           | OpenAI TTS API, best quality                         | `OPENAI_API_KEY`             |
| `null`             | Silent placeholder (CI runs that skip audio)         | Nothing                      |

**Auto-detection:** if `OPENAI_API_KEY` is set and `TTS_ADAPTER` is unset, OpenAI is used. Otherwise Kokoro.

The Kokoro model caches to `~/.cache/huggingface/hub/` after the first download. No network connection needed after that.

---

## Render Configuration

All render options have sensible defaults. Override via `.env`:

| Variable                  | Default   | Description                                                       |
| ------------------------- | --------- | ----------------------------------------------------------------- |
| `RENDER_CODEC`            | `h264`    | Output codec: `h264`, `h265`, `vp9`, `vp8`                        |
| `RENDER_CRF`              | `18`      | Quality vs file size (lower = better). h264/h265: 0–51; vp9: 0–63 |
| `RENDER_PRESET`           | `medium`  | Encode speed for h264/h265: `ultrafast` → `veryslow`              |
| `RENDER_CONCURRENCY`      | half CPUs | Parallel browser tabs Remotion opens                              |
| `RENDER_LEAD_IN_SECONDS`  | `1.0`     | Silence before first narration step                               |
| `RENDER_LEAD_OUT_SECONDS` | `2.0`     | Silence after last narration step                                 |

**CI recommendation:** `RENDER_PRESET=ultrafast` — reduces encode time by ~10× at negligible quality cost.
**Release recommendation:** `RENDER_PRESET=slow RENDER_CRF=23` — smaller files for distribution.

---

## Layer Configuration

Copy `layer-config.example.json` to `layer-config.json` and fill in your asset paths. All sections are optional.

```json
{
  "intro": {
    "durationSeconds": 4,
    "backgroundColor": "#0f172a",
    "accentColor": "#3b82f6",
    "showBreadcrumbs": true
  },
  "outro": { "durationSeconds": 3, "backgroundColor": "#0f172a", "ctaText": "docs.mycompany.com" },
  "music": {
    "src": "/assets/background.mp3",
    "volume": 0.15,
    "fadeInFrames": 30,
    "fadeOutFrames": 60
  },
  "watermark": {
    "src": "/assets/logo.png",
    "position": "bottom-right",
    "opacity": 0.7,
    "widthPx": 180
  },
  "subtitleStyle": { "fontSize": 32, "position": "bottom", "fadeFrames": 5 }
}
```

Place assets in `packages/engine/public/assets/` and reference them as `/assets/filename`.

### Intro / Outro

When `intro` is configured, the pipeline switches to a **stitch-and-mix** workflow:

```
[KineticIntro] + [KineticDocs content] + [KineticOutro]
                         ↓ VideoStitcher (copy codec, no re-encode)
                    stitched.mp4
                         ↓ FFmpeg music overlay (if music configured)
              en-US_create_project.mp4  ← same final path as before
```

Intro and outro renders are **cached by hash** — re-rendered only when their title, breadcrumbs, or styling config changes. The outro renders once per locale (shared across all pages).

When `intro` is configured and `music` is also set, music is added as a single post-stitch FFmpeg audio track with fade envelopes spanning the full video. This avoids the audio-boundary problem that would occur if each segment rendered its own independent music track.

---

## Adding a New Locale

1. **Add locale file** — `packages/engine/content/locales/<locale>.json`
   Must include `locale` (BCP-47), `dir` (`ltr` | `rtl`), `pages`, and `strings`. Validated by Zod on load.

2. **Register a voice** — add an entry to `VOICE_REGISTRY` in `src/engine/VoiceRegistry.ts`. If using Kokoro, also add a mapping in `src/lib/tts/kokoro.ts`.

3. **That's it.** The audio generator, assembler, and Astro portal all derive the locale list from the `content/locales/` filesystem at runtime.

---

## Adding a New Documentation Page

**1. Write the Playwright spec:**

```typescript
import { test, expect } from '@playwright/test';
import { DocStore, docStep, docAssert, flushDocs } from '../src/lib/doc-extractor';

const store = new DocStore();
test.afterAll(async () => {
  await flushDocs(store);
});

test('My Flow', async ({ page }) => {
  store.page('my_page_id');
  await page.goto('/my-feature');
  await docStep(store, 'my_page_id', 'click_btn', page, '#my-button', 'btn_string_key');
  await docAssert(
    store,
    'my_page_id',
    'see_result',
    async () => {
      await expect(page.locator('#result')).toBeVisible();
    },
    'result_string_key',
  );
});
```

**2. Add copy to each locale file** — entries in both `pages` and `strings`.

**3. Run `pnpm turbo run build:pipeline`** — the portal picks up the new page automatically.

### Text-only pages (no video)

For conceptual content, reference pages, or any page where a video adds no value, pass
`{ videoless: true }`:

```typescript
test('Architecture Overview', async () => {
  store.page('architecture', { videoless: true });
  // Steps still render as numbered written instructions — no video recorded or rendered
  store.recordStep('architecture', 'intro', null, 'architecture_intro_key');
});
```

The assemble script skips all video render and stitch stages for videoless pages. The Astro
portal renders the page with its description and step list but no video player — the layout
adapts automatically with the step list flowing immediately after the description.

---

## Version Diffing

```bash
# Structural + anchor diff (fast, no ffmpeg)
pnpm diff:check --from v1.0 --to v2.0

# With visual pixel-diff artifacts for human review
pnpm diff:check --from v1.0 --to v2.0 --visual

# Filter to a single locale
pnpm diff:check --from v1.0 --to v2.0 --visual --locale en-US
```

**Exit codes:** `0` clean/additive · `1` breaking changes · `2` script error

| Severity   | Examples                                                    |
| ---------- | ----------------------------------------------------------- |
| `breaking` | Page/step removed, text key renamed, anchor drifted >100px  |
| `warning`  | Step reordered, anchor drifted 20–100px, anchor disappeared |
| `info`     | Page/step added, anchor appeared                            |

The JSON report at `generated/<version>/diff-from-<previous>.json` is machine-readable for CI bots, Slack alerts, and PR comment actions.

**Recommended CI workflow:**

```yaml
- run: pnpm test:docs
- run: pnpm diff:check --from v1.0 --to v2.0 # exit 1 blocks the next step
- run: pnpm generate:audio
- run: pnpm assemble
- uses: actions/upload-artifact@v4
  with:
    name: visual-diffs
    path: packages/engine/generated/v2.0/visual-diff/
```

---

## Audio Caching

Audio files are stored at `public/audio-objects/<sha256>.mp3` where the hash covers `text + voiceId + engineVersion + speed`. Changing any of those four values busts the cache.

**Never delete `public/audio-objects/`** unless you want to regenerate everything and incur API or model inference costs.

---

## What to Commit

| Path                                            | Commit?    | Reason                                   |
| ----------------------------------------------- | ---------- | ---------------------------------------- |
| `generated/<version>/extracted-skeleton.json`   | ✅ Yes     | Required by `diff:check` and Astro build |
| `public/audio-manifest-<version>-<locale>.json` | ✅ Yes     | Required by Astro build                  |
| `layer-config.json`                             | ✅ Yes     | Project-level composition config         |
| `public/assets/logo.png`                        | ✅ Yes     | Small static asset                       |
| `public/assets/background.mp3`                  | ⚠️ Git LFS | Music files can be 5–30 MB               |
| `public/audio-objects/`                         | ❌ No      | Large binaries, regenerated from cache   |
| `public/video-cache/`                           | ❌ No      | Large binaries, regenerated by assemble  |
| `public/visual-cache/`                          | ❌ No      | Raw Playwright webm recordings           |
| `.env`                                          | ❌ Never   | Contains API keys and credentials        |
| `.auth/`                                        | ❌ Never   | Live Playwright session tokens           |

---

## Tech Stack

| Layer                         | Technology                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Test runner & screen recorder | [Playwright](https://playwright.dev)                                                                                              |
| Local TTS (default)           | [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) via [kokoro-js](https://www.npmjs.com/package/kokoro-js) |
| Cloud TTS (optional)          | [OpenAI TTS](https://platform.openai.com/docs/guides/text-to-speech)                                                              |
| Video compositor              | [Remotion](https://www.remotion.dev)                                                                                              |
| Static site generator         | [Astro](https://astro.build)                                                                                                      |
| Schema validation             | [Zod](https://zod.dev)                                                                                                            |
| Monorepo orchestration        | [Turborepo](https://turbo.build) + [pnpm](https://pnpm.io)                                                                        |
| Unit testing                  | [Vitest](https://vitest.dev)                                                                                                      |
| Code formatting               | [Prettier](https://prettier.io)                                                                                                   |

---

## Importing into an Existing Monorepo

```bash
git subtree add --prefix=packages/kinetic-docs \
  https://github.com/your-org/kinetic-docs main --squash
```

After pulling: delete `pnpm-workspace.yaml`, merge `turbo.json` `tasks` into your root config, and adjust the Astro `publicDir` path if needed.

---

## Display-Only Notes and Internal Comments

Two mechanisms for text that falls outside the normal action/assertion flow:

### Notes — display in portal, no audio

```typescript
store.recordNote('checkout', 'admin_note', 'admin_required_key');
// or with the convenience wrapper:
docNote(store, 'checkout', 'admin_note', 'admin_required_key');
```

Add the key to each locale file: `"admin_required_key": "Note: This step requires admin permissions."`

Notes appear in the portal step list as a styled info callout (blue box, ℹ icon) rather than a
numbered step. No TTS is generated. No subtitle appears in the video. No anchor highlight is drawn.
Notes are localized — add their keys to every locale file like any other string.

### Comments — stripped from all output

```typescript
store.recordComment('checkout', 'TODO: update this step when the V2 modal ships');
```

Comments are stripped by `flushDocs()` before the skeleton JSON is written. They never appear in
any output — no portal, no audio manifest, no video. Use them instead of JSON file comments (JSON
has no comment syntax) or when you want an author note positioned next to a specific step for
context in the spec file.

Comments accept freeform inline text — not a locale key, never localized.
