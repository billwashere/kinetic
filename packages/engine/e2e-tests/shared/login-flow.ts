import { type DocStore, docStep } from '../../src/lib/doc-extractor';
import { DOMAINS, resolveUrl } from '../../src/engine/domains';

/**
 * Shared login flow — navigates to the auth service and completes the login form.
 *
 * AUTH_URL controls which origin is used. If AUTH_URL is not set it defaults to
 * APP_URL, so single-domain apps work with no extra config.
 *
 * For SSO / SAML flows, replace page.goto() here with your IdP's entry point.
 * For pre-authenticated tests (stored session), skip this flow entirely and
 * restore cookies via page.context().addCookies() in a beforeEach fixture instead.
 */
export async function loginFlow(store: DocStore, page: any, parentPageId: string): Promise<void> {
  // Navigate to the auth service's login page.
  // resolveUrl is explicit about which domain we're targeting — if AUTH_URL
  // differs from APP_URL this is a cross-origin navigation and Playwright
  // will follow the redirect automatically.
  await page.goto(resolveUrl(DOMAINS.auth, '/login'));

  await docStep(store, parentPageId, 'login_email', page, '#email', 'login_email');
}
