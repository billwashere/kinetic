import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import { IntegrationActor } from '../src/lib/integration/actor';
import type { LoginConfig } from '../src/lib/integration/actor';

dotenv.config();

/**
 * Playwright global setup — runs once before the entire test suite.
 *
 * Authenticates each integration service and saves the browser storage state
 * (cookies, localStorage) to .auth/<service>.json. Subsequent test runs and
 * workers restore this state via IntegrationActor.create({ storageStatePath })
 * instead of logging in again — saving time and reducing auth-related flakiness.
 *
 * HOW TO ADD A NEW SERVICE:
 *   1. Add its credentials to .env  (XYZ_URL, XYZ_EMAIL, XYZ_PASSWORD)
 *   2. Add a ServiceSetup entry to the SERVICES array below, with the correct
 *      login form selectors for that app.
 *   3. Use the saved state in your spec:
 *        IntegrationActor.create(browser, loadService('xyz'), {
 *          storageStatePath: '.auth/xyz.json',
 *        })
 *
 * AUTH EXPIRY:
 *   Saved sessions expire when the app's session timeout is reached.
 *   Delete .auth/*.json to force a fresh login on the next run.
 *   In CI, treat .auth/ as a cache artifact keyed on the day or auth-file hash.
 *
 * SSO / SAML / OAuth:
 *   Replace the LoginConfig block with the appropriate IdP navigation.
 *   For OAuth, drive the browser through the consent screen and capture
 *   the resulting cookies with saveState() at the end.
 */

interface ServiceSetup {
  /** Human-readable name used in log output */
  name: string;
  /** URL env var name — the service URL is read from process.env[urlEnvVar] */
  urlEnvVar: string;
  /** Where to write the storage state file */
  storageStatePath: string;
  /** Credentials read from env vars — never hardcoded */
  credentials: () => { email: string; password: string } | null;
  /** Login form configuration for this service */
  loginConfig: Omit<LoginConfig, 'email' | 'password'>;
}

// ─── Service definitions ──────────────────────────────────────────────────────
// Selectors and login paths are app-specific — they live here in code.
// Credentials and URLs are environment-specific — they live in .env.

const SERVICES: ServiceSetup[] = [
  {
    name: 'XYZ (au.xyz.com)',
    urlEnvVar: 'XYZ_URL',
    storageStatePath: '.auth/xyz.json',
    credentials: () => {
      const email = process.env.XYZ_EMAIL;
      const password = process.env.XYZ_PASSWORD;
      return email && password ? { email, password } : null;
    },
    loginConfig: {
      path: '/login',
      emailSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button[type=submit]',
      waitFor: 'networkidle',
    },
  },
  {
    name: 'ABC (abc.com)',
    urlEnvVar: 'ABC_URL',
    storageStatePath: '.auth/abc.json',
    credentials: () => {
      const email = process.env.ABC_EMAIL;
      const password = process.env.ABC_PASSWORD;
      return email && password ? { email, password } : null;
    },
    loginConfig: {
      // ABC uses a different login page structure — selectors are specific to this app
      path: '/sign-in',
      emailSelector: 'input[name=email]',
      passwordSelector: 'input[name=password]',
      submitSelector: '.btn-primary[type=submit]',
      waitFor: 'networkidle',
    },
  },
];

// ─── Setup runner ─────────────────────────────────────────────────────────────

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();

  for (const service of SERVICES) {
    const url = process.env[service.urlEnvVar];

    if (!url) {
      console.log(`  ⚙️  Skipping ${service.name} — ${service.urlEnvVar} not set`);
      continue;
    }

    const credentials = service.credentials();

    if (!credentials) {
      console.log(`  ⚙️  Skipping ${service.name} — credentials not set in .env`);
      continue;
    }

    console.log(`  🔑 Authenticating ${service.name}...`);

    const actor = await IntegrationActor.create(browser, url);

    try {
      await actor.login({ ...service.loginConfig, ...credentials });
      await actor.saveState(service.storageStatePath);
      console.log(`  ✅ Session saved → ${service.storageStatePath}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Non-fatal — a service being down doesn't block unrelated tests.
      // Tests that need this service will fail with a clearer message.
      console.warn(`  ⚠️  Auth failed for ${service.name}: ${message}`);
    } finally {
      await actor.close();
    }
  }

  await browser.close();
  console.log('  Global setup complete.\n');
}
