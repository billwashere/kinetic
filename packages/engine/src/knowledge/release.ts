import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';
import { SCHEMA_VERSION } from './registry';
import type { ArtifactMap } from './compile';
import type { Graph } from './model';

export const MANIFEST_VERSION = 1;

export type FileRole = 'knowledge' | 'explorer' | 'site' | 'media' | 'meta';

export interface ManifestFile {
  path: string;
  sha256: string;
  size: number;
  role: FileRole;
}

export interface LocaleCoverage {
  code: string;
  dir: 'ltr' | 'rtl';
  /** Authored nodes that have their own text in this locale (not a fallback). */
  translatedNodes: number;
  totalAuthoredNodes: number;
  /** "complete" only when every authored node is translated. */
  support: 'complete' | 'partial';
}

export interface Manifest {
  manifestVersion: number;
  schemaVersion: number;
  releaseId: string;
  docsVersion: string;
  /** sha256 over the sorted (path, sha256) pairs of `files` — identical content gives an identical id. */
  contentHash: string;
  defaultLocale: string;
  locales: LocaleCoverage[];
  graph: {
    nodes: number;
    authoredNodes: number;
    edges: number;
    edgesByVerification: Record<string, number>;
  };
  /** What a consumer can rely on in this release (the offline package may narrow it, see offline.json). */
  capabilities: string[];
  files: ManifestFile[];
}

export const sha256 = (data: Buffer | string) =>
  crypto.createHash('sha256').update(data).digest('hex');

export function roleOf(p: string): FileRole {
  if (p.startsWith('knowledge/')) return 'knowledge';
  if (p.startsWith('explorer/')) return 'explorer';
  if (/^site\/(video-cache|audio-objects)\//.test(p)) return 'media';
  if (p.startsWith('site/')) return 'site';
  return 'meta';
}

export function computeContentHash(files: { path: string; sha256: string }[]): string {
  return sha256(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map((f) => `${f.path}\t${f.sha256}\n`)
      .join(''),
  );
}

/** Browser modules the explorer needs, compiled from the same TypeScript the build uses. */
function transpileBrowserModule(srcPath: string): string {
  const src = fs.readFileSync(srcPath, 'utf8');
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

export interface BuildReleaseInput {
  docsVersion: string;
  defaultLocale: string;
  graph: Graph;
  knowledge: ArtifactMap;
  locales: { code: string; dir: 'ltr' | 'rtl' }[];
  authoredIds: string[];
  /** locale -> node id -> titleFrom, used for coverage. */
  textSources: Record<string, Record<string, { titleFrom: string }>>;
  /** Optional Astro (or other static) build output, copied under `site/`. */
  siteDir?: string;
  outDir: string;
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

export function listFiles(dir: string): string[] {
  return walk(dir);
}

export async function buildRelease(
  input: BuildReleaseInput,
): Promise<{ manifest: Manifest; dir: string }> {
  const here = path.dirname(__filename);
  const staged = new Map<string, Buffer | string>();

  for (const [p, content] of input.knowledge) staged.set(`knowledge/${p}`, content);

  // Reference explorer: dependency-free, relative URLs only, consumes only the published files.
  for (const f of ['index.html', 'explorer.js', 'explorer.css']) {
    staged.set(`explorer/${f}`, fs.readFileSync(path.join(here, 'explorer', f)));
  }
  staged.set('explorer/lib/search.js', transpileBrowserModule(path.join(here, 'search.ts')));
  staged.set('explorer/lib/query.js', transpileBrowserModule(path.join(here, 'query.ts')));
  staged.set('index.html', fs.readFileSync(path.join(here, 'explorer', 'landing.html')));

  if (input.siteDir) {
    for (const rel of walk(input.siteDir))
      staged.set(`site/${rel}`, fs.readFileSync(path.join(input.siteDir, rel)));
  }

  const files: ManifestFile[] = [...staged.entries()]
    .map(([p, c]) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      return { path: p, sha256: sha256(buf), size: buf.length, role: roleOf(p) };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  const contentHash = computeContentHash(files);
  const releaseId = `${input.docsVersion}-${contentHash.slice(0, 12)}`;

  const authored = new Set(input.authoredIds);
  const byVer: Record<string, number> = { verified: 0, asserted: 0, unevidenced: 0 };
  for (const e of input.graph.edges) byVer[e.verification]++;

  const locales: LocaleCoverage[] = input.locales
    .map(({ code, dir }) => {
      const translated = input.authoredIds.filter(
        (id) => input.textSources[code]?.[id]?.titleFrom === code,
      ).length;
      return {
        code,
        dir,
        translatedNodes: translated,
        totalAuthoredNodes: authored.size,
        support: translated === authored.size ? ('complete' as const) : ('partial' as const),
      };
    })
    .sort((a, b) => (a.code < b.code ? -1 : 1));

  const capabilities = ['knowledge-graph', 'search', 'explorer'];
  if (input.siteDir) capabilities.push('docs-site');
  if (files.some((f) => f.role === 'media')) capabilities.push('media');

  const manifest: Manifest = {
    manifestVersion: MANIFEST_VERSION,
    schemaVersion: SCHEMA_VERSION,
    releaseId,
    docsVersion: input.docsVersion,
    contentHash,
    defaultLocale: input.defaultLocale,
    locales,
    graph: {
      nodes: input.graph.nodes.length,
      authoredNodes: authored.size,
      edges: input.graph.edges.length,
      edgesByVerification: byVer,
    },
    capabilities,
    files,
  };

  const dir = path.join(input.outDir, 'cdn', 'releases', releaseId);
  await fs.remove(dir);
  for (const [p, c] of staged) {
    await fs.outputFile(path.join(dir, p), c);
  }
  await fs.outputFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, dir };
}
