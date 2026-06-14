import { describe, it, expect } from 'vitest';
import { generateMarkdownPage, generateCorpusLines, type CorpusRecord } from './text-exporter';
import type { DocPage } from './doc-extractor';
import type { LocaleData } from '../engine/locale-schema';
import type { AudioManifest } from './manifest-reader';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const locale = 'en-US';
const version = 'v1.0';

const localeData: LocaleData = {
  locale: 'en-US',
  dir: 'ltr',
  pages: {
    login: {
      title: 'Logging In',
      description: 'Learn how to sign in to your account.',
      breadcrumbs: ['Home', 'Auth'],
    },
  },
  strings: {
    enter_email: 'Enter your email address.',
    click_sign_in: 'Click Sign In to continue.',
    dashboard_loaded: 'The dashboard appears.',
    admin_note: 'This step requires admin permissions.',
  },
};

const page: DocPage = {
  pageId: 'login',
  steps: [
    {
      type: 'action',
      stepId: 'enter_email',
      textKey: 'enter_email',
      anchor: { x: 100, y: 200, width: 300, height: 40 },
    },
    {
      type: 'action',
      stepId: 'click_sign_in',
      textKey: 'click_sign_in',
      anchor: { x: 640, y: 500, width: 120, height: 40 },
    },
    { type: 'assertion', stepId: 'dashboard_loaded', textKey: 'dashboard_loaded', anchor: null },
    { type: 'note', stepId: 'admin_note_step', textKey: 'admin_note', anchor: null },
  ],
};

const manifest: AudioManifest = {
  'en-US_login_enter_email': {
    file: 'audio-objects/abc.mp3',
    duration: 2.5,
    text: 'Enter your email address.',
    anchor: null,
  },
  'en-US_login_click_sign_in': {
    file: 'audio-objects/def.mp3',
    duration: 1.8,
    text: 'Click Sign In to continue.',
    anchor: null,
  },
};

// ─── generateMarkdownPage ─────────────────────────────────────────────────────

describe('generateMarkdownPage', () => {
  it('includes the page title as an H1', () => {
    const md = generateMarkdownPage(page, localeData, manifest, locale);
    expect(md).toContain('# Logging In');
  });

  it('renders breadcrumbs as a blockquote', () => {
    const md = generateMarkdownPage(page, localeData, manifest, locale);
    expect(md).toContain('> Home > Auth');
  });

  it('includes the page description', () => {
    const md = generateMarkdownPage(page, localeData, manifest, locale);
    expect(md).toContain('Learn how to sign in to your account.');
  });

  it('numbers action steps sequentially', () => {
    const md = generateMarkdownPage(page, localeData, manifest, locale);
    expect(md).toContain('1. Enter your email address.');
    expect(md).toContain('2. Click Sign In to continue.');
  });

  it('prefixes assertion steps with ✓ and includes them in the numbered list', () => {
    const md = generateMarkdownPage(page, localeData, manifest, locale);
    expect(md).toContain('3. ✓ The dashboard appears.');
  });

  it('renders notes as blockquotes with a Note: label, outside the numbered list', () => {
    const md = generateMarkdownPage(page, localeData, manifest, locale);
    expect(md).toContain('> **Note:** This step requires admin permissions.');
    // Notes must not appear as numbered items
    expect(md).not.toMatch(/\d+\. .*admin permissions/);
  });

  it('prefers manifest text over locale strings', () => {
    const altManifest: AudioManifest = {
      'en-US_login_enter_email': {
        file: 'audio-objects/abc.mp3',
        duration: 2.5,
        text: 'Type your email here.',
        anchor: null,
      },
    };
    const md = generateMarkdownPage(page, localeData, altManifest, locale);
    expect(md).toContain('Type your email here.');
    expect(md).not.toContain('Enter your email address.');
  });

  it('falls back to locale strings when manifest has no entry', () => {
    const md = generateMarkdownPage(page, localeData, null, locale);
    expect(md).toContain('1. Enter your email address.');
  });

  it('falls back to stepId when neither manifest nor locale string exists', () => {
    const minimalLocale: LocaleData = {
      ...localeData,
      strings: {},
    };
    const md = generateMarkdownPage(page, minimalLocale, null, locale);
    expect(md).toContain('enter_email');
  });

  it('omits comment steps entirely', () => {
    const pageWithComment: DocPage = {
      pageId: 'login',
      steps: [
        { type: 'action', stepId: 'enter_email', textKey: 'enter_email', anchor: null },
        { type: 'comment', stepId: '__comment_1', comment: 'TODO: update once V2 ships' },
        { type: 'action', stepId: 'click_sign_in', textKey: 'click_sign_in', anchor: null },
      ],
    };
    const md = generateMarkdownPage(pageWithComment, localeData, null, locale);
    expect(md).not.toContain('TODO');
    expect(md).toContain('1. Enter your email address.');
    expect(md).toContain('2. Click Sign In to continue.');
  });

  it('handles a page with no steps', () => {
    const emptyPage: DocPage = { pageId: 'login', steps: [] };
    const md = generateMarkdownPage(emptyPage, localeData, null, locale);
    expect(md).toContain('# Logging In');
    expect(md).toContain('---');
  });

  it('falls back to pageId as title when locale has no page entry', () => {
    const noPageLocale: LocaleData = { ...localeData, pages: {} };
    const md = generateMarkdownPage(page, noPageLocale, null, locale);
    expect(md).toContain('# login');
  });

  it('renders a videoless page the same way as a regular page', () => {
    const videolessPage: DocPage = { ...page, videoless: true };
    const md = generateMarkdownPage(videolessPage, localeData, manifest, locale);
    expect(md).toContain('# Logging In');
    expect(md).toContain('1. Enter your email address.');
  });

  it('produces a horizontal rule separator before the step list', () => {
    const md = generateMarkdownPage(page, localeData, manifest, locale);
    expect(md).toContain('---');
  });
});

