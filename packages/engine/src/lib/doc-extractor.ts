import fs from 'fs-extra';
import path from 'path';
import { resolvePath } from '../engine/workspace-config';

const VERSION = process.env.DOCS_VERSION || 'v1.0';

export interface DocStep {
  /**
   * action     — UI interaction (click, fill). Generates TTS, subtitle, anchor highlight.
   * assertion  — Expected outcome check. Generates TTS and subtitle, no anchor.
   * note       — Display-only callout. Appears in the portal step list as an info box.
   *              Localized via textKey. NO TTS generated. NO subtitle. NO anchor.
   *              Use for: "Note: This step requires admin permissions."
   * comment    — Internal author annotation. NEVER serialized — stripped by flushDocs()
   *              before the skeleton is written. The comment text is inline (not a textKey)
   *              and is never localized. Use instead of JSON comments (JSON has none)
   *              or when you want the note attached to a specific step for traceability.
   *              Example: store.recordComment('page', 'TODO: update once V2 ships')
   */
  type: 'action' | 'assertion' | 'note' | 'comment';
  stepId: string;
  /** Present for action / assertion / note. Absent for comment. */
  textKey?: string;
  /** Present for comment only — inline text that is never localized or serialized. */
  comment?: string;
  anchor?: { x: number; y: number; width: number; height: number } | null;
}

export interface DocPage {
  pageId: string;
  steps: DocStep[];
  /**
   * When true, the assemble script skips video rendering for this page entirely.
   * The Astro portal renders the page with written instructions only — no video player.
   */
  videoless?: boolean;
  /**
   * Diátaxis quadrant. Test-derived pages are procedures, so the default (omitted) is a how-to guide;
   * mark a learning-oriented walkthrough as 'tutorial'.
   */
  diataxis?: 'tutorial';
}

/** How one recorded page lines up with its screen recording. Written next to the video, not in the skeleton. */
export interface RecordingTimings {
  /** Viewport the anchors were measured in. */
  viewport: { width: number; height: number } | null;
  /** Milliseconds from page creation to each step (action: just before the click; assertion: once it held). */
  stepMs: Record<string, number>;
  /** Milliseconds from page creation to the page closing (the recording ends then). */
  endMs?: number;
  /** Length of the saved video in seconds. With endMs this tells how far the video clock lags the step clock. */
  videoSeconds?: number;
}

export class DocStore {
  private pages: Record<string, DocPage> = {};
  private started: Record<string, number> = {};
  private timings: Record<string, RecordingTimings> = {};
  private videos: Record<string, { saveAs(p: string): Promise<void> }> = {};
  private commentCounter = 0;

  page(pageId: string, options: { videoless?: boolean; diataxis?: 'how-to' | 'tutorial' } = {}): void {
    this.started[pageId] = Date.now();
    this.timings[pageId] = { viewport: null, stepMs: {} };
    this.pages[pageId] = {
      pageId,
      steps: [],
      ...(options.videoless ? { videoless: true } : {}),
      // Only non-default values are serialised so existing skeletons stay byte-identical.
      ...(options.diataxis === 'tutorial' ? { diataxis: 'tutorial' as const } : {}),
    };
  }

  /** Marks `stepId` as happening now, relative to when the page was created (for the screen recording). */
  markTime(pageId: string, stepId: string): void {
    const t0 = this.started[pageId];
    if (t0 !== undefined) this.timings[pageId].stepMs[stepId] = Date.now() - t0;
  }

  /** Remembers the page's video and viewport so flushDocs() can save them next to the skeleton. */
  attachPage(pageId: string, page: any): void {
    if (this.videos[pageId] || !this.timings[pageId]) return;
    const video = page.video?.();
    if (video) this.videos[pageId] = video;
    this.timings[pageId].viewport = page.viewportSize?.() ?? null;
    page.once?.('close', () => {
      this.timings[pageId].endMs = Date.now() - this.started[pageId];
    });
  }

  getTimings(): Record<string, RecordingTimings> {
    return this.timings;
  }

  getVideos(): Record<string, { saveAs(p: string): Promise<void> }> {
    return this.videos;
  }

  recordStep(pageId: string, stepId: string, textKey: string, anchor: DocStep['anchor']): void {
    this.pages[pageId].steps.push({ type: 'action', stepId, textKey, anchor });
  }

