import path from 'path';
import fs from 'fs-extra';
import dotenv from 'dotenv';
import { buildKnowledge, defaultPaths } from '../knowledge/source';
import { formatDiagnostic, hasErrors } from '../knowledge/model';
import { buildRelease } from '../knowledge/release';
import { packageOffline } from '../knowledge/package';
import { promote } from '../knowledge/cdn';
import { verifyReleaseDir, verifyZip } from '../knowledge/verify';

dotenv.config();

/**
 * One validated build, several delivery modes:
 *   dist/release/cdn/releases/<id>/   immutable release (CDN / self-hosted static)
 *   dist/release/cdn/current.json     mutable pointer, written last
 *   dist/release/offline/*.zip        offline package assembled FROM the release above
 *
 * Flags: --site <dir>  include a built Astro portal under site/
 *        --out <dir>   default dist/release
 *        --declare-missing-media  record media the site links to but was not rendered, instead of failing
 *        --no-media    also emit a smaller ZIP without optional media (omissions are declared in offline.json)
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (n: string) =>
    args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined;
  const outDir = path.resolve(opt('out') ?? 'dist/release');
  const siteDir = opt('site') ? path.resolve(opt('site')!) : undefined;
  const paths = defaultPaths();

  const build = await buildKnowledge(paths);
  for (const d of build.diagnostics) console.log(formatDiagnostic(d));
  if (hasErrors(build.diagnostics)) {
    console.error('❌ knowledge validation failed — no release produced');
    process.exit(1);
  }

  const { graph, text } = build.validation;
  const { manifest, dir } = await buildRelease({
    docsVersion: paths.docsVersion,
    defaultLocale: build.loaded.input.defaultLocale,
    graph,
    knowledge: build.artifacts,
    locales: Object.keys(build.loaded.input.locales)
      .sort()
      .map((code) => ({ code, dir: build.loaded.dirOf[code] })),
    authoredIds: graph.nodes.filter((n) => n.origin === 'authored').map((n) => n.id),
    textSources: text,
    siteDir,
    declareMissingMedia: args.includes('--declare-missing-media'),
    outDir,
  });
  console.log(
    `📦 release ${manifest.releaseId}: ${manifest.files.length} files → ${path.relative(process.cwd(), dir)}`,
  );

  const pointer = await promote(path.join(outDir, 'cdn'), manifest.releaseId);
  console.log(
    `🔗 current.json → ${pointer.releaseId}${pointer.previous ? ` (previous ${pointer.previous})` : ''}`,
  );

  const zips = [await packageOffline({ releaseDir: dir, outDir, includeMedia: true })];
  if (args.includes('--no-media'))
    zips.push(await packageOffline({ releaseDir: dir, outDir, includeMedia: false }));

  let failed = false;
  const report = (label: string, ds: Awaited<ReturnType<typeof verifyReleaseDir>>) => {
    for (const d of ds) console.log(`  ${formatDiagnostic(d)}`);
    if (hasErrors(ds)) failed = true;
    console.log(`${hasErrors(ds) ? '❌' : '✅'} verified ${label}`);
  };
  report('CDN release', await verifyReleaseDir(dir, 'cdn'));
  for (const z of zips) {
    console.log(
      `🗜  ${path.relative(process.cwd(), z.zipPath)}  sha256=${z.zipSha256.slice(0, 16)}…`,
    );
    report(path.basename(z.zipPath), (await verifyZip(z.zipPath)).diagnostics);
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('❌ release-build failed:', err);
  process.exit(1);
});
