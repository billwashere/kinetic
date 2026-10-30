import fs from 'fs-extra';
import path from 'path';
import { zipSync } from 'fflate';
import { sha256, type Manifest } from './release';

export const OFFLINE_PACKAGE_VERSION = 1;

/** Files the offline packager adds on top of the release. They are covered by SHA256SUMS, not the manifest. */
export const PACKAGE_FILES = ['offline.json', 'serve.mjs', 'README.md', 'SHA256SUMS'] as const;

export interface OfflineInfo {
  packageVersion: number;
  releaseId: string;
  contentHash: string;
  docsVersion: string;
  locales: Manifest['locales'];
  /** Capabilities that work with no network, after media omission is applied. */
  capabilities: string[];
  /** Release files deliberately left out of this package. Anything listed here is intentionally absent. */
  omitted: { path: string; reason: string }[];
  /** Features that need a network service even though they appear in the UI. */
  onlineOnly: string[];
  launch: { command: string; defaultUrl: string };
}

export interface PackageOptions {
  releaseDir: string;
  outDir: string;
  includeMedia: boolean;
  onlineOnly?: string[];
}

// Fixed local-time timestamp: fflate writes DOS time from local getters, so constructing it in local time
// gives the same bytes in every timezone. Part of what makes the ZIP reproducible.
const FIXED_MTIME = new Date(2000, 0, 1, 0, 0, 0);

const ALREADY_COMPRESSED = /\.(mp4|webm|mp3|png|jpe?g|woff2?|zip|parquet)$/i;

function readme(info: OfflineInfo, folder: string): string {
  const locales = info.locales
    .map(
      (l) =>
        `- ${l.code}: ${l.support} (${l.translatedNodes}/${l.totalAuthoredNodes} knowledge nodes translated; the rest fall back to the default locale)`,
    )
    .join('\n');
  const omitted = info.omitted.length
    ? info.omitted.map((o) => `- ${o.path} — ${o.reason}`).join('\n')
    : '- nothing; this package contains the complete release';
  return `# Kinetic Docs — offline release ${info.releaseId}

Docs version: ${info.docsVersion}
Content hash: ${info.contentHash}

## Launch

\`file://\` is not supported: browsers restrict module loading and fetch there. Serve the folder with any
static server. A zero-dependency one is included (Node.js 18+):

    cd ${folder}
    node serve.mjs            # http://127.0.0.1:8080/
    node serve.mjs --base /docs/   # rehearse a sub-path deployment

You can instead copy this folder to any static web host, under any path. No database, API or search service is needed.

## What works offline

${info.capabilities.map((c) => `- ${c}`).join('\n')}

## Locales

${locales}

## Deliberately omitted

${omitted}

## Online-only

${info.onlineOnly.length ? info.onlineOnly.map((o) => `- ${o}`).join('\n') : '- nothing in this package requires a network service'}

External hyperlinks (for example to a product website) still need a network connection to follow.

## Integrity

\`SHA256SUMS\` lists every file in this package; \`manifest.json\` is the release manifest. Verify with
\`sha256sum -c SHA256SUMS\` (or \`shasum -a 256 -c SHA256SUMS\`).
`;
}

export async function packageOffline(
  opts: PackageOptions,
): Promise<{ zipPath: string; zipSha256: string; folder: string; info: OfflineInfo }> {
  const manifest: Manifest = await fs.readJson(path.join(opts.releaseDir, 'manifest.json'));
  const kept = manifest.files.filter((f) => opts.includeMedia || f.role !== 'media');
  const omitted = [
    ...manifest.files
      .filter((f) => !kept.includes(f))
      .map((f) => ({ path: f.path, reason: 'optional media excluded from this package' })),
    ...(manifest.missingMedia ?? []).map((p) => ({
      path: p,
      reason: 'media was not rendered for this release',
    })),
  ];

  const folder = `kinetic-docs-${manifest.releaseId}${opts.includeMedia ? '' : '-nomedia'}`;
  const info: OfflineInfo = {
    packageVersion: OFFLINE_PACKAGE_VERSION,
    releaseId: manifest.releaseId,
    contentHash: manifest.contentHash,
    docsVersion: manifest.docsVersion,
    locales: manifest.locales,
    capabilities: manifest.capabilities.filter((c) => opts.includeMedia || c !== 'media'),
    omitted,
    onlineOnly: opts.onlineOnly ?? [],
    launch: { command: 'node serve.mjs', defaultUrl: 'http://127.0.0.1:8080/' },
  };

  const contents = new Map<string, Buffer>();
  for (const f of kept) contents.set(f.path, await fs.readFile(path.join(opts.releaseDir, f.path)));
  contents.set('manifest.json', await fs.readFile(path.join(opts.releaseDir, 'manifest.json')));
  contents.set('offline.json', Buffer.from(JSON.stringify(info, null, 2) + '\n'));
  contents.set('serve.mjs', await fs.readFile(path.join(__dirname, 'offline-serve.mjs')));
  contents.set('README.md', Buffer.from(readme(info, folder)));
  const sums = [...contents.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([p, c]) => `${sha256(c)}  ${p}\n`)
    .join('');
  contents.set('SHA256SUMS', Buffer.from(sums));

  const zipInput: Record<string, [Uint8Array, { level: 0 | 6; mtime: Date }]> = {};
  for (const p of [...contents.keys()].sort((a, b) => (a < b ? -1 : 1))) {
    zipInput[`${folder}/${p}`] = [
      contents.get(p)!,
      { level: ALREADY_COMPRESSED.test(p) ? 0 : 6, mtime: FIXED_MTIME },
    ];
  }
  const zipBytes = Buffer.from(zipSync(zipInput));
  const zipPath = path.join(opts.outDir, 'offline', `${folder}.zip`);
  await fs.outputFile(zipPath, zipBytes);
  return { zipPath, zipSha256: sha256(zipBytes), folder, info };
}
