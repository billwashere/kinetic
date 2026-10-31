import fs from 'node:fs';
import path from 'node:path';

/**
 * The workspace's kinetic.config.json (KINETIC_CONFIG, else found by walking up from cwd), read without
 * validation: the engine validates it, the portal only needs the values. Without this the portal
 * ignores the config and renders the engine's bundled demo content instead of the workspace's.
 */
function find() {
  if (process.env.KINETIC_CONFIG) return path.resolve(process.env.KINETIC_CONFIG);
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, 'kinetic.config.json');
    if (fs.existsSync(candidate)) return candidate;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const file = find();
export const workspace = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const base = file ? path.dirname(file) : null;

/** A configured path resolved against the config file, else the engine default. Env vars still win. */
export function workspacePath(key, envVar, fallback) {
  if (process.env[envVar]) return process.env[envVar];
  const raw = workspace.paths?.[key];
  return raw && base ? path.resolve(base, raw) : fallback;
}

const engine = path.resolve('../../packages/engine');
export const dirs = {
  generated: workspacePath('generated', 'KINETIC_GENERATED_DIR', path.join(engine, 'generated')),
  locales: workspacePath('locales', 'KINETIC_LOCALES_DIR', path.join(engine, 'content/locales')),
  public: workspacePath('public', 'KINETIC_PUBLIC_DIR', path.join(engine, 'public')),
};
