import path from 'path';
import fs from 'fs-extra';
import { z } from 'zod';

/**
 * Workspace configuration loader for git-subtree deployments.
 *
 * Kinetic Docs is designed to be vendored as a git subtree. When you run
 * `git subtree pull`, every file inside the subtree directory is overwritten.
 * Any configuration stored inside the subtree would be lost on update.
 *
 * This module solves that by discovering a `kinetic.config.json` file OUTSIDE
 * the subtree — at the monorepo root or wherever the user places it.
 *
 * DISCOVERY ORDER:
 *   1. KINETIC_CONFIG env var — explicit absolute or relative path
 *   2. Walk up from process.cwd() looking for kinetic.config.json
 *   3. No file found — all defaults apply (single-repo / dev mode, current behaviour)
 *
 * TYPICAL MONOREPO LAYOUT:
 *
 *   my-monorepo/
 *   ├── kinetic.config.json           ← user-owned, never overwritten
 *   ├── docs/
 *   │   ├── locales/                  ← locale JSON files
 *   │   ├── e2e-tests/                ← Playwright specs
 *   │   ├── layer-config.json         ← music, watermark, intro/outro
 *   │   ├── generated/                ← skeleton JSON (committed)
 *   │   ├── public/                   ← assets served by Astro
 *   │   │   └── assets/               ← music, logos
 *   │   └── portal-plugins/           ← HTML injection files
 *   │       ├── head.html
 *   │       ├── body-start.html
 *   │       ├── sidebar.html
 *   │       └── page.html
 *   └── packages/
 *       └── kinetic-docs/             ← git subtree (overwritten on pull)
 */

// ─── Schema ───────────────────────────────────────────────────────────────────

const SiteSchema = z.object({
  name: z.string().default('Kinetic Docs'),
  description: z.string().default('Step-by-step product documentation with video walkthroughs.'),
  favicon: z.string().default('/assets/favicon.ico'),
});

const ThemeSchema = z.object({
  primary: z.string().default('#2563eb'),
  primaryLight: z.string().default('#eff6ff'),
  primaryMid: z.string().default('#bfdbfe'),
  bg: z.string().default('#f8fafc'),
  surface: z.string().default('#ffffff'),
  sidebar: z.string().default('#ffffff'),
});

const PathsSchema = z.object({
  /** Locale JSON files — defaults to <engine>/content/locales */
  locales: z.string().optional(),
  /** Playwright test specs — defaults to <engine>/e2e-tests */
  tests: z.string().optional(),
  /** layer-config.json — defaults to <engine>/layer-config.json */
  layerConfig: z.string().optional(),
  /** Skeleton JSON and diff reports — defaults to <engine>/generated */
  generated: z.string().optional(),
  /** Public assets root (served by Astro) — defaults to <engine>/public */
  public: z.string().optional(),
});

const PluginsSchema = z.object({
  /** Injected inside <head> — analytics, fonts, meta tags */
  head: z.string().optional(),
  /** Injected at top of <body> — chat widgets, GTM noscript, cookie consent */
  bodyStart: z.string().optional(),
  /** Injected below the nav list in the sidebar */
  sidebar: z.string().optional(),
  /** Injected after the article content — feedback, comments, edit link */
  page: z.string().optional(),
});

