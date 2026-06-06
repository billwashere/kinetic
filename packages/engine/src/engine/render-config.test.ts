import { describe, it, expect, afterEach } from 'vitest';
import { loadRenderConfig, FPS, WIDTH, HEIGHT } from './render-config';

// Restore env vars after each test
const originalEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!originalEnv[key]) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ─── Shared constants ─────────────────────────────────────────────────────────

describe('shared constants', () => {
  it('FPS is 30', () => expect(FPS).toBe(30));
  it('WIDTH is 1920', () => expect(WIDTH).toBe(1920));
  it('HEIGHT is 1080', () => expect(HEIGHT).toBe(1080));
});

// ─── Defaults ─────────────────────────────────────────────────────────────────

describe('loadRenderConfig — defaults', () => {
  it('applies sensible defaults when no env vars are set', () => {
    setEnv({
      RENDER_CODEC: undefined,
      RENDER_CRF: undefined,
      RENDER_PRESET: undefined,
      RENDER_CONCURRENCY: undefined,
      RENDER_LEAD_IN_SECONDS: undefined,
      RENDER_LEAD_OUT_SECONDS: undefined,
    });

    const config = loadRenderConfig();

    expect(config.codec).toBe('h264');
    expect(config.crf).toBe(18);
    expect(config.x264Preset).toBe('medium');
    expect(config.concurrency).toBeGreaterThanOrEqual(1);
    expect(config.leadInSeconds).toBe(1.0);
    expect(config.leadOutSeconds).toBe(2.0);
  });
});

// ─── Valid values ─────────────────────────────────────────────────────────────

describe('loadRenderConfig — valid env vars', () => {
  it('accepts h265 codec', () => {
    setEnv({ RENDER_CODEC: 'h265' });
    expect(loadRenderConfig().codec).toBe('h265');
  });

  it('accepts vp9 codec', () => {
    setEnv({ RENDER_CODEC: 'vp9' });
    expect(loadRenderConfig().codec).toBe('vp9');
  });

  it('parses RENDER_CRF as an integer', () => {
    setEnv({ RENDER_CRF: '23' });
    expect(loadRenderConfig().crf).toBe(23);
  });

  it('accepts CRF of 0 (lossless boundary)', () => {
    setEnv({ RENDER_CRF: '0' });
    expect(loadRenderConfig().crf).toBe(0);
  });

  it('accepts CRF of 63 (vp9 max)', () => {
    setEnv({ RENDER_CRF: '63' });
    expect(loadRenderConfig().crf).toBe(63);
  });

  it('accepts ultrafast preset', () => {
    setEnv({ RENDER_PRESET: 'ultrafast' });
    expect(loadRenderConfig().x264Preset).toBe('ultrafast');
  });

  it('accepts veryslow preset', () => {
    setEnv({ RENDER_PRESET: 'veryslow' });
    expect(loadRenderConfig().x264Preset).toBe('veryslow');
  });

  it('parses RENDER_CONCURRENCY as an integer', () => {
    setEnv({ RENDER_CONCURRENCY: '8' });
    expect(loadRenderConfig().concurrency).toBe(8);
  });

  it('parses RENDER_LEAD_IN_SECONDS as a float', () => {
    setEnv({ RENDER_LEAD_IN_SECONDS: '0.5' });
    expect(loadRenderConfig().leadInSeconds).toBe(0.5);
  });

  it('accepts 0 lead-in (no silence before first step)', () => {
    setEnv({ RENDER_LEAD_IN_SECONDS: '0' });
    expect(loadRenderConfig().leadInSeconds).toBe(0);
  });
});

// ─── Validation errors ────────────────────────────────────────────────────────

describe('loadRenderConfig — invalid values', () => {
  it('throws for an unknown codec', () => {
    setEnv({ RENDER_CODEC: 'av1' });
    expect(() => loadRenderConfig()).toThrow();
  });

  it('throws for CRF above 63', () => {
    setEnv({ RENDER_CRF: '64' });
    expect(() => loadRenderConfig()).toThrow();
  });

  it('throws for negative CRF', () => {
    setEnv({ RENDER_CRF: '-1' });
    expect(() => loadRenderConfig()).toThrow();
  });

  it('throws for a non-numeric CRF', () => {
    setEnv({ RENDER_CRF: 'high' });
    expect(() => loadRenderConfig()).toThrow();
  });

  it('throws for an unknown preset', () => {
    setEnv({ RENDER_PRESET: 'fastest' }); // not a real preset name
    expect(() => loadRenderConfig()).toThrow();
  });

  it('throws for concurrency below 1', () => {
    setEnv({ RENDER_CONCURRENCY: '0' });
    expect(() => loadRenderConfig()).toThrow();
  });

  it('throws for negative lead-in', () => {
    setEnv({ RENDER_LEAD_IN_SECONDS: '-1' });
    expect(() => loadRenderConfig()).toThrow();
  });

  it('includes the invalid field name in the error message', () => {
    setEnv({ RENDER_CODEC: 'bad-codec' });
    expect(() => loadRenderConfig()).toThrow(/codec/);
  });
});
