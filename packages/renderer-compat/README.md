# @kinetic/renderer-compat

MIT-licensed drop-in replacement for [Remotion](https://www.remotion.dev/), built on Playwright + esbuild + FFmpeg.

Re-implements the Remotion API surface used inside the KineticDocs engine. The user-facing React code is unchanged — only the import path differs.

## Why this exists

Remotion is a great library, but its license requires a paid Company License above certain revenue/team thresholds. This package provides the same hooks and components under the MIT License so the docs pipeline can be redistributed without licence-tier friction. Internally Remotion uses Puppeteer + FFmpeg; this package does the same thing directly, removing the proprietary layer.

## What it implements

| Symbol | Source | Notes |
| --- | --- | --- |
| `AbsoluteFill` | `'@kinetic/renderer-compat'` | Identical |
| `Composition` | `'@kinetic/renderer-compat'` | Identical |
| `useCurrentFrame` | `'@kinetic/renderer-compat'` | Identical |
| `useVideoConfig` | `'@kinetic/renderer-compat'` | Identical |
| `interpolate` | `'@kinetic/renderer-compat'` | Supports N-point ranges, `clamp`/`extend`/`identity` extrapolation, and a custom easing function |
| `registerRoot` | `'@kinetic/renderer-compat'` | Identical |
| `Img` | `'@kinetic/renderer-compat'` | Plain `<img>` passthrough |
| `Audio` | `'@kinetic/renderer-compat'` | **No-op during rendering — audio is mixed by FFmpeg post-encode (see Limitations).** |
| `Video` | `'@kinetic/renderer-compat'` | No-op placeholder. Source video is composited by FFmpeg, not React. |
| `bundle` | `'@kinetic/renderer-compat/bundler'` | Identical signature, esbuild under the hood |
| `selectComposition` | `'@kinetic/renderer-compat/renderer'` | Identical signature |
| `renderMedia` | `'@kinetic/renderer-compat/renderer'` | Identical signature plus `frameTimeoutMs`, `logProgress` |

## Install

```bash
pnpm add @kinetic/renderer-compat
pnpm exec playwright install chromium   # one-time browser download
```

System `ffmpeg` must be on `PATH`:

- Debian / Ubuntu: `sudo apt install ffmpeg`
- macOS: `brew install ffmpeg`
- Windows: `choco install ffmpeg`

## Use

The user-facing React code is identical to the Remotion version, only the import path changes:

```tsx
// before
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

// after
import { AbsoluteFill, useCurrentFrame, interpolate } from '@kinetic/renderer-compat';
```

The Node.js bundler/render entry points are also drop-ins:

```ts
import { bundle } from '@kinetic/renderer-compat/bundler';
import { selectComposition, renderMedia } from '@kinetic/renderer-compat/renderer';

const serveUrl = await bundle({
  entryPoint: path.resolve('src/index.tsx'),
  outDir: path.resolve('.rc-bundle-cache/bundle'),
});

const composition = await selectComposition({
  serveUrl,
  id: 'KineticDocs',
  inputProps,
});

await renderMedia({
  composition,
  serveUrl,
  outputLocation: 'out.mp4',
  inputProps,
  durationInFrames: 90,
  codec: 'h264',
  crf: 18,
  x264Preset: 'medium',
  concurrency: 4,
});
```

## How it works

1. `bundle()` runs esbuild against the entry point. Imports of `'remotion'` are aliased to this package's `react-api.tsx`. The output is a single IIFE bundle plus an HTML runner.
2. `selectComposition()` starts a local HTTP server, opens one Playwright page against `?mode=list`, reads the registered composition list from `window.__compositions`, and returns the entry matching `id`.
3. `renderMedia()` opens `concurrency` Playwright pages, navigates each once to `?mode=render`, and waits for `window.__rendererReady`. For each frame it calls `window.__renderFrame(id, frame, propsJson)` via `page.evaluate()`, waits for `window.__frameReady === true`, and screenshots to disk. After all PNGs are written, FFmpeg encodes them to MP4.

The load-once + setFrame loop is dramatically faster than navigating to a new URL per frame — the bundle is only parsed once per page in the pool.

## Limitations

- **Audio playback during rendering is not captured.** Headless Chromium cannot route audio output to a file. The `<Audio>` component is a no-op. The KineticDocs engine already handles this by mixing music with FFmpeg in `stitch-and-mix.ts` after encoding. If you use `<Audio>` outside that flow, you need to add a similar post-encode FFmpeg pass.
- **`<Video>` is a no-op placeholder.** Source video files are composited by FFmpeg, not by the React composition. This matches how the engine consumes Playwright-recorded `.webm` files.
- **No Remotion Studio / Player.** This is a render-pipeline-only package. Preview and timeline UIs are out of scope.

## Tests

```bash
pnpm test:unit   # vitest
```

Unit tests cover `interpolate` (Remotion API parity, N-point ranges, all extrapolation modes, easing) and `findCompositions` (JSX traversal: fragments, arrays, nesting). The Playwright-based renderer is integration-tested in the engine package's `assemble` task.

## License

MIT — see `LICENSE`.
