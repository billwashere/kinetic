import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

// FIX #9: Hash now includes `speed` so that changing narration speed busts the cache.
// Previously, two profiles differing only in speed produced the same key and returned
// a stale cached file with the old speed.
export function calculateCacheKey(
  text: string,
  profile: { voiceId: string; engineVersion: string; speed: number },
): string {
  const fingerprint = `${text}|${profile.voiceId}|${profile.engineVersion}|${profile.speed}`;
  return crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32);
  // sha256 truncated to 32 hex chars — still effectively collision-free for this use case,
  // and avoids the theoretical (and reputational) issues with MD5.
}

// Content-Addressable Storage (CAS):
// Files are stored at <rootDir>/<hash>.mp3. The hash encodes text + voice profile,
// so re-running with identical inputs is always a no-op.
export class RobustTextStorage {
  constructor(private rootDir: string) {}

  calculateKey(
    text: string,
    profile: { voiceId: string; engineVersion: string; speed: number },
  ): string {
    return calculateCacheKey(text, profile);
  }

  async getPublicUrlIfExists(key: string): Promise<string | null> {
    const filePath = path.join(this.rootDir, `${key}.mp3`);
    return (await fs.pathExists(filePath)) ? `/audio-objects/${key}.mp3` : null;
  }

  async write(key: string, stream: NodeJS.ReadableStream): Promise<string> {
    await fs.ensureDir(this.rootDir);
    const dest = path.join(this.rootDir, `${key}.mp3`);
    await pipeline(stream, createWriteStream(dest));
    return `/audio-objects/${key}.mp3`;
  }
}
