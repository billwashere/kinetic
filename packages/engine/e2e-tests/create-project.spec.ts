import { test, expect } from '@playwright/test';
import { DocStore, docStep, docAssert, flushDocs } from '../src/lib/doc-extractor';
import { loginFlow } from './shared/login-flow';

const store = new DocStore();

test.afterAll(async () => {
  await flushDocs(store);
});

/**
 * Project Creation Flow
 *
 * Navigates to the live app at APP_URL (set in .env) and documents the
 * project creation workflow. Replace the selectors and paths below with
 * those from your real application.
 *
 * The loginFlow helper handles cross-domain auth if AUTH_URL differs from APP_URL.
 * It's safe to remove if the page under test doesn't require authentication.
 */
test('Project Creation Flow', async ({ page }) => {
  store.page('create_project');

  // loginFlow navigates to AUTH_URL/login (defaults to APP_URL/login if AUTH_URL is unset)
  await loginFlow(store, page, 'create_project');

  // Navigate to the page being documented.
  // Relative paths resolve against APP_URL (set as Playwright's baseURL).
  // Use DOMAINS.<service> + '/path' for pages on a different origin.
  await page.goto('/projects');

  await docStep(store, 'create_project', 'nav', page, '#nav', 'nav_to_project');
  await docStep(store, 'create_project', 'type_name', page, '#name', 'enter_name');
  await docStep(store, 'create_project', 'submit', page, '#submit', 'click_submit');

  await docAssert(
    store,
    'create_project',
    'verify_success',
    async () => {
      await expect(page.locator('#toast')).toBeVisible();
    },
    'verify_success',
  );
});
