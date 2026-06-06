import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { IntegrationActor } from './actor';

// ─── Playwright browser mock ──────────────────────────────────────────────────
// We mock at the minimal interface level rather than importing @playwright/test,
// which would require a real browser binary to be installed.

function makeMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockContext(page: ReturnType<typeof makeMockPage>) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    storageState: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockBrowser(context: ReturnType<typeof makeMockContext>) {
  return {
    newContext: vi.fn().mockResolvedValue(context),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IntegrationActor.create', () => {
  it('creates a browser context with the default 1920×1080 viewport', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);

    await IntegrationActor.create(browser as any, 'https://au.xyz.com');

    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { width: 1920, height: 1080 } }),
    );
  });

  it('accepts a custom viewport', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);

    await IntegrationActor.create(browser as any, 'https://au.xyz.com', {
      viewport: { width: 1280, height: 720 },
    });

    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { width: 1280, height: 720 } }),
    );
  });

  it('does not set storageState when storageStatePath is not provided', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);

    await IntegrationActor.create(browser as any, 'https://au.xyz.com');

    const callArg = browser.newContext.mock.calls[0][0];
    expect(callArg.storageState).toBeUndefined();
  });

  it('does not set storageState when the file does not exist', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);

    await IntegrationActor.create(browser as any, 'https://au.xyz.com', {
      storageStatePath: '/tmp/does-not-exist-xyz-auth.json',
    });

    const callArg = browser.newContext.mock.calls[0][0];
    expect(callArg.storageState).toBeUndefined();
  });

  it('sets storageState when the file exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-actor-'));
    const statePath = path.join(tmpDir, 'auth.json');
    await fs.writeJson(statePath, { cookies: [], origins: [] });

    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);

    await IntegrationActor.create(browser as any, 'https://au.xyz.com', {
      storageStatePath: statePath,
    });

    const callArg = browser.newContext.mock.calls[0][0];
    expect(callArg.storageState).toBe(statePath);

    await fs.remove(tmpDir);
  });
});

describe('IntegrationActor.goto', () => {
  async function makeActor(domain: string) {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);
    const actor = await IntegrationActor.create(browser as any, domain);
    return { actor, page };
  }

  it('navigates to the absolute URL formed by joining domain and path', async () => {
    const { actor, page } = await makeActor('https://au.xyz.com');
    await actor.goto('/projects');
    expect(page.goto).toHaveBeenCalledWith('https://au.xyz.com/projects');
  });

  it('prepends a leading slash to paths that lack one', async () => {
    const { actor, page } = await makeActor('https://au.xyz.com');
    await actor.goto('dashboard');
    expect(page.goto).toHaveBeenCalledWith('https://au.xyz.com/dashboard');
  });

  it('works correctly for a completely different domain', async () => {
    const { actor, page } = await makeActor('https://abc.com');
    await actor.goto('/reports');
    expect(page.goto).toHaveBeenCalledWith('https://abc.com/reports');
  });
});

describe('IntegrationActor.login', () => {
  it('navigates to the login path, fills credentials, submits, and waits', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);
    const actor = await IntegrationActor.create(browser as any, 'https://au.xyz.com');

    await actor.login({
      path: '/login',
      emailSelector: '#email',
      passwordSelector: '#password',
      submitSelector: 'button[type=submit]',
      email: 'user@company.com',
      password: 'secret',
    });

    // Navigation to login page
    expect(page.goto).toHaveBeenCalledWith('https://au.xyz.com/login');

    // Credentials filled in order
    expect(page.fill).toHaveBeenNthCalledWith(1, '#email', 'user@company.com');
    expect(page.fill).toHaveBeenNthCalledWith(2, '#password', 'secret');

    // Submit clicked
    expect(page.click).toHaveBeenCalledWith('button[type=submit]');

    // Waits for network to settle (default)
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle');
  });

  it('defaults to /login when no path is specified', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);
    const actor = await IntegrationActor.create(browser as any, 'https://abc.com');

    await actor.login({
      emailSelector: 'input[name=email]',
      passwordSelector: 'input[name=password]',
      submitSelector: '.btn-login',
      email: 'test@abc.com',
      password: 'pass',
    });

    expect(page.goto).toHaveBeenCalledWith('https://abc.com/login');
  });

  it('respects a custom waitFor strategy', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);
    const actor = await IntegrationActor.create(browser as any, 'https://abc.com');

    await actor.login({
      emailSelector: '#u',
      passwordSelector: '#p',
      submitSelector: '#s',
      email: 'u',
      password: 'p',
      waitFor: 'load',
    });

    expect(page.waitForLoadState).toHaveBeenCalledWith('load');
  });
});

describe('IntegrationActor.saveState', () => {
  it('calls context.storageState with the given file path', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);
    const actor = await IntegrationActor.create(browser as any, 'https://au.xyz.com');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-save-'));
    const filePath = path.join(tmpDir, 'auth.json');

    await actor.saveState(filePath);

    expect(context.storageState).toHaveBeenCalledWith({ path: filePath });

    await fs.remove(tmpDir);
  });

  it('creates intermediate directories if they do not exist', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);
    const actor = await IntegrationActor.create(browser as any, 'https://au.xyz.com');
    const filePath = path.join(os.tmpdir(), `kinetic-new-${Date.now()}`, 'nested', 'auth.json');

    await actor.saveState(filePath);

    // The directory should have been created
    expect(await fs.pathExists(path.dirname(filePath))).toBe(true);

    await fs.remove(path.dirname(path.dirname(filePath)));
  });
});

describe('IntegrationActor.close', () => {
  it('closes the browser context', async () => {
    const page = makeMockPage();
    const context = makeMockContext(page);
    const browser = makeMockBrowser(context);
    const actor = await IntegrationActor.create(browser as any, 'https://au.xyz.com');

    await actor.close();

    expect(context.close).toHaveBeenCalledOnce();
  });
});
