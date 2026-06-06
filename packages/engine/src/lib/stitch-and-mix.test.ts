import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  resolvePublicPath,
  buildMusicFilterComplex,
  computeIntroHash,
  computeOutroHash,
  isCacheValid,
  writeHashFile,
} from './stitch-and-mix';
import os from 'os';
import fs from 'fs-extra';

// ─── resolvePublicPath ────────────────────────────────────────────────────────

describe('resolvePublicPath', () => {
  const publicDir = '/project/packages/engine/public';

  it('strips the leading slash and joins with publicDir', () => {
    expect(resolvePublicPath('/assets/bg.mp3', publicDir)).toBe(
      '/project/packages/engine/public/assets/bg.mp3',
    );
  });

  it('handles paths without a leading slash', () => {
    expect(resolvePublicPath('assets/logo.png', publicDir)).toBe(
      '/project/packages/engine/public/assets/logo.png',
    );
  });

  it('works for nested asset paths', () => {
    expect(resolvePublicPath('/music/ambient/chill.mp3', publicDir)).toBe(
      '/project/packages/engine/public/music/ambient/chill.mp3',
    );
  });
});

// ─── buildMusicFilterComplex ──────────────────────────────────────────────────

describe('buildMusicFilterComplex', () => {
  it('produces a valid FFmpeg filter_complex string', () => {
    const filter = buildMusicFilterComplex(0.15, 1.0, 8.0, 2.0);
    expect(filter).toBe('[1:a]volume=0.150,afade=t=in:d=1.000,afade=t=out:st=8.000:d=2.000[a]');
  });

  it('labels the output stream [a]', () => {
    const filter = buildMusicFilterComplex(0.2, 1, 5, 2);
    expect(filter).toMatch(/\[a\]$/);
  });

  it('includes the volume value', () => {
    const filter = buildMusicFilterComplex(0.3, 1, 5, 2);
    expect(filter).toContain('volume=0.300');
  });

  it('formats seconds to 3 decimal places for FFmpeg precision', () => {
    const filter = buildMusicFilterComplex(0.15, 1.333, 8.666, 2.0);
    expect(filter).toContain('d=1.333');
    expect(filter).toContain('st=8.666');
  });
});

// ─── computeIntroHash ────────────────────────────────────────────────────────

describe('computeIntroHash', () => {
  const baseConfig = {
    intro: {
      durationSeconds: 4,
      backgroundColor: '#0f172a',
      accentColor: '#3b82f6',
      textColor: '#fff',
      showBreadcrumbs: true,
    },
    watermark: undefined,
  };

  it('is deterministic for identical inputs', () => {
    const h1 = computeIntroHash('en-US', 'checkout', 'Checkout', ['Shop', 'Cart'], baseConfig);
    const h2 = computeIntroHash('en-US', 'checkout', 'Checkout', ['Shop', 'Cart'], baseConfig);
    expect(h1).toBe(h2);
  });

  it('changes when the page title changes', () => {
    const h1 = computeIntroHash('en-US', 'checkout', 'Checkout', [], baseConfig);
    const h2 = computeIntroHash('en-US', 'checkout', 'Payment', [], baseConfig);
    expect(h1).not.toBe(h2);
  });

  it('changes when the locale changes', () => {
    const h1 = computeIntroHash('en-US', 'p', 'Title', [], baseConfig);
    const h2 = computeIntroHash('ar-AE', 'p', 'Title', [], baseConfig);
    expect(h1).not.toBe(h2);
  });

  it('changes when breadcrumbs change', () => {
    const h1 = computeIntroHash('en-US', 'p', 'T', ['A', 'B'], baseConfig);
    const h2 = computeIntroHash('en-US', 'p', 'T', ['A', 'C'], baseConfig);
    expect(h1).not.toBe(h2);
  });

  it('changes when accent color changes', () => {
    const h1 = computeIntroHash('en-US', 'p', 'T', [], {
      ...baseConfig,
      intro: { ...baseConfig.intro!, accentColor: '#blue' },
    });
    const h2 = computeIntroHash('en-US', 'p', 'T', [], {
      ...baseConfig,
      intro: { ...baseConfig.intro!, accentColor: '#red' },
    });
    expect(h1).not.toBe(h2);
  });

  it('produces a 16-character hex string', () => {
    const h = computeIntroHash('en-US', 'p', 'T', [], baseConfig);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ─── computeOutroHash ────────────────────────────────────────────────────────

describe('computeOutroHash', () => {
  const baseConfig = {
    outro: {
      durationSeconds: 3,
      backgroundColor: '#0f172a',
      textColor: '#fff',
      ctaText: 'docs.co',
    },
    watermark: undefined,
  };

  it('is deterministic', () => {
    expect(computeOutroHash('en-US', baseConfig)).toBe(computeOutroHash('en-US', baseConfig));
  });

  it('changes when locale changes (locale may affect font or direction)', () => {
    expect(computeOutroHash('en-US', baseConfig)).not.toBe(computeOutroHash('ar-AE', baseConfig));
  });

  it('changes when CTA text changes', () => {
    const h1 = computeOutroHash('en-US', {
      ...baseConfig,
      outro: { ...baseConfig.outro!, ctaText: 'a.com' },
    });
    const h2 = computeOutroHash('en-US', {
      ...baseConfig,
      outro: { ...baseConfig.outro!, ctaText: 'b.com' },
    });
    expect(h1).not.toBe(h2);
  });
});

// ─── isCacheValid / writeHashFile ─────────────────────────────────────────────

describe('isCacheValid and writeHashFile', () => {
  it('returns false when neither file nor hash file exist', async () => {
    expect(await isCacheValid('/tmp/does-not-exist.mp4', 'abc123')).toBe(false);
  });

  it('returns true after writing the video and hash files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-cache-'));
    const videoFile = path.join(tmpDir, 'intro.mp4');
    const hash = 'abc123def456';

    await fs.writeFile(videoFile, 'fake-mp4-data');
    await writeHashFile(videoFile, hash);

    expect(await isCacheValid(videoFile, hash)).toBe(true);

    await fs.remove(tmpDir);
  });

  it('returns false when the hash does not match', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-cache-'));
    const videoFile = path.join(tmpDir, 'intro.mp4');

    await fs.writeFile(videoFile, 'fake-mp4-data');
    await writeHashFile(videoFile, 'old-hash');

    expect(await isCacheValid(videoFile, 'new-hash')).toBe(false);

    await fs.remove(tmpDir);
  });

  it('returns false when the video exists but hash file is missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-cache-'));
    const videoFile = path.join(tmpDir, 'intro.mp4');
    await fs.writeFile(videoFile, 'fake');

    expect(await isCacheValid(videoFile, 'any-hash')).toBe(false);

    await fs.remove(tmpDir);
  });
});
