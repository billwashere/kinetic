import path from 'path';
import fs from 'fs-extra';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { resolveUrl } from '../../engine/domains';

/**
 * Login form configuration — selectors are app-specific and live in code.
 * Credentials are app-specific secrets and live in env vars.
 *
 * For SSO / SAML / OAuth flows, replace the login() call in your spec with
 * your IdP's entry-point navigation. The actor's page and context work the
 * same way regardless of how authentication happens.
 */
export interface LoginConfig {
  /** Path on this service's domain to navigate to. Default: '/login' */
  path?: string;
  /** CSS selector for the email or username field */
  emailSelector: string;
  /** CSS selector for the password field */
  passwordSelector: string;
  /** CSS selector for the submit button */
  submitSelector: string;
  /** Credentials — always read from env vars, never hardcoded */
  email: string;
  password: string;
  /**
   * What to wait for after clicking submit before proceeding.
   * Use 'networkidle' for SPAs that fetch data post-login.
   * Use 'load' for traditional page-redirect auth flows.
   * Default: 'networkidle'
   */
  waitFor?: 'networkidle' | 'load' | 'domcontentloaded';
}

export interface ActorOptions {
  /**
   * Path to a Playwright storageState JSON file written by a previous login.
   * If the file exists, the actor restores the session and skips the login page.
   * Populated by the global setup script (e2e-tests/global-setup.ts).
   */
  storageStatePath?: string;
  /** Recording and screenshot resolution. Default: 1920×1080 */
  viewport?: { width: number; height: number };
}

/**
 * IntegrationActor
 *
 * Encapsulates one browser context — and therefore one isolated cookie jar —
 * for a specific external service. Each actor logs into its own domain
 * independently, so cross-domain integration tests reflect how a real user
 * operates: two separate browser sessions, no accidental state leakage.
 *
 * TYPICAL USAGE:
 *
 *   const xyz = await IntegrationActor.create(browser, xyzUrl, {
 *     storageStatePath: '.auth/xyz.json',  // restored from global setup
 *   });
 *   const abc = await IntegrationActor.create(browser, abcUrl, {
 *     storageStatePath: '.auth/abc.json',
 *   });
 *
 *   try {
 *     await xyz.goto('/projects');
 *     await docStep(store, 'sync_flow', 'create', xyz.page, '#create-btn', 'create_key');
 *
 *     await abc.goto('/dashboard');
 *     await docAssert(store, 'sync_flow', 'verify', async () => {
 *       await expect(abc.page.locator('.new-project')).toBeVisible();
 *     }, 'verify_key');
 *   } finally {
 *     await xyz.close();
 *     await abc.close();
 *   }
 */
export class IntegrationActor {
  private constructor(
    private readonly context: BrowserContext,
    private readonly _page: Page,
    public readonly domain: string,
  ) {}

  /**
   * Creates an actor with its own isolated browser context.
   *
   * If `storageStatePath` points to an existing file, Playwright restores
   * cookies and localStorage from that snapshot — the actor starts already
   * logged in, skipping the login page entirely.
   *
   * If the file doesn't exist (first run, or auth expired), the actor starts
   * fresh. Call login() explicitly in the test or global setup.
   */
  static async create(
    browser: Browser,
    domain: string,
    options: ActorOptions = {},
  ): Promise<IntegrationActor> {
    const contextOptions: Parameters<Browser['newContext']>[0] = {
      viewport: options.viewport ?? { width: 1920, height: 1080 },
    };

    if (options.storageStatePath && (await fs.pathExists(options.storageStatePath))) {
      contextOptions.storageState = options.storageStatePath;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    return new IntegrationActor(context, page, domain);
  }

  /** The Playwright Page for this actor. Pass to docStep / docAssert. */
  get page(): Page {
    return this._page;
  }

  /**
   * Navigate to a path on this actor's domain.
   * Always uses an absolute URL so cross-origin navigation is unambiguous.
   */
  async goto(urlPath: string): Promise<void> {
    await this._page.goto(resolveUrl(this.domain, urlPath));
  }

  /**
   * Perform a form-based login on this actor's domain.
   *
   * Navigates to the login path, fills in credentials, submits, then waits
   * for the post-login page to settle. For SSO / SAML / OAuth, replace this
   * method call with the appropriate IdP navigation in your test or global setup.
   *
   * Credentials should always come from environment variables:
   *   email:    process.env.XYZ_EMAIL ?? ''
   *   password: process.env.XYZ_PASSWORD ?? ''
   */
  async login(config: LoginConfig): Promise<void> {
    await this.goto(config.path ?? '/login');
    await this._page.fill(config.emailSelector, config.email);
    await this._page.fill(config.passwordSelector, config.password);
    await this._page.click(config.submitSelector);
    await this._page.waitForLoadState(config.waitFor ?? 'networkidle');
  }

  /**
   * Saves the current browser storage state (cookies, localStorage, sessionStorage)
   * to disk so a future actor.create() call can restore the session.
   *
   * Call this at the end of global setup after a successful login.
   * The saved file is gitignored — it contains live session tokens.
   */
  async saveState(filePath: string): Promise<void> {
    await fs.ensureDir(path.dirname(filePath));
    await this.context.storageState({ path: filePath });
  }

  /**
   * Releases the browser context. Always call this in a try/finally block
   * so the context is closed even if the test fails.
   */
  async close(): Promise<void> {
    await this.context.close();
  }
}
