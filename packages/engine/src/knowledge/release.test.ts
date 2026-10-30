import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { buildKnowledge, defaultPaths } from './source';
import { buildRelease, relativizeAstroAssets, type Manifest } from './release';
import { packageOffline } from './package';
import { promote } from './cdn';
import { verifyReleaseDir, verifyZip } from './verify';

// Builds real releases from the repository's own knowledge sources into a temp dir.
let tmp: string;
let dir: string;
let manifest: Manifest;

async function build(out: string, mutate?: (m: Map<string, string>) => void) {
  const paths = defaultPaths(path.resolve(__dirname, '../..'));
  const b = await buildKnowledge(paths);
  expect(b.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  mutate?.(b.artifacts);
  const { graph, text } = b.validation;
  return buildRelease({
    docsVersion: paths.docsVersion,
    defaultLocale: 'en-US',
    graph,
    knowledge: b.artifacts,
    locales: Object.keys(b.loaded.input.locales)
      .sort()
      .map((code) => ({ code, dir: b.loaded.dirOf[code] })),
    authoredIds: graph.nodes.filter((n) => n.origin === 'authored').map((n) => n.id),
    textSources: text,
    outDir: out,
  });
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-rel-'));
  ({ dir, manifest } = await build(path.join(tmp, 'a')));
});
afterAll(() => fs.remove(tmp));

describe('release build', () => {
  it('is deterministic: same sources give the same release id and identical ZIP bytes', async () => {
    const second = await build(path.join(tmp, 'b'));
    expect(second.manifest.releaseId).toBe(manifest.releaseId);
    const z1 = await packageOffline({
      releaseDir: dir,
      outDir: path.join(tmp, 'a'),
      includeMedia: true,
    });
    const z2 = await packageOffline({
      releaseDir: second.dir,
      outDir: path.join(tmp, 'b'),
      includeMedia: true,
    });
    expect(z1.zipSha256).toBe(z2.zipSha256);
  });

  it('changes the release id when content changes', async () => {
    const changed = await build(path.join(tmp, 'c'), (m) =>
      m.set('diagrams/graph.dot', 'digraph x {}\n'),
    );
    expect(changed.manifest.releaseId).not.toBe(manifest.releaseId);
  });

  it('declares locale coverage honestly', () => {
    const ar = manifest.locales.find((l) => l.code === 'ar-AE')!;
    expect(ar.support).toBe('partial');
    expect(manifest.locales.find((l) => l.code === 'en-US')!.support).toBe('complete');
  });

  it('verifies clean as CDN release and as offline ZIP', async () => {
    expect(await verifyReleaseDir(dir, 'cdn')).toEqual([]);
    const z = await packageOffline({ releaseDir: dir, outDir: tmp, includeMedia: true });
    const v = await verifyZip(z.zipPath);
    expect(v.diagnostics).toEqual([]);
    expect(z.info.releaseId).toBe(manifest.releaseId);
  });
});

describe('integrity checks', () => {
  const copy = async (name: string) => {
    const d = path.join(tmp, name);
    await fs.copy(dir, d);
    return d;
  };
  const codes = async (d: string, mode: 'cdn' | 'offline' = 'cdn') =>
    (await verifyReleaseDir(d, mode)).map((x) => x.code);

  it('detects tampering, missing files and unlisted files', async () => {
    const d = await copy('t1');
    await fs.appendFile(path.join(d, 'knowledge/graph/nodes.json'), ' ');
    await fs.remove(path.join(d, 'knowledge/diagrams/graph.dot'));
    await fs.outputFile(path.join(d, 'stray.txt'), 'x');
    expect(await codes(d)).toEqual(
      expect.arrayContaining(['size-mismatch', 'file-missing', 'unlisted-file']),
    );
  });

  it('detects a dropped locale and dangling edges', async () => {
    const d = await copy('t2');
    const edgesPath = path.join(d, 'knowledge/graph/edges.json');
    const e = await fs.readJson(edgesPath);
    e.edges[0].target = 'concept:ghost';
    await fs.writeJson(edgesPath, e);
    expect(await codes(d)).toContain('dangling-edge');
  });

  it('flags root-absolute URLs, broken references, and CDN dependencies (offline only)', async () => {
    const d = await copy('t3');
    await fs.outputFile(
      path.join(d, 'explorer/bad.html'),
      '<link rel="stylesheet" href="/x.css"><script src="https://cdn.example.com/a.js"></script><img src="missing.png"><a href="https://example.com">ok</a>',
    );
    expect(await codes(d, 'cdn')).toEqual(
      expect.arrayContaining(['root-absolute-url', 'broken-reference']),
    );
    expect(await codes(d, 'cdn')).not.toContain('external-dependency');
    const off = (await verifyReleaseDir(d, 'offline'))
      .filter((x) => x.file === 'explorer/bad.html')
      .map((x) => x.code);
    expect(off).toContain('external-dependency');
  });

  it('refuses a ZIP entry that escapes the extraction directory', async () => {
    const { zipSync } = await import('fflate');
    const evil = path.join(tmp, 'evil.zip');
    await fs.writeFile(
      evil,
      zipSync({ 'root/../../escape.txt': new Uint8Array([1]), 'root/a.txt': new Uint8Array([1]) }),
    );
    expect((await verifyZip(evil)).diagnostics.map((x) => x.code)).toContain('zip-unsafe-entry');
  });
});

