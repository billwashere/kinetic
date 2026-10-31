import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import { bundle } from '@kinetic/renderer-compat/bundler';
import { renderMedia, selectComposition } from '@kinetic/renderer-compat/renderer';
import { loadRenderConfig, FPS, type RenderConfig } from '../engine/render-config';
import { loadLayerConfig, type LayerConfig } from '../engine/layer-config';
import { type AudioManifest } from '../lib/manifest-reader';
import { buildPageTimingSchedule, type KineticVideoProps } from '../lib/timing-schedule';
import { secondsToFrames } from '../lib/manifest-reader';
import { generateWebVTT } from '../lib/vtt';
import { generateMarkdownPage } from '../lib/text-exporter';
import { validateLocale } from '../engine/locale-schema';
import {
  stitchAndMix,
  computeIntroHash,
  computeOutroHash,
  isCacheValid,
  writeHashFile,
} from '../lib/stitch-and-mix';
import type { IntroProps } from '../components/IntroSlide';
import { resolvePath } from '../engine/workspace-config';

const LOCALES_DIR = resolvePath('locales', path.join(process.cwd(), 'content/locales'));
const PUBLIC_DIR = resolvePath('public', path.join(process.cwd(), 'public'));
const GENERATED_DIR = resolvePath('generated', path.join(process.cwd(), 'generated'));
import { mixNarration, type NarrationCue } from '../lib/narration';
import { planScreenSegments, composeScreenLayer, videoClockOffset } from '../lib/screen-layer';
import type { RecordingTimings } from '../lib/doc-extractor';
import { WIDTH, HEIGHT } from '../engine/render-config';
import type { OutroProps } from '../components/OutroSlide';

dotenv.config();

const VERSION = process.env.DOCS_VERSION || 'v1.0';
// --no-screen renders the overlay-only video (no Playwright recording underneath).
const noScreen = process.argv.includes('--no-screen');
// --no-narration leaves the video silent.
const noNarration = process.argv.includes('--no-narration');
const ENTRY_POINT = path.join(process.cwd(), 'src/index.tsx');
const BUNDLE_CACHE_PATH = path.join(process.cwd(), '.rc-bundle-cache');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAvailableLocales(): Promise<string[]> {
  const files = await fs.readdir(LOCALES_DIR);
  return files.filter((f) => f.endsWith('.json')).map((f) => path.basename(f, '.json'));
}

async function getOrCreateBundle(): Promise<string> {
  const sideCar = path.join(BUNDLE_CACHE_PATH, 'bundle.json');
  if (await fs.pathExists(sideCar)) {
    const cached = await fs.readJson(sideCar);
    const mtime = (await fs.stat(ENTRY_POINT)).mtimeMs;
    if (cached.entryMtime === mtime && (await fs.pathExists(cached.bundleUrl))) {
      console.log('⚡ Reusing cached renderer-compat bundle.');
      return cached.bundleUrl;
    }
  }
  console.log('📦 Bundling entry point (esbuild)...');
  const bundleUrl = await bundle({
    entryPoint: ENTRY_POINT,
    outDir: path.join(BUNDLE_CACHE_PATH, 'bundle'),
  });
  const mtime = (await fs.stat(ENTRY_POINT)).mtimeMs;
  await fs.ensureDir(BUNDLE_CACHE_PATH);
  await fs.writeJson(sideCar, { bundleUrl, entryMtime: mtime });
  return bundleUrl;
}

async function loadManifest(locale: string): Promise<AudioManifest | null> {
  const p = path.join(PUBLIC_DIR, `audio-manifest-${VERSION}-${locale}.json`);
  if (!(await fs.pathExists(p))) {
    console.warn(
      `⚠️  No audio manifest at ${p} — run "pnpm generate:audio" first. Durations fall back to 5s.`,
    );
    return null;
  }
  return fs.readJson(p);
}

function renderOptions(renderConfig: RenderConfig) {
  return {
    codec: renderConfig.codec,
    ...(renderConfig.codec === 'h264' || renderConfig.codec === 'h265'
      ? { x264Preset: renderConfig.x264Preset, crf: renderConfig.crf }
      : { crf: renderConfig.crf }),
    concurrency: renderConfig.concurrency,
  } as const;
}

