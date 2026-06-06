import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import { execa } from 'execa';
import { RobustTextStorage } from '../lib/storage/robust-text';
import { OpenAIAdapter } from '../lib/tts/openai';
import { KokoroAdapter } from '../lib/tts/kokoro';
import { NullTTSAdapter, type TTSAdapter } from '../lib/tts/adapter';
import { getVoiceProfile } from '../engine/VoiceRegistry';
import { resolvePath } from '../engine/workspace-config';

dotenv.config();

const VERSION = process.env.DOCS_VERSION || 'v1.0';

// Resolve all user-owned directories through workspace config so they can live
// outside the subtree in a git-subtree deployment.
const LOCALES_DIR = resolvePath('locales', path.join(process.cwd(), 'content/locales'));
const PUBLIC_DIR = resolvePath('public', path.join(process.cwd(), 'public'));
const GENERATED_DIR = resolvePath('generated', path.join(process.cwd(), 'generated'));

/**
 * Selects the TTS adapter based on the TTS_ADAPTER env var, with automatic
 * fallback when no API key is present.
 *
 * Priority:
 *   1. TTS_ADAPTER=openai  → OpenAIAdapter (requires OPENAI_API_KEY)
 *   2. TTS_ADAPTER=kokoro  → KokoroAdapter (local, no key needed)
 *   3. TTS_ADAPTER=null    → NullTTSAdapter (silent, for CI/testing)
 *   4. Auto-detect:
 *      - OPENAI_API_KEY set → OpenAIAdapter
 *      - Otherwise          → KokoroAdapter (downloads model on first run)
 */
function selectAdapter(): TTSAdapter {
  const explicit = process.env.TTS_ADAPTER?.toLowerCase();

  if (explicit === 'openai' || (!explicit && process.env.OPENAI_API_KEY)) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('TTS_ADAPTER=openai requires OPENAI_API_KEY to be set.');
    }
    console.log('🔊 TTS adapter: OpenAI');
    return new OpenAIAdapter();
  }

  if (explicit === 'null') {
    console.log('🔇 TTS adapter: Null (silent — no audio generated)');
    return new NullTTSAdapter();
  }

  // Default local adapter — works with no API key.
  // The Kokoro model downloads ~90 MB on first run and caches in ~/.cache/huggingface/
  console.log('🎙️  TTS adapter: Kokoro (local model, no API key required)');
  return new KokoroAdapter();
}

// FIX #3: Measure real MP3 duration via ffprobe instead of hardcoding 3 seconds.
// Accurate durations are required for Remotion to correctly time subtitle display.
async function getMp3DurationSeconds(filePath: string): Promise<number> {
  try {
    const { stdout } = await execa('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 3 : duration;
  } catch {
    console.warn(`⚠️  ffprobe failed for ${filePath}, defaulting to 3s`);
    return 3;
  }
}

// FIX #6: Derive the locale list from the filesystem rather than maintaining
// a hardcoded array in three separate places.
async function getAvailableLocales(): Promise<string[]> {
  const files = await fs.readdir(LOCALES_DIR);
  return files.filter((f) => f.endsWith('.json')).map((f) => path.basename(f, '.json'));
}

async function main() {
  const storage = new RobustTextStorage(path.join(PUBLIC_DIR, 'audio-objects'));
  const tts: TTSAdapter = selectAdapter();

  const skeleton = await fs.readJson(path.join(GENERATED_DIR, VERSION, 'extracted-skeleton.json'));
  const locales = await getAvailableLocales();

  console.log(`🌍 Processing locales: ${locales.join(', ')}`);

  for (const locale of locales) {
    const localeData = await fs.readJson(path.join(LOCALES_DIR, `${locale}.json`));

    // FIX #5: Use the safe accessor — skip locales that don't have a training voice configured.
    const profile = getVoiceProfile(locale, 'training');
    if (!profile) {
      console.warn(`⚠️  No training voice configured for locale "${locale}", skipping.`);
      continue;
    }

    const manifest: Record<
      string,
      { file: string; duration: number; text: string; anchor: unknown }
    > = {};

    for (const page of skeleton) {
      for (const step of page.steps) {
        // Notes are display-only — no audio generated. Comments are already stripped
        // by flushDocs(), but guard defensively in case of manually edited skeletons.
        if (step.type === 'note' || step.type === 'comment') continue;

        const rawText: string | undefined = localeData.strings[step.textKey];
        if (!rawText) {
          console.warn(`⚠️  Missing string key "${step.textKey}" for locale "${locale}"`);
          continue;
        }

        const key = storage.calculateKey(rawText, profile);
        let url = await storage.getPublicUrlIfExists(key);

        if (!url) {
          console.log(`🎙️  Generating TTS [${locale}]: ${step.textKey}`);
          const stream = await tts.getAudioStream({ text: rawText, profile });
          url = await storage.write(key, stream);
        }

        // FIX #3: Measure the real duration from the written file.
        const absolutePath = path.join(PUBLIC_DIR, 'audio-objects', `${key}.mp3`);
        const duration = await getMp3DurationSeconds(absolutePath);

        manifest[`${locale}_${page.pageId}_${step.stepId}`] = {
          file: url,
          duration,
          text: rawText,
          anchor: step.anchor,
        };
      }
    }

    const manifestPath = path.join(PUBLIC_DIR, `audio-manifest-${VERSION}-${locale}.json`);
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });
    console.log(`✅ Wrote ${Object.keys(manifest).length} entries → ${manifestPath}`);
  }
}

main().catch((err) => {
  console.error('❌ pre-render-audio failed:', err);
  process.exit(1);
});
