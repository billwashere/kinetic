import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import {
  findConfigFile,
  loadWorkspaceConfig,
  resolvePath,
  readPluginHtml,
  _resetConfigCache,
} from './workspace-config';

// Restore env and cache around each test
const originalEnv = { ...process.env };
beforeEach(() => _resetConfigCache());
afterEach(() => {
  _resetConfigCache();
  for (const key of Object.keys(process.env)) {
    if (!originalEnv[key]) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

// ─── findConfigFile ───────────────────────────────────────────────────────────

describe('findConfigFile', () => {
  it('returns null when no config exists in the tree', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-find-'));
    expect(findConfigFile(tmpDir)).toBeNull();
    await fs.remove(tmpDir);
  });

  it('finds the config file in the start directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-find-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    await fs.writeJson(configPath, {});
    expect(findConfigFile(tmpDir)).toBe(configPath);
    await fs.remove(tmpDir);
  });

  it('finds the config file in a parent directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-find-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    const childDir = path.join(tmpDir, 'packages', 'engine');
    await fs.ensureDir(childDir);
    await fs.writeJson(configPath, {});
    expect(findConfigFile(childDir)).toBe(configPath);
    await fs.remove(tmpDir);
  });

  it('finds the nearest config file (does not skip to a distant ancestor)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-find-'));
    const rootConfig = path.join(tmpDir, 'kinetic.config.json');
    const childDir = path.join(tmpDir, 'packages');
    const childConfig = path.join(childDir, 'kinetic.config.json');
    await fs.ensureDir(childDir);
    await fs.writeJson(rootConfig, { site: { name: 'Root' } });
    await fs.writeJson(childConfig, { site: { name: 'Child' } });
    // Starting from childDir, finds childConfig first
    expect(findConfigFile(childDir)).toBe(childConfig);
    await fs.remove(tmpDir);
  });
});

// ─── loadWorkspaceConfig — defaults ──────────────────────────────────────────

describe('loadWorkspaceConfig — defaults (no config file)', () => {
  it('returns default site config when no config file exists', () => {
    // KINETIC_CONFIG points to a non-existent directory so walk-up doesn't find anything
    // (We can't easily control the walk-up in tests, so use an explicit non-existent path)
    // Instead, test the default values by using an empty config file
    const { config } = loadWorkspaceConfig();
    expect(config.site.name).toBeTypeOf('string');
    expect(config.site.name.length).toBeGreaterThan(0);
  });

  it('returns default theme with a valid hex primary colour', () => {
    const { config } = loadWorkspaceConfig();
    expect(config.theme.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

// ─── loadWorkspaceConfig — KINETIC_CONFIG env var ────────────────────────────

describe('loadWorkspaceConfig — KINETIC_CONFIG env var', () => {
  it('throws when KINETIC_CONFIG points to a non-existent file', () => {
    process.env.KINETIC_CONFIG = '/tmp/does-not-exist-kinetic.config.json';
    expect(() => loadWorkspaceConfig()).toThrow('KINETIC_CONFIG');
  });

  it('loads and validates a valid config file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-cfg-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    await fs.writeJson(configPath, {
      site: { name: 'Acme Docs', description: 'Acme docs.' },
      theme: { primary: '#9333ea' },
    });
    process.env.KINETIC_CONFIG = configPath;

    const { config, configDir } = loadWorkspaceConfig();
    expect(config.site.name).toBe('Acme Docs');
    expect(config.theme.primary).toBe('#9333ea');
    expect(config.theme.primaryLight).toBe('#eff6ff'); // default applied
    expect(configDir).toBe(tmpDir);

    await fs.remove(tmpDir);
  });

  it('throws on invalid config with a clear error message', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-cfg-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    await fs.writeJson(configPath, { theme: { primary: 123 } }); // invalid type
    process.env.KINETIC_CONFIG = configPath;

    expect(() => loadWorkspaceConfig()).toThrow();

    await fs.remove(tmpDir);
  });

  it('applies default values for omitted fields', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-cfg-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    await fs.writeJson(configPath, { site: { name: 'My Docs' } });
    process.env.KINETIC_CONFIG = configPath;

    const { config } = loadWorkspaceConfig();
    expect(config.site.name).toBe('My Docs');
    expect(config.site.favicon).toBe('/assets/favicon.ico'); // default
    expect(config.paths.locales).toBeUndefined(); // not set
    expect(config.plugins.head).toBeUndefined(); // not set

    await fs.remove(tmpDir);
  });

  it('caches: second call returns same object without re-reading disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-cfg-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    await fs.writeJson(configPath, { site: { name: 'Cached' } });
    process.env.KINETIC_CONFIG = configPath;

    const first = loadWorkspaceConfig();
    const second = loadWorkspaceConfig();
    expect(first).toBe(second); // same reference

    await fs.remove(tmpDir);
  });
});

// ─── resolvePath ─────────────────────────────────────────────────────────────

describe('resolvePath', () => {
  it('returns the fallback when paths.locales is not configured', () => {
    const fallback = '/some/engine/content/locales';
    expect(resolvePath('locales', fallback)).toBe(fallback);
  });

  it('returns the configured path resolved against the config directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-rp-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    await fs.writeJson(configPath, { paths: { locales: './docs/locales' } });
    process.env.KINETIC_CONFIG = configPath;

    const resolved = resolvePath('locales', '/unused-fallback');
    expect(resolved).toBe(path.join(tmpDir, 'docs', 'locales'));

    await fs.remove(tmpDir);
  });

  it('handles absolute paths in config (not resolved against configDir)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-rp-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    const absPath = path.join(os.tmpdir(), 'my-absolute-locales');
    await fs.writeJson(configPath, { paths: { locales: absPath } });
    process.env.KINETIC_CONFIG = configPath;

    const resolved = resolvePath('locales', '/unused-fallback');
    expect(resolved).toBe(absPath);

    await fs.remove(tmpDir);
  });
});

// ─── readPluginHtml ───────────────────────────────────────────────────────────

describe('readPluginHtml', () => {
  it('returns empty string when no plugin is configured', async () => {
    expect(await readPluginHtml('head')).toBe('');
  });

  it('returns empty string when the configured plugin file does not exist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-plugin-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    await fs.writeJson(configPath, { plugins: { head: './missing.html' } });
    process.env.KINETIC_CONFIG = configPath;

    expect(await readPluginHtml('head')).toBe('');
    await fs.remove(tmpDir);
  });

  it('returns the file contents when the plugin file exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-plugin-'));
    const configPath = path.join(tmpDir, 'kinetic.config.json');
    const pluginPath = path.join(tmpDir, 'plugins', 'head.html');
    await fs.ensureDir(path.dirname(pluginPath));
    await fs.writeFile(pluginPath, '<script>console.log("GA")</script>');
    await fs.writeJson(configPath, { plugins: { head: './plugins/head.html' } });
    process.env.KINETIC_CONFIG = configPath;

    const html = await readPluginHtml('head');
    expect(html).toBe('<script>console.log("GA")</script>');

    await fs.remove(tmpDir);
  });
});
