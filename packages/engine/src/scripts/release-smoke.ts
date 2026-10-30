import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { chromium, type Page } from '@playwright/test';
import { formatDiagnostic, hasErrors } from '../knowledge/model';
import { verifyZip } from '../knowledge/verify';

/**
 * Smoke test of the offline package exactly as a user would run it:
 * extract the ZIP, start the bundled launcher under a NON-ROOT base path, drive the explorer in a real
 * browser, and fail if anything is requested from outside the local server.
 *
 * Usage: release:smoke [file.zip]   (defaults to the newest ZIP in dist/release/offline)
 */
async function newestZip(): Promise<string> {
  const dir = path.resolve('dist/release/offline');
  const zips = (await fs.readdir(dir)).filter((f) => f.endsWith('.zip') && !f.includes('nomedia'));
  if (!zips.length) throw new Error(`no ZIP in ${dir} — run release:build first`);
  return path.join(
    dir,
    zips.map((z) => ({ z, t: fs.statSync(path.join(dir, z)).mtimeMs })).sort((a, b) => b.t - a.t)[0]
      .z,
  );
}

/** Runs axe-core in the page; serious/critical violations fail the smoke test. */
async function expectAccessible(page: Page, label: string): Promise<void> {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate<string[]>(`(async () => {
    const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] });
    return r.violations
      .filter((v) => ['serious', 'critical'].includes(v.impact))
      .map((v) => v.id + ': ' + v.nodes.slice(0, 6).map((n) => n.target.join(' ')).join(' | '));
  })()`);
  assert(violations.length === 0, `accessibility (${label}): ${violations.join('; ')}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`smoke assertion failed: ${msg}`);
}

function startLauncher(dir: string, base: string) {
  const proc = spawn(process.execPath, ['serve.mjs', '--port', '0', '--base', base], { cwd: dir });
  const url = new Promise<string>((resolve, reject) => {
    proc.stdout.on('data', (b: Buffer) => {
      const m = /(http:\/\/\S+)/.exec(b.toString());
      if (m) resolve(m[1]);
    });
    proc.on('error', reject);
    setTimeout(() => reject(new Error('launcher did not start')), 10_000);
  });
  return { proc, url };
}

async function main(): Promise<void> {
  const zip = process.argv[2] ? path.resolve(process.argv[2]) : await newestZip();
  const { diagnostics, extractedDir } = await verifyZip(zip);
  diagnostics.forEach((d) => console.log(formatDiagnostic(d)));
  assert(!hasErrors(diagnostics), 'ZIP failed integrity verification');

  const BASE = '/docs/offline/';
  const server = spawn(process.execPath, ['serve.mjs', '--port', '0', '--base', BASE], {
    cwd: extractedDir,
  });
  const url = await new Promise<string>((resolve, reject) => {
    server.stdout.on('data', (b: Buffer) => {
      const m = /(http:\/\/\S+)/.exec(b.toString());
      if (m) resolve(m[1]);
    });
    server.on('error', reject);
    setTimeout(() => reject(new Error('launcher did not start')), 10_000);
  });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const external: string[] = [];
    const origin = new URL(url).origin;
    await context.route('**/*', (route) => {
      if (route.request().url().startsWith(origin)) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    const failures: string[] = [];
    page.on('response', (r) => r.status() >= 400 && failures.push(`${r.status()} ${r.url()}`));
    page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));

    // Range requests: needed later for Parquet/media, so the launcher must honour them.
    const ranged = await fetch(`${url}manifest.json`, { headers: { Range: 'bytes=0-9' } });
    assert(ranged.status === 206, `launcher should answer Range with 206, got ${ranged.status}`);

    await page.goto(`${url}explorer/`);
    await page.waitForSelector('body[data-ready="true"]');
    assert((await page.textContent('#release'))?.includes('Release v'), 'release id shown');

    // Read + search, using keyboard only.
    await page.focus('#q');
    await page.keyboard.type('project creation');
    await page.keyboard.press('Enter');
    await page
      .getByRole('link', { name: /Project creation/ })
      .first()
      .click();
    await page.getByRole('heading', { level: 2, name: 'Project creation' }).waitFor();

    // Typed relationships with direction, verification and evidence.
    const rels = page.getByRole('list', { name: 'Relationships' });
    assert((await rels.textContent())?.includes('depends on'), 'depends_on relationship rendered');
    assert((await rels.textContent())?.includes('verified'), 'verification status rendered');
    assert((await page.locator('details summary').count()) > 0, 'evidence is inspectable');

    // Follow a relationship, then see the incoming direction.
    await rels.getByRole('link', { name: /Authentication/ }).click();
    await page.getByRole('heading', { level: 2, name: 'Authentication' }).waitFor();
    assert(
      (await page.getByRole('list', { name: 'Relationships' }).textContent())?.includes(
        'is required by',
      ),
      'inverse label on incoming edge',
    );

    await expectAccessible(page, 'standalone explorer');

    // Bounded expansion.
    await page.getByRole('button', { name: 'Expand neighbourhood' }).click();
    await page.getByRole('heading', { name: 'Further out' }).waitFor();

    // Relationship-type filter.
    await page.getByRole('checkbox', { name: /depends_on/ }).uncheck();
    assert(
      !(
        await page
          .getByRole('list', { name: 'Relationships' })
          .textContent()
          .catch(() => '')
      )?.includes('is required by'),
      'filter removes edge type',
    );

    // Locale: RTL + Arabic text where translated, fallback where not.
    await page.selectOption('#locale', 'ar-AE');
    await page
      .waitForFunction(() => document.documentElement.dir === 'rtl')
      .catch(() => assert(false, 'document direction follows locale'));
    await page.goto(`${url}explorer/#concept%3Aworkspace`);
    await page.getByRole('heading', { level: 2, name: 'مساحة العمل' }).waitFor();

    // The documentation site, when the release has one: same ZIP, served under this base AND the domain root.
    const manifest = await fs.readJson(path.join(extractedDir, 'manifest.json'));
    const info = await fs.readJson(path.join(extractedDir, 'offline.json'));
    if (manifest.capabilities.includes('docs-site')) {
      const declaredMissing = new Set<string>(info.omitted.map((o: { path: string }) => o.path));
      const rootServer = startLauncher(extractedDir, '/');
      try {
        const rootUrl = await rootServer.url;
        const rootOrigin = new URL(rootUrl).origin;
        await context.route(`${rootOrigin}/**`, (route) => route.continue());
        for (const siteUrl of [`${url}site/`, `${rootUrl}site/`]) {
          const before = failures.length;
          await page.goto(`${siteUrl}index.html`);
          await page.waitForURL(/\/create_project\/$/); // meta-refresh redirect from the site root
          await page.goto(`${siteUrl}v1.0/en-US/create_project/`);
          await page.getByRole('heading', { level: 1 }).first().waitFor();
          // Phase 4: knowledge context on the procedure page, with evidence and a working explorer link.
          const related = page.getByTestId('related-knowledge');
          assert(
            (await related.textContent())?.includes('is documented by this procedure'),
            `related knowledge shown at ${siteUrl}`,
          );
          assert(
            (await related.textContent())?.includes('verified'),
            'verification status shown on the page',
          );
          await related.locator('details summary').first().click();
          assert(
            (await related.textContent())?.includes('create_project / submit'),
            'evidence step shown',
          );
          const href = await related
            .getByRole('link', { name: 'Explore in graph' })
            .first()
            .getAttribute('href');
          const explorerResp = await page.request.get(
            new URL(href!, page.url()).href.split('#')[0],
          );
          assert(explorerResp.ok(), `explorer link resolves (${href})`);
          // The in-page explorer island: hydrate, search, follow a relationship, expand, then audit.
          const island = page.getByRole('region', { name: 'Explore the knowledge graph' });
          await island.waitFor();
          await island.getByRole('searchbox', { name: 'Search concepts' }).fill('authent');
          await island
            .getByRole('list', { name: 'Search results' })
            .getByRole('button', { name: 'Authentication' })
            .click();
          await island.getByRole('heading', { level: 4, name: /Authentication/ }).waitFor();
          assert(
            (await island.getByRole('list', { name: 'Relationships' }).textContent())?.includes(
              'is required by',
            ),
            'island shows inverse relationship',
          );
          await island.getByRole('button', { name: 'Expand neighbourhood' }).click();
          await island.getByRole('heading', { name: 'Further out' }).waitFor();
          await expectAccessible(page, `docs page at ${siteUrl}`);
          const sheetApplied = await page.evaluate(() => document.styleSheets.length > 0);
          assert(sheetApplied, `stylesheet loaded at ${siteUrl}`);
          // Follow in-page navigation: version/locale/prev/next links must stay inside the base.
          const dirBefore = await page.getAttribute('html', 'dir');
          await page.locator('a[href*="ar-AE"]').first().click();
          await page.waitForURL(/ar-AE/);
          assert(
            (await page.getAttribute('html', 'dir')) === 'rtl' && dirBefore === 'ltr',
            'locale link switches direction',
          );
          assert(
            page.url().startsWith(siteUrl),
            `navigation stayed under ${siteUrl}, got ${page.url()}`,
          );
          const unexpected = failures
            .slice(before)
            .filter((f) => ![...declaredMissing].some((m) => f.includes(m.replace(/^site\//, ''))));
          assert(
            unexpected.length === 0,
            `unexpected failures at ${siteUrl}: ${unexpected.join('; ')}`,
          );
          failures.length = before;
        }
      } finally {
        rootServer.proc.kill();
      }
    }

    assert(external.length === 0, `requests left the local server: ${external.join(', ')}`);
    assert(failures.length === 0, `failed requests/errors: ${failures.join('; ')}`);
    console.log(`✅ offline smoke passed against ${url} (${path.basename(zip)})`);
  } finally {
    await browser.close();
    server.kill();
    await fs.remove(path.dirname(extractedDir));
  }
}

main().catch((e) => {
  console.error('❌', e.message ?? e);
  process.exit(1);
});
