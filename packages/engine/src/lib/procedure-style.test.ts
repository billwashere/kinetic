import { describe, it, expect } from 'vitest';
import { lintProcedures, MAX_STEPS, type StylePage } from './procedure-style';

const page = (steps: [string, string][]): StylePage => ({
  pageId: 'p',
  steps: steps.map(([type, key], i) => ({ type, stepId: `s${i}`, textKey: key })),
});
const codes = (pages: StylePage[], strings: Record<string, string>, extra: object = {}) =>
  lintProcedures(pages, [
    { locale: 'en-US', pages: { p: { done: 'Done.', ...extra } }, strings },
  ]).map((f) => f.code);

describe('lintProcedures', () => {
  it('passes Microsoft-style steps', () => {
    expect(
      codes(
        [
          page([
            ['action', 'a'],
            ['assertion', 'b'],
          ]),
        ],
        { a: 'Select **Submit**.', b: 'A success message appears.' },
      ),
    ).toEqual([]);
  });

  it('flags click, navigate to, please, sequence words, non-imperative openings and missing periods', () => {
    const c = codes(
      [
        page([
          ['action', 'a'],
          ['action', 'b'],
          ['action', 'c'],
          ['action', 'd'],
        ]),
      ],
      {
        a: 'First, click **Submit**.',
        b: 'Please navigate to the dashboard.',
        c: 'You enter a name',
        d: 'Enter details, e.g. a name.',
      },
    );
    expect(c).toEqual(
      expect.arrayContaining([
        'use-select',
        'no-sequence-word',
        'use-go-to',
        'no-please',
        'imperative',
        'end-punctuation',
        'no-latin',
      ]),
    );
  });

  it('asks for results to be stated, not looked for', () => {
    expect(codes([page([['assertion', 'a']])], { a: 'Notice the success message.' })).toContain(
      'result-as-statement',
    );
  });

  it('flags long procedures and a missing result statement', () => {
    const many = page(
      Array.from({ length: MAX_STEPS + 1 }, (_, i) => ['action', `k${i}`] as [string, string]),
    );
    const strings = Object.fromEntries(
      Array.from({ length: MAX_STEPS + 1 }, (_, i) => [`k${i}`, 'Select it.']),
    );
    expect(codes([many], strings)).toContain('too-many-steps');
    const r = lintProcedures(
      [page([['action', 'a']])],
      [{ locale: 'en-US', pages: {}, strings: { a: 'Select it.' } }],
    );
    expect(r.map((f) => f.code)).toEqual(['state-result']);
  });

  it('only checks English locales and ignores comments and notes for action-only rules', () => {
    const r = lintProcedures(
      [page([['action', 'a']])],
      [{ locale: 'ar-AE', pages: {}, strings: { a: 'click' } }],
    );
    expect(r).toEqual([]);
    expect(codes([page([['note', 'a']])], { a: 'Click is fine in a note about history' })).toEqual(
      [],
    );
  });
});
