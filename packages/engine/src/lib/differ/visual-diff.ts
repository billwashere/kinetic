import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';

/**
 * Visual differ: generates a pixel-difference MP4 for each page that exists in
 * both versions, using ffmpeg's blend=all_mode=difference filter.
 *
 * Design decisions:
 *   - Diffs the COMPOSITED outputs (public/video-cache/<version>/<locale>_<pageId>.mp4),
 *     not the raw Playwright webm recordings. The composited files are:
 *       (a) named predictably by locale and pageId
 *       (b) what users actually see — the right thing to review for regressions
 *   - This step is ALWAYS non-blocking. A failed ffmpeg invocation produces a warning,
 *     never a breaking finding. Visual review is for humans, not CI gates.
 *   - Output files are saved to generated/<toVersion>/visual-diff/ so they can be
 *     uploaded as CI artifacts without polluting the public/ directory.
 */

export interface VisualDiffOptions {
  fromVersion: string;
  toVersion: string;
  locales: string[];
  pageIds: string[];
  videoCacheDir: string; // root of public/video-cache/
  outputDir: string; // where to write diff MP4s
}

export interface VisualDiffResult {
  key: string; // "<locale>_<pageId>"
  artifactPath: string; // absolute path to the diff MP4
}

export async function generateVisualDiffs(opts: VisualDiffOptions): Promise<VisualDiffResult[]> {
  await fs.ensureDir(opts.outputDir);

  const results: VisualDiffResult[] = [];

  for (const locale of opts.locales) {
    for (const pageId of opts.pageIds) {
      const key = `${locale}_${pageId}`;
      const fromFile = path.join(opts.videoCacheDir, opts.fromVersion, `${key}.mp4`);
      const toFile = path.join(opts.videoCacheDir, opts.toVersion, `${key}.mp4`);

      if (!(await fs.pathExists(fromFile))) {
        console.warn(`  ⚠️  Visual diff skipped [${key}]: no source file at ${fromFile}`);
        continue;
      }
      if (!(await fs.pathExists(toFile))) {
        console.warn(`  ⚠️  Visual diff skipped [${key}]: no target file at ${toFile}`);
        continue;
      }

      const outputFile = path.join(opts.outputDir, `${key}_diff.mp4`);

      try {
        // blend=all_mode=difference: white pixels = identical, coloured pixels = changed.
        // pad filter on the first input aligns durations; shortest=1 stops at the shorter clip.
        await execa('ffmpeg', [
          '-i',
          fromFile,
          '-i',
          toFile,
          '-filter_complex',
          // Scale both to the same resolution before blending to handle minor size changes
          '[0:v]scale=1920:1080:flags=lanczos[a];' +
            '[1:v]scale=1920:1080:flags=lanczos[b];' +
            '[a][b]blend=all_mode=difference',
          '-c:v',
          'libx264',
          '-crf',
          '18', // high quality — these are review artifacts
          '-preset',
          'fast',
          '-shortest',
          '-y',
          outputFile,
        ]);

        console.log(`  ✅ Visual diff written: ${path.relative(process.cwd(), outputFile)}`);
        results.push({ key, artifactPath: outputFile });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  ffmpeg failed for [${key}]: ${message}`);
        // Non-blocking — visual diffs are for human review, not CI gates
      }
    }
  }

  return results;
}
