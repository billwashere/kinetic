/**
 * renderer.ts  —  @kinetic/renderer-compat/renderer
 *
 * MIT-licensed drop-in for `@remotion/renderer`.
 *
 * Public API
 * ──────────
 *   selectComposition({ serveUrl, id, inputProps })   → CompositionInfo + inputProps
 *   renderMedia({ composition, serveUrl, outputLocation, ...renderOpts })
 *
 * Both signatures match @remotion/renderer's so assemble.ts is unchanged.
 *
 * Implementation
 * ──────────────
 * 1. Spin up a tiny local HTTP server serving the bundle directory.
 * 2. Open `concurrency` Playwright pages, navigate each to ?mode=render once,
 *    and wait for window.__rendererReady (signalled after fonts load).
 * 3. For each frame, distribute work across the page pool by calling
 *    window.__renderFrame(id, frame, propsJson) via page.evaluate(), waiting
 *    for window.__frameReady === true, and screenshotting to disk.
 * 4. After all frames are written, encode them into a video with ffmpeg.
 *
 * Why Playwright (not Puppeteer)
 * ──────────────────────────────
 * The engine package already depends on @playwright/test for e2e tests, which
 * downloads its own Chromium build. Reusing Playwright avoids a second
 * ~150 MB Chromium install for the same job.
 */

import path from 'path';
import fs from 'fs-extra';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer, type ServerHandle } from './http-server';
import { encodeFramesToVideo, type RenderCodec, ensureFfmpeg } from './ffmpeg';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompositionInfo {
  id: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultProps?: Record<string, any>;
}

export interface SelectedComposition extends CompositionInfo {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputProps: Record<string, any>;
}

export interface SelectCompositionOptions {
  /** Path returned by bundle() — the directory containing index.html + bundle.js. */
  serveUrl: string;
  /** Composition id, e.g. "KineticDocs". */
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputProps?: Record<string, any>;
}

export interface RenderMediaOptions {
  composition: SelectedComposition;
  serveUrl: string;
  outputLocation: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputProps?: Record<string, any>;
  durationInFrames?: number;
  codec?: RenderCodec;
  crf?: number;
  x264Preset?: string;
  /** How many parallel pages to render with. Default 4. */
  concurrency?: number;
  /** Per-frame render timeout in ms. Default 30_000. */
  frameTimeoutMs?: number;
  /** Whether to log progress to stdout. Default true. */
  logProgress?: boolean;
}

export type { RenderCodec };

// ─── Playwright launch args ──────────────────────────────────────────────────

const CHROMIUM_ARGS = [
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-dev-shm-usage',          // important in containerised environments
  '--run-all-compositor-stages-before-draw',
];

// ─── Utility: create a browser with broken-pipe friendly cleanup ─────────────

