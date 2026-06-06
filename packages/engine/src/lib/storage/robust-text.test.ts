import { describe, it, expect } from 'vitest';
import { RobustTextStorage, calculateCacheKey } from './robust-text';

const baseProfile = { voiceId: 'alloy', engineVersion: 'tts-1', speed: 1.0 };

describe('calculateCacheKey', () => {
  it('is deterministic for identical inputs', () => {
    expect(calculateCacheKey('Hello', baseProfile)).toBe(calculateCacheKey('Hello', baseProfile));
  });

  it('changes when engineVersion changes (cache invalidation)', () => {
    const v2 = { ...baseProfile, engineVersion: 'tts-2' };
    expect(calculateCacheKey('Hello', baseProfile)).not.toBe(calculateCacheKey('Hello', v2));
  });

  it('changes when text changes', () => {
    expect(calculateCacheKey('Hello', baseProfile)).not.toBe(
      calculateCacheKey('World', baseProfile),
    );
  });

  // FIX #9: speed is now part of the key — this test was missing before.
  it('changes when speed changes (previously broken — same key returned stale audio)', () => {
    const faster = { ...baseProfile, speed: 1.25 };
    expect(calculateCacheKey('Hello', baseProfile)).not.toBe(calculateCacheKey('Hello', faster));
  });

  it('changes when voiceId changes', () => {
    const nova = { ...baseProfile, voiceId: 'nova' };
    expect(calculateCacheKey('Hello', baseProfile)).not.toBe(calculateCacheKey('Hello', nova));
  });

  it('produces a 32-char hex string', () => {
    const key = calculateCacheKey('Hello', baseProfile);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('RobustTextStorage.calculateKey', () => {
  it('delegates to calculateCacheKey correctly', () => {
    const storage = new RobustTextStorage('/tmp/audio');
    expect(storage.calculateKey('Hello', baseProfile)).toBe(
      calculateCacheKey('Hello', baseProfile),
    );
  });
});

// #13 — write/read roundtrip was entirely untested before
describe('RobustTextStorage — write and cache lookup', () => {
  it('returns null for a key that has not been written yet', async () => {
    const storage = new RobustTextStorage('/tmp/kinetic-test-missing');
    const key = calculateCacheKey('never written', baseProfile);
    expect(await storage.getPublicUrlIfExists(key)).toBeNull();
  });

  it('write() persists the stream and returns the public URL', async () => {
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs-extra');
    const { Readable } = await import('stream');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-storage-'));
    const storage = new RobustTextStorage(tmpDir);
    const key = calculateCacheKey('roundtrip test', baseProfile);

    const payload = Buffer.from('fake-mp3-bytes');
    const stream = Readable.from([payload]);

    const url = await storage.write(key, stream);

    expect(url).toBe(`/audio-objects/${key}.mp3`);

    // File should exist on disk with the correct content
    const writtenPath = path.join(tmpDir, `${key}.mp3`);
    expect(await fs.pathExists(writtenPath)).toBe(true);
    const contents = await fs.readFile(writtenPath);
    expect(contents).toEqual(payload);

    await fs.remove(tmpDir);
  });

  it('getPublicUrlIfExists() returns the URL after a successful write', async () => {
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs-extra');
    const { Readable } = await import('stream');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-storage-'));
    const storage = new RobustTextStorage(tmpDir);
    const key = calculateCacheKey('cache hit test', baseProfile);

    await storage.write(key, Readable.from([Buffer.from('data')]));
    const url = await storage.getPublicUrlIfExists(key);

    expect(url).toBe(`/audio-objects/${key}.mp3`);

    await fs.remove(tmpDir);
  });

  it('write() creates the root directory if it does not exist', async () => {
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs-extra');
    const { Readable } = await import('stream');

    const tmpDir = path.join(os.tmpdir(), `kinetic-new-dir-${Date.now()}`);
    // Confirm it doesn't exist yet
    expect(await fs.pathExists(tmpDir)).toBe(false);

    const storage = new RobustTextStorage(tmpDir);
    const key = calculateCacheKey('dir creation test', baseProfile);
    await storage.write(key, Readable.from([Buffer.from('x')]));

    expect(await fs.pathExists(tmpDir)).toBe(true);

    await fs.remove(tmpDir);
  });
});