// ─── generateCorpusLines ──────────────────────────────────────────────────────

describe('generateCorpusLines', () => {
  it('returns one record per non-comment step', () => {
    const records = generateCorpusLines(page, localeData, manifest, locale, version);
    expect(records).toHaveLength(4); // 2 actions + 1 assertion + 1 note
  });

  it('sets correct scalar fields on each record', () => {
    const [first] = generateCorpusLines(page, localeData, manifest, locale, version);
    expect(first.version).toBe('v1.0');
    expect(first.locale).toBe('en-US');
    expect(first.pageId).toBe('login');
    expect(first.pageTitle).toBe('Logging In');
    expect(first.stepId).toBe('enter_email');
    expect(first.stepType).toBe('action');
  });

  it('assigns sequential stepIndex values starting from 0', () => {
    const records = generateCorpusLines(page, localeData, manifest, locale, version);
    expect(records.map((r) => r.stepIndex)).toEqual([0, 1, 2, 3]);
  });

  it('populates durationSeconds from the manifest for voiced steps', () => {
    const records = generateCorpusLines(page, localeData, manifest, locale, version);
    expect(records[0].durationSeconds).toBe(2.5);
    expect(records[1].durationSeconds).toBe(1.8);
  });

  it('sets durationSeconds to null for steps absent from the manifest', () => {
    const records = generateCorpusLines(page, localeData, manifest, locale, version);
    // assertion (index 2) has no manifest entry
    expect(records[2].durationSeconds).toBeNull();
    // note (index 3) has no manifest entry
    expect(records[3].durationSeconds).toBeNull();
  });

  it('sets durationSeconds to null when manifest is null', () => {
    const records = generateCorpusLines(page, localeData, null, locale, version);
    for (const r of records) {
      expect(r.durationSeconds).toBeNull();
    }
  });

  it('includes bounding box anchor for steps that have one', () => {
    const records = generateCorpusLines(page, localeData, manifest, locale, version);
    expect(records[0].anchor).toEqual({ x: 100, y: 200, width: 300, height: 40 });
  });

  it('sets anchor to null for steps without a bounding box', () => {
    const records = generateCorpusLines(page, localeData, manifest, locale, version);
    expect(records[2].anchor).toBeNull(); // assertion
    expect(records[3].anchor).toBeNull(); // note
  });

  it('skips comment steps and does not assign them an index', () => {
    const pageWithComment: DocPage = {
      pageId: 'login',
      steps: [
        { type: 'action', stepId: 'enter_email', textKey: 'enter_email', anchor: null },
        { type: 'comment', stepId: '__comment_1', comment: 'internal note' },
        { type: 'action', stepId: 'click_sign_in', textKey: 'click_sign_in', anchor: null },
      ],
    };
    const records = generateCorpusLines(pageWithComment, localeData, null, locale, version);
    expect(records).toHaveLength(2);
    expect(records[0].stepIndex).toBe(0);
    expect(records[1].stepIndex).toBe(1);
    expect(records.some((r) => r.stepId === '__comment_1')).toBe(false);
  });

  it('uses manifest text as the resolved text when available', () => {
    const records = generateCorpusLines(page, localeData, manifest, locale, version);
    expect(records[0].text).toBe('Enter your email address.');
  });

  it('falls back to locale string when manifest has no entry', () => {
    const records = generateCorpusLines(page, localeData, null, locale, version);
    expect(records[0].text).toBe('Enter your email address.');
  });

  it('falls back to stepId when no locale string exists', () => {
    const minimalLocale: LocaleData = { ...localeData, strings: {} };
    const records = generateCorpusLines(page, minimalLocale, null, locale, version);
    expect(records[0].text).toBe('enter_email');
  });

  it('returns an empty array for a page with only comment steps', () => {
    const commentOnly: DocPage = {
      pageId: 'login',
      steps: [{ type: 'comment', stepId: '__comment_1', comment: 'only a comment' }],
    };
    expect(generateCorpusLines(commentOnly, localeData, null, locale, version)).toEqual([]);
  });

  it('serialises cleanly to JSON (no undefined values)', () => {
    const records = generateCorpusLines(page, localeData, manifest, locale, version);
    for (const r of records) {
      const json = JSON.parse(JSON.stringify(r)) as CorpusRecord;
      expect(json.durationSeconds === null || typeof json.durationSeconds === 'number').toBe(true);
      expect(json.anchor === null || typeof json.anchor === 'object').toBe(true);
    }
  });
});
