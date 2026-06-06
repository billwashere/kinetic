import { describe, it, expect } from 'vitest';
import { LayerConfigSchema, DEFAULT_SUBTITLE_STYLE } from './layer-config';

describe('LayerConfigSchema — defaults', () => {
  it('parses an empty object with all defaults applied', () => {
    const config = LayerConfigSchema.parse({});
    expect(config.music).toBeUndefined();
    expect(config.watermark).toBeUndefined();
    expect(config.subtitleStyle.fontSize).toBe(32);
    expect(config.subtitleStyle.position).toBe('bottom');
    expect(config.subtitleStyle.backgroundColor).toBe('rgba(0,0,0,0.8)');
    expect(config.subtitleStyle.fadeFrames).toBe(5);
  });

  it('DEFAULT_SUBTITLE_STYLE matches schema defaults', () => {
    const fromSchema = LayerConfigSchema.parse({}).subtitleStyle;
    expect(DEFAULT_SUBTITLE_STYLE).toEqual(fromSchema);
  });
});

describe('LayerConfigSchema — music', () => {
  const validMusic = { src: '/assets/bg.mp3' };

  it('accepts a minimal music config (src only)', () => {
    const config = LayerConfigSchema.parse({ music: validMusic });
    expect(config.music?.src).toBe('/assets/bg.mp3');
    expect(config.music?.volume).toBe(0.15);
    expect(config.music?.loop).toBe(true);
    expect(config.music?.fadeInFrames).toBe(30);
    expect(config.music?.fadeOutFrames).toBe(60);
  });

  it('accepts a fully specified music config', () => {
    const config = LayerConfigSchema.parse({
      music: {
        src: '/assets/bg.mp3',
        volume: 0.3,
        fadeInFrames: 15,
        fadeOutFrames: 30,
        loop: false,
      },
    });
    expect(config.music?.volume).toBe(0.3);
    expect(config.music?.loop).toBe(false);
  });

  it('rejects volume above 1', () => {
    expect(() => LayerConfigSchema.parse({ music: { src: '/a.mp3', volume: 1.5 } })).toThrow();
  });

  it('rejects volume below 0', () => {
    expect(() => LayerConfigSchema.parse({ music: { src: '/a.mp3', volume: -0.1 } })).toThrow();
  });

  it('rejects negative fadeInFrames', () => {
    expect(() => LayerConfigSchema.parse({ music: { src: '/a.mp3', fadeInFrames: -1 } })).toThrow();
  });

  it('rejects an empty src', () => {
    expect(() => LayerConfigSchema.parse({ music: { src: '' } })).toThrow();
  });
});

describe('LayerConfigSchema — watermark', () => {
  const validWatermark = { src: '/assets/logo.png' };

  it('accepts a minimal watermark config', () => {
    const config = LayerConfigSchema.parse({ watermark: validWatermark });
    expect(config.watermark?.position).toBe('bottom-right');
    expect(config.watermark?.opacity).toBe(0.7);
    expect(config.watermark?.widthPx).toBe(180);
    expect(config.watermark?.marginPx).toBe(24);
  });

  it('accepts all four corner positions', () => {
    for (const pos of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const config = LayerConfigSchema.parse({ watermark: { src: '/logo.png', position: pos } });
      expect(config.watermark?.position).toBe(pos);
    }
  });

  it('rejects an invalid position', () => {
    expect(() =>
      LayerConfigSchema.parse({ watermark: { src: '/logo.png', position: 'center' } }),
    ).toThrow();
  });

  it('rejects opacity above 1', () => {
    expect(() =>
      LayerConfigSchema.parse({ watermark: { src: '/logo.png', opacity: 2 } }),
    ).toThrow();
  });

  it('rejects widthPx of 0', () => {
    expect(() =>
      LayerConfigSchema.parse({ watermark: { src: '/logo.png', widthPx: 0 } }),
    ).toThrow();
  });
});

describe('LayerConfigSchema — intro', () => {
  it('accepts a minimal intro config', () => {
    const config = LayerConfigSchema.parse({ intro: {} });
    expect(config.intro?.durationSeconds).toBe(4);
    expect(config.intro?.backgroundColor).toBe('#0f172a');
    expect(config.intro?.accentColor).toBe('#3b82f6');
    expect(config.intro?.showBreadcrumbs).toBe(true);
  });

  it('accepts a fully specified intro', () => {
    const config = LayerConfigSchema.parse({
      intro: {
        durationSeconds: 6,
        backgroundColor: '#fff',
        accentColor: '#f00',
        textColor: '#000',
        showBreadcrumbs: false,
      },
    });
    expect(config.intro?.durationSeconds).toBe(6);
    expect(config.intro?.showBreadcrumbs).toBe(false);
  });

  it('rejects durationSeconds below 1', () => {
    expect(() => LayerConfigSchema.parse({ intro: { durationSeconds: 0 } })).toThrow();
  });

  it('rejects durationSeconds above 30', () => {
    expect(() => LayerConfigSchema.parse({ intro: { durationSeconds: 31 } })).toThrow();
  });

  it('intro absent means no intro — pipeline writes content directly to final path', () => {
    const config = LayerConfigSchema.parse({});
    expect(config.intro).toBeUndefined();
  });
});

describe('LayerConfigSchema — outro', () => {
  it('accepts a minimal outro config', () => {
    const config = LayerConfigSchema.parse({ outro: {} });
    expect(config.outro?.durationSeconds).toBe(3);
    expect(config.outro?.backgroundColor).toBe('#0f172a');
    expect(config.outro?.ctaText).toBeUndefined();
  });

  it('accepts an outro with CTA text', () => {
    const config = LayerConfigSchema.parse({ outro: { ctaText: 'docs.co' } });
    expect(config.outro?.ctaText).toBe('docs.co');
  });

  it('rejects durationSeconds above 30', () => {
    expect(() => LayerConfigSchema.parse({ outro: { durationSeconds: 99 } })).toThrow();
  });

  it('outro absent means no outro', () => {
    const config = LayerConfigSchema.parse({});
    expect(config.outro).toBeUndefined();
  });
});

describe('LayerConfigSchema — subtitleStyle', () => {
  it('accepts a partial subtitle style override', () => {
    const config = LayerConfigSchema.parse({ subtitleStyle: { fontSize: 48, position: 'top' } });
    expect(config.subtitleStyle.fontSize).toBe(48);
    expect(config.subtitleStyle.position).toBe('top');
    // Other values remain at defaults
    expect(config.subtitleStyle.textColor).toBe('#ffffff');
  });

  it('rejects fontSize below 8', () => {
    expect(() => LayerConfigSchema.parse({ subtitleStyle: { fontSize: 4 } })).toThrow();
  });

  it('rejects maxWidthPct above 100', () => {
    expect(() => LayerConfigSchema.parse({ subtitleStyle: { maxWidthPct: 101 } })).toThrow();
  });

  it('rejects maxWidthPct below 10', () => {
    expect(() => LayerConfigSchema.parse({ subtitleStyle: { maxWidthPct: 5 } })).toThrow();
  });

  it('rejects invalid position value', () => {
    expect(() => LayerConfigSchema.parse({ subtitleStyle: { position: 'middle' } })).toThrow();
  });
});