// ─── Intro / outro rendering with caching ─────────────────────────────────────

async function ensureIntroRendered(
  bundleLocation: string,
  locale: string,
  pageId: string,
  title: string,
  breadcrumbs: string[],
  textDirection: 'ltr' | 'rtl',
  layerConfig: LayerConfig,
  renderConfig: RenderConfig,
  intermediateDir: string,
): Promise<string> {
  const introFile = path.join(intermediateDir, `${locale}_${pageId}__intro.mp4`);
  const hash = computeIntroHash(locale, pageId, title, breadcrumbs, layerConfig);

  if (await isCacheValid(introFile, hash)) {
    console.log(`  ⚡ Cached intro  [${locale}/${pageId}]`);
    return introFile;
  }

  const durationInFrames = secondsToFrames(layerConfig.intro!.durationSeconds, FPS);
  const inputProps: IntroProps = { title, breadcrumbs, textDirection, layerConfig };

  console.log(
    `  🎬 Rendering intro  [${locale}/${pageId}] — ${layerConfig.intro!.durationSeconds}s`,
  );

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'KineticIntro',
    inputProps,
  });
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    outputLocation: introFile,
    inputProps,
    durationInFrames,
    ...renderOptions(renderConfig),
  });

  await writeHashFile(introFile, hash);
  return introFile;
}