async function withBrowserAndServer<T>(
  serveUrl: string,
  handler: (browser: Browser, server: ServerHandle) => Promise<T>,
): Promise<T> {
  const server = await startServer({ rootDir: serveUrl });
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    return await handler(browser, server);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

// ─── selectComposition ──────────────────────────────────────────────────────

export async function selectComposition({
  serveUrl,
  id,
  inputProps = {},
}: SelectCompositionOptions): Promise<SelectedComposition> {
  return withBrowserAndServer(serveUrl, async (browser, server) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${server.url}/?mode=list`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => (window as Window & { __compositionsReady?: boolean }).__compositionsReady === true, undefined, {
        timeout: 30_000,
      });

      const compositions = (await page.evaluate(() =>
        (window as Window & { __compositions?: CompositionInfo[] }).__compositions ?? [],
      )) as CompositionInfo[];

      const comp = compositions.find((c) => c.id === id);
      if (!comp) {
        const available = compositions.map((c) => `"${c.id}"`).join(', ') || '(none)';
        throw new Error(
          `Composition "${id}" not found in bundle.\n  Available compositions: ${available}\n  Bundle: ${serveUrl}`,
        );
      }
      return { ...comp, inputProps };
    } finally {
      await page.close().catch(() => {});
    }
  });
}

// ─── renderMedia ─────────────────────────────────────────────────────────────

export async function renderMedia(opts: RenderMediaOptions): Promise<void> {
  const {
    composition,
    serveUrl,
    outputLocation,
    inputProps = {},
    durationInFrames,
    codec = 'h264',
    crf = 18,
    x264Preset = 'medium',
    concurrency = 4,
    frameTimeoutMs = 30_000,
    logProgress = true,
  } = opts;

  // Fail fast if ffmpeg is missing — much better than discovering it after a 5-minute render.
  await ensureFfmpeg();

  const totalFrames = durationInFrames ?? composition.durationInFrames;
  if (totalFrames <= 0) {
    throw new Error(`renderMedia: durationInFrames must be > 0, got ${totalFrames}`);
  }

  const { fps, width, height } = composition;

  // Merge precedence: composition.defaultProps < composition.inputProps < call-site inputProps
  const mergedProps = {
    ...composition.defaultProps,
    ...composition.inputProps,
    ...inputProps,
  };
  const propsJson = JSON.stringify(mergedProps);

  await fs.ensureDir(path.dirname(path.resolve(outputLocation)));

  const framesDir = path.join(
    path.dirname(path.resolve(outputLocation)),
    `.rc_frames_${process.pid}_${Date.now()}`,
  );
  await fs.ensureDir(framesDir);

  const startedAt = Date.now();

  try {
    await withBrowserAndServer(serveUrl, async (browser, server) => {
      const poolSize = Math.max(1, Math.min(concurrency, totalFrames));

      // ── Open and warm the page pool ────────────────────────────────────────
      const pages: Page[] = await Promise.all(
        Array.from({ length: poolSize }, async () => {
          const page = await browser.newPage({
            viewport: { width, height },
            deviceScaleFactor: 1,
          });

          // Fail fast on uncaught browser errors — they bubble up to the host.
          page.on('pageerror', (err) => {
            console.error(`[renderer-compat] Browser page error: ${err.message}`);
          });

          await page.goto(`${server.url}/?mode=render`, { waitUntil: 'networkidle' });
          await page.waitForFunction(
            () => (window as Window & { __rendererReady?: boolean }).__rendererReady === true,
            undefined,
            { timeout: 30_000 },
          );
          return page;
        }),
      );

      // ── Render frames in batches across the pool ───────────────────────────
      let rendered = 0;
      const printProgress = () => {
        if (!logProgress) return;
        const pct = ((rendered / totalFrames) * 100).toFixed(0);
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        const fpsActual = (rendered / Math.max(0.1, (Date.now() - startedAt) / 1000)).toFixed(1);
        process.stdout.write(
          `\r   🖼️  Rendering: ${rendered}/${totalFrames} (${pct}%)  ${fpsActual} fps  ${elapsed}s elapsed   `,
        );
      };

      for (let batchStart = 0; batchStart < totalFrames; batchStart += poolSize) {
        const batch = Array.from(
          { length: Math.min(poolSize, totalFrames - batchStart) },
          (_, i) => batchStart + i,
        );

        await Promise.all(
          batch.map(async (frame, idx) => {
            const page = pages[idx];
            const framePath = path.join(framesDir, `frame_${String(frame).padStart(6, '0')}.png`);

            // Trigger the React state update for this frame
            await page.evaluate(
              ([id, f, p]) => {
                const w = window as Window & {
                  __renderFrame?: (id: string, f: number, p: string) => void;
                };
                if (typeof w.__renderFrame !== 'function') {
                  throw new Error('renderer-compat: __renderFrame is not bound');
                }
                w.__renderFrame(id as string, f as number, p as string);
              },
              [composition.id, frame, propsJson] as const,
            );

            // Wait for the new frame to be both committed AND painted
            await page.waitForFunction(
              () => (window as Window & { __frameReady?: boolean }).__frameReady === true,
              undefined,
              { timeout: frameTimeoutMs },
            );

            // Surface any error that the browser-side code recorded
            const browserError = (await page.evaluate(
              () => (window as Window & { __lastRenderError?: string }).__lastRenderError,
            )) as string | undefined;
            if (browserError) {
              throw new Error(`Frame ${frame}: ${browserError}`);
            }

            await page.screenshot({ path: framePath, type: 'png' });

            rendered++;
            if (rendered % fps === 0 || rendered === totalFrames) printProgress();
          }),
        );
      }

      if (logProgress) {
        printProgress();
        process.stdout.write('\n');
      }

      await Promise.all(pages.map((p) => p.close().catch(() => {})));
    });

    // ── Encode the PNG sequence into the final video ─────────────────────────
    if (logProgress) {
      console.log(`   🎬 Encoding ${totalFrames} frames → ${path.basename(outputLocation)}`);
    }
    await encodeFramesToVideo({
      framesDir,
      framePattern: 'frame_%06d.png',
      outputLocation,
      fps,
      codec,
      crf,
      x264Preset,
    });
  } finally {
    // Always clean up the temp frames directory, even on error
    await fs.remove(framesDir).catch(() => {});
  }
}
