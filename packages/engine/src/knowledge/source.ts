import fs from 'fs-extra';
import path from 'path';
import { resolvePath } from '../engine/workspace-config';
import { validateLocale } from '../engine/locale-schema';
import { DEFAULT_LOCALE } from './registry';
import { loadKnowledgeDir } from './loader';
import { validateKnowledge } from './validate';
import { compileKnowledge, type ArtifactMap } from './compile';
import type {
  Diagnostic,
  KnowledgeInput,
  ParsedNode,
  SkeletonPage,
  ValidationResult,
} from './model';

export interface SourcePaths {
  /** Engine package root (cwd for all pipeline scripts). */
  engineRoot: string;
  knowledgeDir: string;
  localesDir: string;
  generatedDir: string;
  publicDir: string;
  /** Root `file` evidence paths resolve against. */
  repoRoot: string;
  docsVersion: string;
}

export function findRepoRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(from);
    dir = up;
  }
}

export function defaultPaths(engineRoot = process.cwd()): SourcePaths {
  return {
    engineRoot,
    knowledgeDir:
      process.env.KINETIC_KNOWLEDGE_DIR ??
      resolvePath('knowledge', path.join(engineRoot, 'content/knowledge')),
    localesDir:
      process.env.KINETIC_LOCALES_DIR ??
      resolvePath('locales', path.join(engineRoot, 'content/locales')),
    generatedDir:
      process.env.KINETIC_GENERATED_DIR ??
      resolvePath('generated', path.join(engineRoot, 'generated')),
    publicDir:
      process.env.KINETIC_PUBLIC_DIR ?? resolvePath('public', path.join(engineRoot, 'public')),
    repoRoot: findRepoRoot(engineRoot),
    docsVersion: process.env.DOCS_VERSION || 'v1.0',
  };
}

export interface LoadedKnowledge {
  paths: SourcePaths;
  authored: ParsedNode[];
  input: KnowledgeInput;
  dirOf: Record<string, 'ltr' | 'rtl'>;
  /** Problems found while reading sources, before graph validation. */
  loadDiagnostics: Diagnostic[];
}

export async function loadSources(paths: SourcePaths): Promise<LoadedKnowledge> {
  const loadDiagnostics: Diagnostic[] = [];

  const { nodes, diagnostics } = await loadKnowledgeDir(paths.knowledgeDir, paths.repoRoot);
  loadDiagnostics.push(...diagnostics);

  const skeletonPath = path.join(paths.generatedDir, paths.docsVersion, 'extracted-skeleton.json');
  let skeleton: SkeletonPage[] = [];
  if (await fs.pathExists(skeletonPath)) skeleton = await fs.readJson(skeletonPath);
  else
    loadDiagnostics.push({
      severity: 'error',
      code: 'missing-skeleton',
      message: `no skeleton at ${path.relative(paths.repoRoot, skeletonPath)} — run "pnpm test:docs" or set DOCS_VERSION`,
    });

  const locales: KnowledgeInput['locales'] = {};
  const dirOf: LoadedKnowledge['dirOf'] = {};
  const files = (await fs.pathExists(paths.localesDir))
    ? (await fs.readdir(paths.localesDir)).filter((f) => f.endsWith('.json')).sort()
    : [];
  for (const f of files) {
    const code = path.basename(f, '.json');
    const rel = path
      .relative(paths.repoRoot, path.join(paths.localesDir, f))
      .split(path.sep)
      .join('/');
    try {
      const data = validateLocale(await fs.readJson(path.join(paths.localesDir, f)), rel);
      locales[code] = data;
      dirOf[code] = data.dir;
    } catch (e) {
      loadDiagnostics.push({
        severity: 'error',
        code: 'invalid-locale',
        message: (e as Error).message,
        file: rel,
      });
    }
  }

  const checkFile: KnowledgeInput['checkFile'] = (p, symbol) => {
    const abs = path.resolve(paths.repoRoot, p);
    // Evidence must point inside the repo; reject traversal rather than reading arbitrary files.
    if (
      !abs.startsWith(paths.repoRoot + path.sep) ||
      !fs.existsSync(abs) ||
      !fs.statSync(abs).isFile()
    )
      return 'missing-file';
    if (symbol && !fs.readFileSync(abs, 'utf8').includes(symbol)) return 'missing-symbol';
    return 'ok';
  };

  return {
    paths,
    authored: nodes,
    dirOf,
    loadDiagnostics,
    input: { nodes, skeleton, locales, defaultLocale: DEFAULT_LOCALE, checkFile },
  };
}

export interface KnowledgeBuild {
  loaded: LoadedKnowledge;
  validation: ValidationResult;
  diagnostics: Diagnostic[];
  /** Files keyed relative to `knowledge/` in the release. Empty if validation produced errors. */
  artifacts: ArtifactMap;
}

export async function buildKnowledge(paths: SourcePaths = defaultPaths()): Promise<KnowledgeBuild> {
  const loaded = await loadSources(paths);
  const validation = validateKnowledge(loaded.input);
  const diagnostics = [...loaded.loadDiagnostics, ...validation.diagnostics];
  const failed = diagnostics.some((d) => d.severity === 'error');
  return {
    loaded,
    validation,
    diagnostics,
    artifacts: failed
      ? new Map()
      : compileKnowledge(validation, loaded.authored, loaded.dirOf, DEFAULT_LOCALE),
  };
}
