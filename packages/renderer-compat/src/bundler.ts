/**
 * bundler.ts  —  @kinetic/renderer-compat/bundler
 *
 * MIT-licensed drop-in for `@remotion/bundler`.
 *
 * Compiles the user's composition entry point (e.g. src/index.tsx) into a
 * single browser bundle with esbuild, and copies the runner HTML alongside it.
 * Returns the output directory — caller passes that to selectComposition() and
 * renderMedia() as `serveUrl`.
 *
 * `remotion` alias
 * ────────────────
 * Every `import { ... } from 'remotion'` in the entry point graph is rewritten
 * to point at our react-api shim. The user's component code is unmodified.
 *
 * Why esbuild over webpack
 * ────────────────────────
 * 10–100× faster, no commercial licence considerations, single-file IIFE
 * output that's trivial to serve. Sourcemaps are off by default (the bundler
 * is invoked at video-render time; debugging happens in dev mode against the
 * source). Pass `sourcemap: true` to enable them.
 */

import path from 'path';
import fs from 'fs-extra';
import { build, type BuildOptions } from 'esbuild';

export interface BundleOptions {
  /** Absolute path to the composition entry point (e.g. packages/engine/src/index.tsx). */
  entryPoint: string;
  /** Directory to write bundle.js + index.html into. Created if missing. */
  outDir: string;
  /**
   * Override the file used to resolve `import 'remotion'`.
   * Defaults to the react-api shipped in this package.
   */
  reactApiPath?: string;
  /** Enable browser sourcemaps. Default: false. */
  sourcemap?: boolean;
  /** Pass-through esbuild options for advanced customisation. */
  esbuildOptions?: Partial<BuildOptions>;
}

/**
 * Bundles the entry point and copies the HTML runner.
 * @returns The `outDir` — pass this verbatim to selectComposition / renderMedia.
 */
export async function bundle({
  entryPoint,
  outDir,
  reactApiPath,
  sourcemap = false,
  esbuildOptions = {},
}: BundleOptions): Promise<string> {
  if (!(await fs.pathExists(entryPoint))) {
    throw new Error(`bundle: entryPoint does not exist: ${entryPoint}`);
  }
  await fs.ensureDir(outDir);

  // Resolve the `remotion` alias target. Both the source layout (src/) and
  // the build output (dist/) keep react-api and runner.html as siblings of
  // bundler.js, so __dirname-relative resolution works in either context.
  const shimPath = reactApiPath ?? path.join(__dirname, 'react-api.js');
  const shimSourcePath = path.join(__dirname, 'react-api.tsx'); // ts-node case
  const aliasTarget = (await fs.pathExists(shimPath)) ? shimPath : shimSourcePath;

  if (!(await fs.pathExists(aliasTarget))) {
    throw new Error(
      `bundle: could not locate react-api shim. Tried:\n  ${shimPath}\n  ${shimSourcePath}\n` +
        `  Override with bundle({ reactApiPath: '<path>' })`,
    );
  }

  // ── Compile ────────────────────────────────────────────────────────────────
  try {
    await build({
      entryPoints: [entryPoint],
      outfile: path.join(outDir, 'bundle.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      jsxImportSource: 'react',
      target: 'es2020',
      alias: { remotion: aliasTarget },
      define: { 'process.env.NODE_ENV': '"production"' },
      loader: { '.tsx': 'tsx', '.ts': 'ts' },
      sourcemap,
      logLevel: 'warning',
      ...esbuildOptions,
    });
  } catch (err) {
    // esbuild already prints rich diagnostics to stderr — re-throw with context.
    throw new Error(
      `bundle: esbuild failed for ${entryPoint}\n  ${(err as Error).message}`,
    );
  }

  // ── Copy runner HTML ──────────────────────────────────────────────────────
  const runnerCandidates = [
    path.join(__dirname, 'runner.html'),                       // dist/ or src/
    path.join(__dirname, '..', 'src', 'runner.html'),          // running compiled bundler.js from dist/
  ];
  const runnerSrc = runnerCandidates.find((p) => fs.pathExistsSync(p));
  if (!runnerSrc) {
    throw new Error(
      `bundle: runner.html not found. Searched:\n  ${runnerCandidates.join('\n  ')}`,
    );
  }
  await fs.copy(runnerSrc, path.join(outDir, 'index.html'), { overwrite: true });

  console.log(`📦 Bundle written → ${outDir}`);
  return outDir;
}