async function ensureOutroRendered(
  bundleLocation: string,
  locale: string,
  textDirection: 'ltr' | 'rtl',
  layerConfig: LayerConfig,
  renderConfig: RenderConfig,
  intermediateDir: string,
): Promise<string> {
  const outroFile = path.join(intermediateDir, `${locale}__outro.mp4`);
  const hash = computeOutroHash(locale, layerConfig);

  if (await isCacheValid(outroFile, hash)) {
    console.log(`  ⚡ Cached outro  [${locale}]`);
    return outroFile;
  }

  const durationInFrames = secondsToFrames(layerConfig.outro!.durationSeconds, FPS);
  const inputProps: OutroProps = { textDirection, layerConfig };

  console.log(`  🎬 Rendering outro [${locale}] — ${layerConfig.outro!.durationSeconds}s`);

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'KineticOutro',
    inputProps,
  });
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    outputLocation: outroFile,
    inputProps,
    durationInFrames,
    ...renderOptions(renderConfig),
  });

  await writeHashFile(outroFile, hash);
  return outroFile;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [renderConfig, layerConfig] = await Promise.all([
    Promise.resolve(loadRenderConfig()),
    loadLayerConfig(),
  ]);

  const hasIntroOutro = Boolean(layerConfig.intro);

  console.log('🎬 Render configuration:');
  console.log(
    `   codec: ${renderConfig.codec}  crf: ${renderConfig.crf}  preset: ${renderConfig.x264Preset}`,
  );
  console.log(`   concurrency: ${renderConfig.concurrency}  fps: ${FPS}  resolution: 1920×1080`);
  console.log(
    `   lead-in: ${renderConfig.leadInSeconds}s  lead-out: ${renderConfig.leadOutSeconds}s`,
  );
  console.log('\n🎨 Layer configuration:');
  console.log(
    `   intro:     ${layerConfig.intro ? `${layerConfig.intro.durationSeconds}s` : 'disabled'}`,
  );
  console.log(
    `   outro:     ${layerConfig.outro ? `${layerConfig.outro.durationSeconds}s` : 'disabled'}`,
  );
  console.log(
    `   music:     ${layerConfig.music ? `${layerConfig.music.src} @ vol ${layerConfig.music.volume}${hasIntroOutro ? ' (post-stitch)' : ''}` : 'disabled'}`,
  );
  console.log(
    `   watermark: ${layerConfig.watermark ? `${layerConfig.watermark.src} (${layerConfig.watermark.position})` : 'disabled'}`,
  );

  const bundleLocation = await getOrCreateBundle();
  const skeleton = await fs.readJson(path.join(GENERATED_DIR, VERSION, 'extracted-skeleton.json'));
  const cacheDir = path.join(PUBLIC_DIR, `video-cache/${VERSION}`);
  const intermediateDir = path.join(cacheDir, '.intermediate');
  await fs.ensureDir(cacheDir);
  await fs.ensureDir(intermediateDir);

  const locales = await getAvailableLocales();
  console.log(`\n🌍 Rendering locales: ${locales.join(', ')}`);

  const textDir = path.join(GENERATED_DIR, VERSION, 'text');
  await fs.ensureDir(textDir);

  for (const locale of locales) {
    const localePath = path.join(LOCALES_DIR, `${locale}.json`);
    if (!(await fs.pathExists(localePath))) {
      console.warn(`⚠️  Locale file not found: ${localePath}, skipping.`);
      continue;
    }

    const localeData = validateLocale(await fs.readJson(localePath), localePath);
    const textDirection = localeData.dir;
    const manifest = await loadManifest(locale);

    // Render the outro once per locale (shared across all pages)
    const outroFile =
      hasIntroOutro && layerConfig.outro
        ? await ensureOutroRendered(
            bundleLocation,
            locale,
            textDirection,
            layerConfig,
            renderConfig,
            intermediateDir,
          )
        : null;

    for (const page of skeleton) {
      // Videoless pages are text-only — they have no video to render.
      // The Astro portal will show their written steps without a video player.
      if (page.videoless) {
        console.log(`\n📄 [${locale}] ${page.pageId} — videoless, skipping render`);
        await fs.writeFile(
          path.join(textDir, `${locale}_${page.pageId}.md`),
          generateMarkdownPage(page, localeData, manifest, locale),
          'utf8',
        );
        continue;
      }

      const finalOutputFile = path.join(cacheDir, `${locale}_${page.pageId}.mp4`);
      const pageData = localeData.pages?.[page.pageId];
      const title: string = pageData?.title ?? page.pageId;
      const breadcrumbs: string[] = pageData?.breadcrumbs ?? [];

      const schedule = buildPageTimingSchedule(
        manifest ?? {},
        page.steps,
        locale,
        page.pageId,
        FPS,
        renderConfig.leadInSeconds,
        renderConfig.leadOutSeconds,
      );

      const durationSecs = (schedule.totalFrames / FPS).toFixed(1);
      console.log(`\n📄 [${locale}] ${page.pageId} — ${durationSecs}s content`);

      // When intro/outro is active, write content to an intermediate path and
      // stitch afterward. Otherwise write directly to the final path.
      const contentFile = hasIntroOutro
        ? path.join(intermediateDir, `${locale}_${page.pageId}__content.mp4`)
        : finalOutputFile;

      // Screen recording from the spec run (visual-cache/<version>/<pageId>.webm + .json), if there is one.
      const recordingBase = path.join(PUBLIC_DIR, 'visual-cache', VERSION, page.pageId);
      let recording: RecordingTimings | null = null;
      if (!noScreen && (await fs.pathExists(`${recordingBase}.webm`)) && (await fs.pathExists(`${recordingBase}.json`))) {
        recording = await fs.readJson(`${recordingBase}.json`);
      } else if (!noScreen) {
        console.warn(`   ⚠️  No screen recording for ${page.pageId} — run "pnpm test:docs"; rendering without it.`);
      }
      const scale = recording?.viewport ? WIDTH / recording.viewport.width : 1;
      const stepTimings = schedule.stepTimings.map((t) =>
        t.anchor && scale !== 1
          ? { ...t, anchor: { x: t.anchor.x * scale, y: t.anchor.y * scale, width: t.anchor.width * scale, height: t.anchor.height * scale } }
          : t,
      );

      const contentProps: KineticVideoProps = {
        locale,
        pageId: page.pageId,
        version: VERSION,
        textDirection,
        subtitles: schedule.subtitles,
        stepTimings,
        leadInFrames: schedule.leadInFrames,
        leadOutFrames: schedule.leadOutFrames,
        layerConfig,
        screenLayer: !!recording,
      };

      console.log(
        `   🎥 Content: ${schedule.subtitles.length} subtitle cues, ${schedule.stepTimings.filter((s) => s.anchor).length} anchors${recording ? ', screen recording' : ''}`,
      );
      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: 'KineticDocs',
        inputProps: contentProps,
      });
      const overlayFile = path.join(intermediateDir, `${locale}_${page.pageId}__overlay.webm`);
      await renderMedia({
        composition,
        serveUrl: bundleLocation,
        outputLocation: recording ? overlayFile : contentFile,
        inputProps: contentProps,
        durationInFrames: schedule.totalFrames,
        ...renderOptions(renderConfig),
        ...(recording ? { transparent: true } : {}),
      });
      if (recording) {
        const actionIds = new Set<string>(page.steps.filter((st) => st.type === 'action').map((st) => st.stepId));
        console.log(`   🖥️  Compositing screen recording`);
        await composeScreenLayer({
          source: `${recordingBase}.webm`,
          overlay: overlayFile,
          outputFile: contentFile,
          segments: planScreenSegments(schedule, recording.stepMs, actionIds, FPS, videoClockOffset(recording), recording.videoSeconds),
          fps: FPS,
          width: WIDTH,
          height: HEIGHT,
          crop: recording.viewport,
          crf: renderConfig.crf,
          x264Preset: renderConfig.x264Preset,
        });
        if (!process.env.KINETIC_KEEP_INTERMEDIATE) await fs.remove(overlayFile);
      }

      let introOffsetFrames = 0;
      if (hasIntroOutro) {
        const introFile = layerConfig.intro
          ? await ensureIntroRendered(
              bundleLocation,
              locale,
              page.pageId,
              title,
              breadcrumbs,
              textDirection,
              layerConfig,
              renderConfig,
              intermediateDir,
            )
          : null;

        const introFrames = introFile
          ? secondsToFrames(layerConfig.intro!.durationSeconds, FPS)
          : 0;
        const outroFrames = outroFile
          ? secondsToFrames(layerConfig.outro!.durationSeconds, FPS)
          : 0;
        introOffsetFrames = introFrames;
        const totalFrames = introFrames + schedule.totalFrames + outroFrames;
        const segments = [introFile, contentFile, outroFile].filter(Boolean) as string[];

        console.log(
          `   🔗 Stitching ${segments.length} segments → ${(totalFrames / FPS).toFixed(1)}s total`,
        );
        if (layerConfig.music) console.log(`   🎵 Adding music track post-stitch`);

        await stitchAndMix({
          segments,
          outputFile: finalOutputFile,
          music: layerConfig.music ?? null,
          totalFrames,
          fps: FPS,
          publicDir: PUBLIC_DIR,
        });

        // Write VTT with introOffset so timestamps align with the full stitched video
        await fs.writeFile(
          finalOutputFile.replace(/\.mp4$/, '.vtt'),
          generateWebVTT(schedule.subtitles, FPS, introFrames),
          'utf8',
        );

        await fs.remove(contentFile);
      } else {
        // No intro — content was written directly to finalOutputFile
        await fs.writeFile(
          finalOutputFile.replace(/\.mp4$/, '.vtt'),
          generateWebVTT(schedule.subtitles, FPS),
          'utf8',
        );
      }

      if (!noNarration && manifest) {
        const cues: NarrationCue[] = schedule.subtitles.flatMap((cue) => {
          const entry = manifest[`${locale}_${page.pageId}_${cue.stepId}`];
          return entry?.file
            ? [{ file: path.join(PUBLIC_DIR, entry.file), startSeconds: (cue.startFrame + introOffsetFrames) / FPS }]
            : [];
        });
        const videoFrames = introOffsetFrames + schedule.totalFrames + (hasIntroOutro && layerConfig.outro ? secondsToFrames(layerConfig.outro.durationSeconds, FPS) : 0);
        if (cues.length > 0) {
          console.log(`   🎙️  Mixing ${cues.length} narration clips`);
          await mixNarration(finalOutputFile, cues, videoFrames / FPS);
        }
      }

      await fs.writeFile(
        path.join(textDir, `${locale}_${page.pageId}.md`),
        generateMarkdownPage(page, localeData, manifest, locale),
        'utf8',
      );

      console.log(`   ✅ ${path.relative(process.cwd(), finalOutputFile)}`);
    }
  }

  console.log('\n✅ Assemble complete.');
}

main().catch((err) => {
  console.error('❌ assemble failed:', err);
  process.exit(1);
});
