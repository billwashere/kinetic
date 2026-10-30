import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import path from 'path';

// Resolve the engine public directory through workspace config so it can live
// outside the subtree in a git-subtree deployment.
// Dynamic import via require() since workspace-config is TypeScript (ts-node handles it
// for scripts, but for astro.config.mjs we use a direct path resolution with env var).
const engineRoot = path.resolve(import.meta.dirname, '../../packages/engine');
const publicDir = process.env.KINETIC_PUBLIC_DIR ?? path.join(engineRoot, 'public');

export default defineConfig({
  // Directory URLs with a trailing slash let pages use document-relative links (see [pageId].astro).
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [react(), tailwind()],
  // publicDir serves the engine's output assets (videos, audio, images).
  // Override with KINETIC_PUBLIC_DIR for subtree deployments where public/
  // lives outside the subtree.
  publicDir,
});
