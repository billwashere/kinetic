import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { resolvePath } from './src/engine/workspace-config';

dotenv.config();

const VERSION = process.env.DOCS_VERSION ?? 'v1.0';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

// testDir and globalSetup resolve through workspace config so they can live
// outside the subtree in a git-subtree deployment.
const testDir = resolvePath('tests', path.join(process.cwd(), 'e2e-tests'));

export default defineConfig({
  testDir,
  // A remote app is slower than a local dev server; raise these with KINETIC_TEST_TIMEOUT / KINETIC_EXPECT_TIMEOUT (ms).
  timeout: Number(process.env.KINETIC_TEST_TIMEOUT) || 30_000,
  expect: { timeout: Number(process.env.KINETIC_EXPECT_TIMEOUT) || 5_000 },
  globalSetup: path.join(testDir, 'global-setup.ts'),
  use: {
    baseURL: APP_URL,
    // Signed-in session saved by the workspace's global-setup, when it saves one.
    ...(process.env.KINETIC_STORAGE_STATE ? { storageState: process.env.KINETIC_STORAGE_STATE } : {}),
    video: { mode: 'on', size: { width: 1920, height: 1080 } },
    contextOptions: {
      recordVideo: {
        dir: resolvePath('public', path.join(process.cwd(), 'public')) + `/visual-cache/${VERSION}`,
      },
    },
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
  },
});
