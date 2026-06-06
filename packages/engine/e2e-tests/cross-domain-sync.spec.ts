import { test, expect } from '@playwright/test';
import { DocStore, docStep, docAssert, flushDocs } from '../src/lib/doc-extractor';
import { IntegrationActor } from '../src/lib/integration/actor';
import { loadService } from '../src/engine/domains';

/**
 * Cross-domain integration spec
 *
 * Documents a workflow that spans two separate applications:
 *   1. The user creates a project in au.xyz.com
 *   2. They verify the project synced to abc.com
 *
 * Both services are pre-authenticated by the global setup script, so this test
 * restores saved sessions rather than logging in from scratch on every run.
 *
 * To run this spec:
 *   1. Set XYZ_URL, XYZ_EMAIL, XYZ_PASSWORD in .env
 *   2. Set ABC_URL, ABC_EMAIL, ABC_PASSWORD in .env
 *   3. Run `pnpm test:docs` — global setup authenticates first, then this spec runs
 *
 * To run against a different environment, just change the URL env vars — no
 * code changes needed. The selectors and flows are environment-agnostic.
 */

// loadService() reads XYZ_URL / ABC_URL from .env, validates them, and throws
// immediately with a clear message if either is missing. This prevents the test
// from starting and timing out mid-run due to a misconfigured environment.
const XYZ_URL = loadService('xyz');
const ABC_URL = loadService('abc');

const store = new DocStore();

test.afterAll(async () => {
  await flushDocs(store);
});

test('Project created in XYZ is reflected in ABC', async ({ browser }) => {
  store.page('xyz_to_abc_sync');

  // Each actor gets its own browser context — separate cookie jars.
  // The storageStatePath restores the session saved by global setup,
  // so neither actor has to log in again.
  const xyz = await IntegrationActor.create(browser, XYZ_URL, {
    storageStatePath: '.auth/xyz.json',
  });

  const abc = await IntegrationActor.create(browser, ABC_URL, {
    storageStatePath: '.auth/abc.json',
  });

  // Always close actors in a finally block so browser contexts are released
  // even if assertions fail partway through the test.
  try {
    // ── Act on au.xyz.com ──────────────────────────────────────────────────
    await xyz.goto('/projects');

    await docStep(
      store,
      'xyz_to_abc_sync',
      'open_new_project',
      xyz.page,
      '#create-project-btn',
      'create_project',
    );

    await docStep(
      store,
      'xyz_to_abc_sync',
      'enter_project_name',
      xyz.page,
      '#project-name',
      'enter_name',
    );

    await docStep(
      store,
      'xyz_to_abc_sync',
      'submit_project',
      xyz.page,
      '#submit-btn',
      'click_submit',
    );

    // Wait for XYZ to confirm the project was created before checking ABC.
    // This prevents a race condition where ABC hasn't received the sync event yet.
    await docAssert(
      store,
      'xyz_to_abc_sync',
      'xyz_confirm',
      async () => {
        await expect(xyz.page.locator('#success-toast')).toBeVisible();
      },
      'verify_xyz_success',
    );

    // ── Verify on abc.com ──────────────────────────────────────────────────
    // The project syncs asynchronously — navigate to ABC and wait for it to appear.
    await abc.goto('/dashboard');

    await docAssert(
      store,
      'xyz_to_abc_sync',
      'abc_reflects_project',
      async () => {
        // waitFor: 'visible' with a longer timeout accommodates sync latency.
        // Adjust the timeout based on your system's observed sync delay.
        await expect(abc.page.locator('[data-testid="synced-project"]')).toBeVisible({
          timeout: 15_000,
        });
      },
      'verify_abc_sync',
    );
  } finally {
    await xyz.close();
    await abc.close();
  }
});
