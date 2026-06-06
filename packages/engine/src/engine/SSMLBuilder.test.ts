import { describe, it, expect } from 'vitest';
import { SSMLBuilder } from './SSMLBuilder';

describe('SSMLBuilder', () => {
  // #11 (partial) — existing chain test kept
  it('chains text, pause, and emphasize correctly', () => {
    const ssml = new SSMLBuilder().text('Wait.').pause(500).emphasize('Now').build();
    expect(ssml).toBe('<speak>Wait. <break time="500ms"/> <emphasis>Now</emphasis></speak>');
  });

  // #12 — empty builder
  it('build() on an empty builder produces a valid empty speak element', () => {
    expect(new SSMLBuilder().build()).toBe('<speak></speak>');
  });

  it('supports multiple text segments separated by spaces', () => {
    const ssml = new SSMLBuilder().text('Hello').text('world').build();
    expect(ssml).toBe('<speak>Hello world</speak>');
  });

  it('supports multiple pauses', () => {
    const ssml = new SSMLBuilder().pause(100).pause(200).build();
    expect(ssml).toBe('<speak><break time="100ms"/> <break time="200ms"/></speak>');
  });

  it('is chainable in any order', () => {
    const ssml = new SSMLBuilder().emphasize('First').pause(300).text('then continue').build();
    expect(ssml).toContain('<emphasis>First</emphasis>');
    expect(ssml).toContain('<break time="300ms"/>');
    expect(ssml).toContain('then continue');
    expect(ssml).toMatch(/^<speak>.*<\/speak>$/);
  });
});
