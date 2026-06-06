// build.mjs — compiles renderer-compat to dist/
// Run with: node build.mjs
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// ── Shared esbuild base ───────────────────────────────────────────────────────
// Externals are NOT bundled — they're resolved from node_modules at runtime.
// This keeps the dist/ output small and avoids re-bundling huge dependencies.
const node = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  external: [
    'react',
    'react-dom',
    'react-dom/client',
    'playwright',
    'esbuild',
    'execa',
    'fs-extra',
  ],
};

// ── react-api: the 'remotion' shim ────────────────────────────────────────────
// Compiled for node so ts-node consumers can import it for type extraction.
// At video-render time, bundler.ts re-compiles it for the browser via esbuild
// alias — this is just for the editor / type-check path.
await build({
  ...node,
  entryPoints: ['src/react-api.tsx'],
  outfile: 'dist/react-api.js',
});

// ── bundler ───────────────────────────────────────────────────────────────────
await build({
  ...node,
  entryPoints: ['src/bundler.ts'],
  outfile: 'dist/bundler.js',
});

// ── renderer ─────────────────────────────────────────────────────────────────
await build({
  ...node,
  entryPoints: ['src/renderer.ts'],
  outfile: 'dist/renderer.js',
});

// ── runner HTML template ──────────────────────────────────────────────────────
copyFileSync('src/runner.html', 'dist/runner.html');

console.log('✅  renderer-compat built → dist/');
console.log('   Next: pnpm tsc --emitDeclarationOnly -p tsconfig.build.json');
