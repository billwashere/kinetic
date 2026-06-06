import { describe, it, expect } from 'vitest';
import { validateLocale, LocaleSchema } from './locale-schema';

const validLocale = {
  locale: 'en-US',
  dir: 'ltr',
  pages: {
    create_project: {
      title: 'Creating a New Project',
      description: 'Learn how to scaffold a project.',
      breadcrumbs: ['Workspace', 'Projects'],
    },
  },
  strings: {
    login_email: 'Enter your email.',
    click_submit: 'Click submit.',
  },
};

describe('LocaleSchema', () => {
  it('accepts a valid locale file', () => {
    expect(() => validateLocale(validLocale, 'en-US.json')).not.toThrow();
  });

  it('rejects a missing dir field', () => {
    const bad = { ...validLocale, dir: undefined };
    expect(() => validateLocale(bad, 'en-US.json')).toThrow('en-US.json');
  });

  it('rejects an invalid dir value', () => {
    const bad = { ...validLocale, dir: 'auto' };
    expect(() => validateLocale(bad, 'en-US.json')).toThrow();
  });

  it('rejects a malformed locale tag', () => {
    const bad = { ...validLocale, locale: 'english' };
    expect(() => validateLocale(bad, 'en-US.json')).toThrow('BCP-47');
  });

  it('rejects an empty page title', () => {
    const bad = {
      ...validLocale,
      pages: { create_project: { ...validLocale.pages.create_project, title: '' } },
    };
    expect(() => validateLocale(bad, 'en-US.json')).toThrow();
  });

  it('rejects an empty string value', () => {
    const bad = { ...validLocale, strings: { login_email: '' } };
    expect(() => validateLocale(bad, 'en-US.json')).toThrow();
  });

  it('rejects a locale file missing the strings key entirely', () => {
    const { strings: _, ...bad } = validLocale;
    expect(() => validateLocale(bad, 'en-US.json')).toThrow();
  });

  it('includes the file path in the error message', () => {
    expect(() => validateLocale({}, 'ar-AE.json')).toThrow('ar-AE.json');
  });
});