  recordAssertion(pageId: string, stepId: string, textKey: string): void {
    this.pages[pageId].steps.push({ type: 'assertion', stepId, textKey });
  }

  /**
   * Records a display-only note that appears in the portal as an info callout.
   * The note is localized via textKey — add its value to each locale file.
   * No TTS is generated; the note is never spoken or shown as a subtitle.
   */
  recordNote(pageId: string, stepId: string, textKey: string): void {
    this.pages[pageId].steps.push({ type: 'note', stepId, textKey });
  }

  /**
   * Records an internal author comment attached to this page's workflow.
   * Comments are stripped by flushDocs() and never appear in any output.
   * Use instead of JSON comments (JSON has no comment syntax) or when you
   * want the note positioned next to a specific step for context.
   *
   * @param text  Freeform text — not a locale key, never localized.
   */
  recordComment(pageId: string, text: string): void {
    // ephemeral ID — stripped before serialization, only needs to be unique in memory
    const stepId = `__comment_${++this.commentCounter}`;
    this.pages[pageId].steps.push({ type: 'comment', stepId, comment: text });
  }

  getPages(): DocPage[] {
    return Object.values(this.pages);
  }

  reset(): void {
    this.pages = {};
    this.commentCounter = 0;
  }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export async function docStep(
  store: DocStore,
  pageId: string,
  stepId: string,
  page: any,
  selector: string,
  textKey: string,
): Promise<void> {
  const locator = page.locator(selector);
  await locator.waitFor({
    state: 'visible',
    timeout: Number(process.env.KINETIC_EXPECT_TIMEOUT) || 5000,
  });
  const box = await locator.boundingBox();
  store.recordStep(pageId, stepId, textKey, box);
  store.attachPage(pageId, page);
  store.markTime(pageId, stepId);
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await locator.click();
}

export async function docAssert(
  store: DocStore,
  pageId: string,
  assertId: string,
  assertionFn: () => Promise<void>,
  textKey: string,
): Promise<void> {
  store.recordAssertion(pageId, assertId, textKey);
  await assertionFn();
  store.markTime(pageId, assertId);
}

/**
 * Adds a display-only note to the page. Synchronous — no browser interaction.
 * Parallel to docStep/docAssert for readable spec files.
 */
export function docNote(store: DocStore, pageId: string, noteId: string, textKey: string): void {
  store.recordNote(pageId, noteId, textKey);
}

// ─── flushDocs ────────────────────────────────────────────────────────────────

export async function flushDocs(store: DocStore): Promise<void> {
  const outPath = path.join(
    resolvePath('generated', path.join(process.cwd(), 'generated')),
    VERSION,
    'extracted-skeleton.json',
  );
  await fs.ensureDir(path.dirname(outPath));

  let existing: DocPage[] = [];
  if (await fs.pathExists(outPath)) {
    existing = await fs.readJson(outPath);
  }

  // Strip comments before serialization — they are internal author annotations
  // and must never appear in any pipeline output.
  const incoming = store.getPages().map((page) => ({
    ...page,
    steps: page.steps.filter((s) => s.type !== 'comment'),
  }));

  const incomingIds = new Set(incoming.map((p) => p.pageId));
  const merged = [...existing.filter((p) => !incomingIds.has(p.pageId)), ...incoming];

  await fs.writeJson(outPath, merged, { spaces: 2 });

  // Screen recordings and their step timings go to the (gitignored) visual cache, where assemble.ts
  // finds them as <pageId>.webm + <pageId>.json. The skeleton stays free of timings so it does not churn.
  const cacheDir = path.join(
    resolvePath('public', path.join(process.cwd(), 'public')),
    'visual-cache',
    VERSION,
  );
  await fs.ensureDir(cacheDir);
  for (const [pageId, video] of Object.entries(store.getVideos())) {
    const webm = path.join(cacheDir, `${pageId}.webm`);
    await video.saveAs(webm);
    store.getTimings()[pageId].videoSeconds = await probeSeconds(webm);
    await fs.writeJson(path.join(cacheDir, `${pageId}.json`), store.getTimings()[pageId], {
      spaces: 2,
    });
  }
}

async function probeSeconds(file: string): Promise<number | undefined> {
  try {
    const { execa } = await import('execa');
    const { stdout } = await execa('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const n = parseFloat(stdout.trim());
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}
