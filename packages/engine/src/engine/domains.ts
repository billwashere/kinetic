import { z } from 'zod';

/**
 * Domain Registry
 *
 * Single source of truth for all external URLs the pipeline navigates to.
 * Read entirely from environment variables so the same test suite works against
 * local, staging, and production without any code changes.
 *
 * ENVIRONMENT SWITCHING (same domain structure, different host):
 *   APP_URL=https://staging.myapp.com pnpm test:docs
 *
 * CROSS-DOMAIN INTEGRATION (distinct services at different origins):
 *   APP_URL=https://app.myapp.com
 *   AUTH_URL=https://auth.myapp.com
 *   ADMIN_URL=https://admin.myapp.com
 *
 * In Playwright tests, use relative paths for the primary domain (APP_URL) and
 * DOMAINS.<service> for any other origin, so cross-domain navigation is explicit:
 *
 *   await page.goto('/projects');          // → APP_URL/projects
 *   await page.goto(DOMAINS.auth + '/sso') // → AUTH_URL/sso (different origin)
 */

// Zod strips trailing slashes so paths always join cleanly with `/`
const UrlSchema = z
  .string()
  .url('Must be a fully-qualified URL, e.g. http://localhost:3000')
  .refine(
    (u) => u.startsWith('http://') || u.startsWith('https://'),
    'URL must use http:// or https:// — bare hostnames like "localhost:3000" are not valid',
  )
  .transform((u) => u.replace(/\/$/, ''));

const DomainsSchema = z.object({
  /** Primary application — used as Playwright's baseURL, so relative paths resolve here. */
  app: UrlSchema,

  /**
   * Authentication service.
   * May be the same origin as `app` (e.g. myapp.com/login) or a separate IdP
   * (e.g. auth.myapp.com, accounts.google.com for SSO).
   * Defaults to `app` if AUTH_URL is not set.
   */
  auth: UrlSchema,

  /**
   * Admin / back-office panel.
   * Often a distinct subdomain with its own session cookie.
   * Defaults to `app` if ADMIN_URL is not set.
   */
  admin: UrlSchema,
});

export type Domains = z.infer<typeof DomainsSchema>;

function loadDomains(): Domains {
  const app = process.env.APP_URL ?? 'http://localhost:3000';

  const raw = {
    app,
    auth: process.env.AUTH_URL ?? app, // default: auth lives on the same origin as app
    admin: process.env.ADMIN_URL ?? app, // default: admin lives on the same origin as app
  };

  const result = DomainsSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(
      `Invalid domain configuration:\n${issues}\n\nCheck APP_URL, AUTH_URL, ADMIN_URL in your .env file.`,
    );
  }

  return result.data;
}

// Evaluated once at import time — any misconfiguration fails loudly before
// Playwright even starts running tests, rather than mid-run.
export const DOMAINS: Domains = loadDomains();

/**
 * Resolves a path against a domain, for cases where you need an absolute URL
 * but still want the domain to come from the registry.
 *
 * @example
 *   resolveUrl(DOMAINS.auth, '/oauth/callback')
 *   // → 'https://auth.myapp.com/oauth/callback'
 */
export function resolveUrl(domain: string, path: string): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${domain}${normalised}`;
}

/**
 * Loads an arbitrary integration service URL by convention.
 *
 * Looks up `<NAME>_URL` in the environment, validates it, and returns the
 * stripped URL — so tests never hardcode domain strings or forget to validate.
 *
 * @example
 *   // .env:  XYZ_URL=https://au.xyz.com
 *   //        ABC_URL=https://abc.com
 *
 *   const xyzUrl = loadService('xyz');   // → 'https://au.xyz.com'
 *   const abcUrl = loadService('abc');   // → 'https://abc.com'
 *
 * Throws immediately (before any test runs) if the env var is missing or invalid.
 */
export function loadService(name: string): string {
  const envVar = `${name.toUpperCase()}_URL`;
  const raw = process.env[envVar];

  if (!raw) {
    throw new Error(
      `Integration service "${name}" requires ${envVar} to be set in your .env file.\n` +
        `Example: ${envVar}=https://au.xyz.com`,
    );
  }

  const result = UrlSchema.safeParse(raw);

  if (!result.success) {
    const reason = result.error.issues.map((i) => i.message).join(', ');
    throw new Error(`${envVar}="${raw}" is not a valid URL: ${reason}`);
  }

  return result.data;
}