const WorkspaceConfigSchema = z.object({
  site: SiteSchema.default(() => SiteSchema.parse({})),
  theme: ThemeSchema.default(() => ThemeSchema.parse({})),
  localeLabels: z.record(z.string(), z.string()).default({
    'en-US': 'EN',
    'ar-AE': 'AR',
    'fr-FR': 'FR',
    'de-DE': 'DE',
    'es-ES': 'ES',
    'ja-JP': 'JA',
    'zh-CN': 'ZH',
  }),
  localeNames: z.record(z.string(), z.string()).default({
    'en-US': 'English',
    'ar-AE': 'Arabic',
    'fr-FR': 'French',
    'de-DE': 'German',
    'es-ES': 'Spanish',
    'ja-JP': 'Japanese',
    'zh-CN': 'Chinese',
  }),
  paths: PathsSchema.default(() => PathsSchema.parse({})),
  plugins: PluginsSchema.default(() => PluginsSchema.parse({})),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

// ─── Resolution helpers ───────────────────────────────────────────────────────

export interface ResolvedConfig {
  /** The validated config values */
  config: WorkspaceConfig;
  /**
   * Resolves a user-configured path (relative to the config file) against a
   * fallback (relative to process.cwd() or an absolute default).
   *
   * @param configPath  The raw path from config.paths (may be undefined)
   * @param configDir   Directory where kinetic.config.json lives
   * @param fallback    Absolute path to use when the config key is absent
   */
  resolve: (configPath: string | undefined, configDir: string, fallback: string) => string;
  /** Absolute path to the directory containing kinetic.config.json, or null */
  configDir: string | null;
}

function resolveConfigPath(
  configPath: string | undefined,
  configDir: string,
  fallback: string,
): string {
  if (configPath) return path.resolve(configDir, configPath);
  return fallback;
}

// ─── Discovery ────────────────────────────────────────────────────────────────

const CONFIG_FILE_NAME = 'kinetic.config.json';
const CONFIG_ENV_VAR = 'KINETIC_CONFIG';

/**
 * Walks up from startDir looking for kinetic.config.json.
 * Stops at the filesystem root.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (true) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return null;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

let _cache: ResolvedConfig | null = null;

/**
 * Loads and caches the workspace config.
 * Safe to call multiple times — discovery and parsing only happen once.
 */
export function loadWorkspaceConfig(): ResolvedConfig {
  if (_cache) return _cache;

  let configFilePath: string | null = null;
  let configDir: string | null = null;

  // 1. Explicit env var
  const explicit = process.env[CONFIG_ENV_VAR];
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `${CONFIG_ENV_VAR}="${explicit}" does not exist.\n` + `Looked for: ${resolved}`,
      );
    }
    configFilePath = resolved;
  } else {
    // 2. Walk up from cwd
    configFilePath = findConfigFile(process.cwd());
  }

  let config: WorkspaceConfig;

  if (configFilePath) {
    configDir = path.dirname(configFilePath);
    const raw = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
    const result = WorkspaceConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid ${configFilePath}:\n${issues}`);
    }
    config = result.data;
  } else {
    // No config file — all defaults apply
    config = WorkspaceConfigSchema.parse({});
  }

  _cache = {
    config,
    configDir,
    resolve: (configPath, dir, fallback) => resolveConfigPath(configPath, dir, fallback),
  };

  return _cache;
}

/**
 * Clears the cached config. Only needed in tests that want to reload.
 * @internal
 */
export function _resetConfigCache(): void {
  _cache = null;
}

// ─── Convenience path accessors ───────────────────────────────────────────────
// Each accessor takes an explicit fallback so callers remain self-documenting
// about what path they'd use without a config file.

/**
 * Resolves a user-configured path from config.paths against the given fallback.
 *
 * @example
 *   // In engine scripts (cwd = packages/engine/):
 *   const localesDir = resolvePath('locales', path.join(process.cwd(), 'content/locales'));
 *
 *   // In Astro portal (cwd = apps/docs-portal/):
 *   const localesDir = resolvePath('locales', path.resolve('../../packages/engine/content/locales'));
 */
export function resolvePath(key: keyof WorkspaceConfig['paths'], fallback: string): string {
  const { config, configDir } = loadWorkspaceConfig();
  const raw = config.paths[key];
  if (raw && configDir) return path.resolve(configDir, raw);
  return fallback;
}

/**
 * Reads an HTML plugin file from the user's workspace.
 * Returns an empty string silently when the plugin is not configured or the file is missing.
 */
export async function readPluginHtml(slot: keyof WorkspaceConfig['plugins']): Promise<string> {
  const { config, configDir } = loadWorkspaceConfig();
  const raw = config.plugins[slot];
  if (!raw || !configDir) return '';
  const filePath = path.resolve(configDir, raw);
  return fs.readFile(filePath, 'utf8').catch(() => '');
}
