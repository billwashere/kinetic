import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { unzipSync } from 'fflate';
import { computeContentHash, listFiles, sha256, type Manifest } from './release';
import { PACKAGE_FILES, type OfflineInfo } from './package';
import type { Diagnostic } from './model';

export type VerifyMode = 'cdn' | 'offline';

const err = (code: string, message: string, file?: string): Diagnostic => ({
  severity: 'error',
  code,
  message,
  file,
});

const TEXT = /\.(html|css|js|mjs)$/i;
// Namespace identifiers, not network requests.
const IGNORED_HOSTS = /^https?:\/\/(www\.w3\.org|schema\.org)\//;

/** References that load a resource (not <a href>, which is navigation and may legitimately be external). */
function loadReferences(file: string, text: string): string[] {
  const refs: string[] = [];
  if (file.endsWith('.html')) {
    for (const m of text.matchAll(
      /<(?:script|img|source|video|audio|iframe|embed|track)\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi,
    ))
      refs.push(m[1]);
    for (const m of text.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) refs.push(m[1]);
  }
  // url()/@import only mean something in CSS; in HTML that is <style> blocks, not inline JS like `new URL(x)`.
  const css = file.endsWith('.css')
    ? text
    : file.endsWith('.html')
      ? [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
      : '';
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) refs.push(m[1]);
  for (const m of css.matchAll(/@import\s+["']([^"']+)["']/gi)) refs.push(m[1]);
  if (/\.m?js$/.test(file) || file.endsWith('.html')) {
    for (const m of text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bfetch\s*\(\s*|\bimportScripts\s*\(\s*|new URL\s*\(\s*)["'`](https?:\/\/[^"'`]+)["'`]/g,
    ))
      refs.push(m[1]);
  }
  return refs;
}

function anchorTargets(text: string): string[] {
  return [...text.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
}

/** Resolves a relative reference from `fromFile`. Returns null when it is not a local file reference. */
function resolveLocal(fromFile: string, ref: string): string | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) return null;
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), clean));
}

export async function verifyReleaseDir(dir: string, mode: VerifyMode): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  const manifestPath = path.join(dir, 'manifest.json');
  if (!(await fs.pathExists(manifestPath)))
    return [err('manifest-missing', 'manifest.json not found', dir)];

  let manifest: Manifest;
  try {
    manifest = await fs.readJson(manifestPath);
  } catch (e) {
    return [err('manifest-invalid', `manifest.json is not valid JSON: ${(e as Error).message}`)];
  }

  // Media the build declared it did not render is tolerated as a reference target, nothing else.
  let omitted = new Set<string>(manifest.missingMedia ?? []);
  let info: OfflineInfo | undefined;
  if (mode === 'offline') {
    if (!(await fs.pathExists(path.join(dir, 'offline.json'))))
      out.push(err('offline-info-missing', 'offline.json not found'));
    else {
      info = await fs.readJson(path.join(dir, 'offline.json'));
      omitted = new Set([...omitted, ...info!.omitted.map((o) => o.path)]);
      if (info!.releaseId !== manifest.releaseId || info!.contentHash !== manifest.contentHash) {
        out.push(
          err(
            'release-identity-mismatch',
            'offline.json and manifest.json describe different releases',
          ),
        );
      }
    }
  }

  // Identity: releaseId is derived from content, so any edit after build is caught here.
  const expectedHash = computeContentHash(manifest.files, manifest.missingMedia ?? []);
  if (expectedHash !== manifest.contentHash)
    out.push(err('content-hash-mismatch', 'manifest.contentHash does not match its file list'));
  if (!manifest.releaseId.endsWith(manifest.contentHash.slice(0, 12)))
    out.push(err('release-id-mismatch', 'releaseId is not derived from contentHash'));

  const present = new Set(listFiles(dir));
  for (const f of manifest.files) {
    if (omitted.has(f.path)) {
      if (present.has(f.path))
        out.push(
          err('omitted-but-present', 'file is declared omitted in offline.json but exists', f.path),
        );
      continue;
    }
    if (!present.has(f.path)) {
      out.push(err('file-missing', 'listed in manifest but not present', f.path));
      continue;
    }
    const buf = await fs.readFile(path.join(dir, f.path));
    if (buf.length !== f.size)
      out.push(err('size-mismatch', `expected ${f.size} bytes, found ${buf.length}`, f.path));
    else if (sha256(buf) !== f.sha256)
      out.push(err('hash-mismatch', 'sha256 differs from manifest', f.path));
  }

  const known = new Set<string>(['manifest.json', ...manifest.files.map((f) => f.path)]);
  if (mode === 'offline') PACKAGE_FILES.forEach((p) => known.add(p));
  for (const p of present)
    if (!known.has(p)) out.push(err('unlisted-file', 'present but not in the manifest', p));

  if (mode === 'offline' && present.has('SHA256SUMS')) {
    const lines = (await fs.readFile(path.join(dir, 'SHA256SUMS'), 'utf8')).trim().split('\n');
    const listed = new Set<string>();
    for (const line of lines) {
      const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      if (!m) {
        out.push(err('sums-malformed', `bad SHA256SUMS line: ${line}`, 'SHA256SUMS'));
        continue;
      }
      listed.add(m[2]);
      if (!present.has(m[2]))
        out.push(err('sums-file-missing', 'listed in SHA256SUMS but absent', m[2]));
      else if (sha256(await fs.readFile(path.join(dir, m[2]))) !== m[1])
        out.push(err('sums-mismatch', 'does not match SHA256SUMS', m[2]));
    }
    for (const p of present)
      if (p !== 'SHA256SUMS' && !listed.has(p))
        out.push(err('sums-unlisted', 'not covered by SHA256SUMS', p));
  }

  // Graph consistency: the manifest's summary must describe the files it ships.
  try {
    const nodes = (await fs.readJson(path.join(dir, 'knowledge/graph/nodes.json'))).nodes;
    const edges = (await fs.readJson(path.join(dir, 'knowledge/graph/edges.json'))).edges;
    if (nodes.length !== manifest.graph.nodes || edges.length !== manifest.graph.edges) {
      out.push(
        err(
          'graph-count-mismatch',
          `manifest says ${manifest.graph.nodes} nodes / ${manifest.graph.edges} edges; files have ${nodes.length} / ${edges.length}`,
        ),
      );
    }
    const ids = new Set<string>(nodes.map((n: { id: string }) => n.id));
    for (const e of edges as { source: string; target: string }[]) {
      if (!ids.has(e.source) || !ids.has(e.target))
        out.push(
          err(
            'dangling-edge',
            `edge ${e.source} -> ${e.target} references a missing node`,
            'knowledge/graph/edges.json',
          ),
        );
    }
    for (const l of manifest.locales) {
      for (const p of [
        `knowledge/content/${l.code}.json`,
        `knowledge/search/search-index.${l.code}.json`,
      ]) {
        if (!present.has(p))
          out.push(err('locale-incomplete', `locale ${l.code} is declared but ${p} is absent`, p));
      }
    }
  } catch (e) {
    out.push(err('graph-unreadable', (e as Error).message));
  }

  // Asset references in text files.
  for (const file of [...present].filter((p) => TEXT.test(p)).sort()) {
    const text = await fs.readFile(path.join(dir, file), 'utf8');
    const check = (ref: string, isLoad: boolean) => {
      if (/^(?:data:|mailto:|tel:|javascript:|#)/i.test(ref)) return;
      if (/^https?:\/\//i.test(ref) || ref.startsWith('//')) {
        // Only resources the page loads are dependencies; outbound links are just links.
        if (isLoad && mode === 'offline' && !IGNORED_HOSTS.test(ref))
          out.push(err('external-dependency', `loads ${ref} — not available offline`, file));
        return;
      }
      if (ref.startsWith('/')) {
        out.push(
          err(
            'root-absolute-url',
            `"${ref}" only works at the domain root; use a relative or base-aware URL`,
            file,
          ),
        );
        return;
      }
      const target = resolveLocal(file, ref);
      if (!target) return;
      const candidates = [
        target,
        `${target}/index.html`,
        `${target.replace(/\/$/, '')}/index.html`,
      ];
      if (!candidates.some((c) => present.has(c))) {
        const wasOmitted = [...omitted].some((o) => o === target);
        if (!wasOmitted)
          out.push(
            err('broken-reference', `"${ref}" does not resolve to a file in the release`, file),
          );
      }
    };
    for (const ref of loadReferences(file, text)) check(ref, true);
    if (file.endsWith('.html')) for (const ref of anchorTargets(text)) check(ref, false);
  }

  return out;
}

/** Extracts a ZIP into a fresh temp dir (rejecting unsafe paths) and verifies it as an offline package. */
export async function verifyZip(
  zipPath: string,
): Promise<{ diagnostics: Diagnostic[]; extractedDir: string; folder: string }> {
  const entries = unzipSync(new Uint8Array(await fs.readFile(zipPath)));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-zip-'));
  const roots = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const parts = name.split('/');
    if (name.startsWith('/') || parts.includes('..') || parts.length < 2) {
      diagnostics.push(err('zip-unsafe-entry', `refusing entry "${name}"`));
      continue;
    }
    roots.add(parts[0]);
    await fs.outputFile(path.join(tmp, name), Buffer.from(data));
  }
  if (roots.size !== 1)
    diagnostics.push(
      err(
        'zip-layout',
        `expected a single top-level folder, found: ${[...roots].join(', ') || 'none'}`,
      ),
    );
  const folder = [...roots][0] ?? '';
  if (diagnostics.length === 0)
    diagnostics.push(...(await verifyReleaseDir(path.join(tmp, folder), 'offline')));
  return { diagnostics, extractedDir: path.join(tmp, folder), folder };
}