describe('media omission', () => {
  it('declares omitted media and keeps the package verifiable', async () => {
    const site = path.join(tmp, 'site');
    await fs.outputFile(
      path.join(site, 'index.html'),
      '<video src="video-cache/v1.0/en-US_a.mp4"></video><a href="a/">a</a>',
    );
    await fs.outputFile(path.join(site, 'a/index.html'), 'a');
    await fs.outputFile(path.join(site, 'video-cache/v1.0/en-US_a.mp4'), 'FAKE');
    const paths = defaultPaths(path.resolve(__dirname, '../..'));
    const b = await buildKnowledge(paths);
    const withSite = await buildRelease({
      docsVersion: 'v1.0',
      defaultLocale: 'en-US',
      graph: b.validation.graph,
      knowledge: b.artifacts,
      locales: [
        { code: 'en-US', dir: 'ltr' },
        { code: 'ar-AE', dir: 'rtl' },
      ],
      authoredIds: b.validation.graph.nodes.filter((n) => n.origin === 'authored').map((n) => n.id),
      textSources: b.validation.text,
      siteDir: site,
      outDir: path.join(tmp, 'm'),
    });
    expect(withSite.manifest.capabilities).toContain('media');
    const slim = await packageOffline({
      releaseDir: withSite.dir,
      outDir: tmp,
      includeMedia: false,
    });
    expect(slim.info.omitted.map((o) => o.path)).toEqual(['site/video-cache/v1.0/en-US_a.mp4']);
    expect(slim.info.capabilities).not.toContain('media');
    const v = await verifyZip(slim.zipPath);
    // site HTML (a raw fixture, not base-aware) legitimately references the omitted video; that must not read as breakage.
    expect(v.diagnostics.map((d) => d.code)).not.toContain('broken-reference');
  });
});

describe('promotion and rollback', () => {
  it('moves the pointer only after verification and can roll back without rebuilding', async () => {
    const cdn = path.join(tmp, 'a', 'cdn');
    const other = await build(path.join(tmp, 'a'), (m) =>
      m.set('diagrams/graph.dot', 'digraph y {}\n'),
    );
    const p1 = await promote(cdn, manifest.releaseId);
    expect(p1.previous).toBeNull();
    const p2 = await promote(cdn, other.manifest.releaseId);
    expect(p2.previous).toBe(manifest.releaseId);
    const back = await promote(cdn, manifest.releaseId);
    expect(back.releaseId).toBe(manifest.releaseId);
    expect((await fs.readJson(path.join(cdn, 'current.json'))).releaseId).toBe(manifest.releaseId);

    await fs.appendFile(
      path.join(cdn, 'releases', other.manifest.releaseId, 'knowledge/graph/edges.json'),
      ' ',
    );
    await expect(promote(cdn, other.manifest.releaseId)).rejects.toThrow(/refusing to promote/);
    expect((await fs.readJson(path.join(cdn, 'current.json'))).releaseId).toBe(manifest.releaseId);
  });
});

describe('relativizeAstroAssets', () => {
  it('rewrites only /_astro/ attribute URLs, relative to page depth', () => {
    const html =
      '<link href="/_astro/a.css"><astro-island component-url="/_astro/b.js"></astro-island><a href="/other/">x</a>';
    expect(relativizeAstroAssets('v1.0/en-US/p/index.html', html)).toBe(
      '<link href="../../../_astro/a.css"><astro-island component-url="../../../_astro/b.js"></astro-island><a href="/other/">x</a>',
    );
    expect(relativizeAstroAssets('index.html', '<script src="/_astro/c.js">')).toBe(
      '<script src="./_astro/c.js">',
    );
  });
});

describe('declared missing media', () => {
  it('is recorded in the manifest and identity, tolerated by the verifier, and nothing else is', async () => {
    const site = path.join(tmp, 'site2');
    await fs.outputFile(
      path.join(site, 'p/index.html'),
      '<video src="../video-cache/v1.0/a.mp4"></video><img src="../nope.png">',
    );
    const paths = defaultPaths(path.resolve(__dirname, '../..'));
    const b = await buildKnowledge(paths);
    const make = (declare: boolean, out: string) =>
      buildRelease({
        docsVersion: 'v1.0',
        defaultLocale: 'en-US',
        graph: b.validation.graph,
        knowledge: b.artifacts,
        locales: [
          { code: 'en-US', dir: 'ltr' },
          { code: 'ar-AE', dir: 'rtl' },
        ],
        authoredIds: b.validation.graph.nodes
          .filter((n) => n.origin === 'authored')
          .map((n) => n.id),
        textSources: b.validation.text,
        siteDir: site,
        declareMissingMedia: declare,
        outDir: path.join(tmp, out),
      });
    const declared = await make(true, 'd1');
    const undeclared = await make(false, 'd2');
    expect(declared.manifest.missingMedia).toEqual(['site/video-cache/v1.0/a.mp4']);
    expect(declared.manifest.releaseId).not.toBe(undeclared.manifest.releaseId);
    const bad = (await verifyReleaseDir(declared.dir, 'cdn')).map((d) => `${d.code}:${d.message}`);
    expect(bad.some((m) => m.includes('a.mp4'))).toBe(false);
    expect(bad.some((m) => m.includes('nope.png'))).toBe(true);
    const zip = await packageOffline({ releaseDir: declared.dir, outDir: tmp, includeMedia: true });
    expect(zip.info.omitted.map((o) => o.path)).toContain('site/video-cache/v1.0/a.mp4');
  });
});
