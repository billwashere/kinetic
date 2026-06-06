import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import type { Readable } from 'stream';
import type { TTSAdapter, TTSRequest } from './adapter';

/**
 * Maps OpenAI voice IDs (the convention used in VoiceRegistry) to the nearest
 * Kokoro equivalent. The VoiceRegistry describes intent ("training voice for
 * en-US") — the adapter resolves the actual voice to use.
 *
 * Kokoro voice naming convention:
 *   af_ = American Female   bf_ = British Female
 *   am_ = American Male     bm_ = British Male
 *
 * Full list: import { KokoroTTS } from 'kokoro-js'; tts.list_voices()
 */
const VOICE_MAP: Record<string, string> = {
  alloy: 'af_heart', // American Female — warm, clear, good for training content
  nova: 'af_sky', // American Female — brighter timbre, good for marketing
  onyx: 'bm_george', // British Male — deep, authoritative
  echo: 'am_adam', // American Male
  fable: 'bf_emma', // British Female
  shimmer: 'af_heart', // fallback to af_heart
};

const DEFAULT_KOKORO_VOICE = 'af_heart';

/**
 * KokoroAdapter — runs Kokoro-82M locally via ONNX, no API key or network
 * connection required after the initial model download.
 *
 * Model: onnx-community/Kokoro-82M-v1.0-ONNX
 * Size:  ~90 MB (q8 quantised) cached in ~/.cache/huggingface/hub/
 * Speed: sub-0.3s per sentence on CPU
 *
 * FIRST RUN: the model weights download automatically from Hugging Face.
 * Subsequent runs use the local cache — no network needed.
 *
 * OUTPUT: Kokoro generates WAV audio. This adapter converts to MP3 via
 * ffmpeg (already required by the pipeline) so the output matches the
 * contract of all other TTSAdapters.
 *
 * USAGE IN .env:
 *   TTS_ADAPTER=kokoro
 */
export class KokoroAdapter implements TTSAdapter {
  // The model is loaded lazily and cached for the lifetime of the process.
  // Loading takes ~2–5s on first call; subsequent calls are instant.
  private tts: unknown = null;

  constructor(
    private readonly modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX',
    private readonly dtype: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16' = 'q8',
  ) {}

  private async ensureModel(): Promise<{
    generate: (
      text: string,
      opts: { voice: string },
    ) => Promise<{ save: (p: string) => Promise<void> }>;
  }> {
    if (!this.tts) {
      // Dynamic import keeps kokoro-js out of the require graph for adapters
      // that don't use it, so the OpenAI/Null adapters load instantly.
      const { KokoroTTS } = await import('kokoro-js');

      console.log(`📥 Loading Kokoro model (${this.dtype}) — first run downloads ~90 MB...`);
      this.tts = await KokoroTTS.from_pretrained(this.modelId, {
        dtype: this.dtype,
        device: 'cpu', // use 'webgpu' in browser contexts with WebGPU support
      });
      console.log('✅ Kokoro model ready');
    }
    return this.tts as Awaited<ReturnType<typeof this.ensureModel>>;
  }

  async getAudioStream(req: TTSRequest): Promise<Readable> {
    const tts = await this.ensureModel();

    // Resolve Kokoro voice from the OpenAI voice ID stored in VoiceRegistry.
    // Falls back to af_heart if the voice ID isn't mapped.
    const voice = VOICE_MAP[req.profile.voiceId] ?? DEFAULT_KOKORO_VOICE;

    // Strip SSML tags and Markdown syntax — Kokoro expects plain text.
    const plainText = req.text.replace(/<[^>]*>?/gm, '').replace(/[*_~`]/g, '');

    // Generate WAV audio from the model.
    const audio = await tts.generate(plainText, { voice });

    // Kokoro outputs WAV. Write to a temp file so ffmpeg can read it.
    // We use a unique filename to make parallel pipeline runs safe.
    const tmpWav = path.join(
      os.tmpdir(),
      `kinetic-kokoro-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
    );
    await audio.save(tmpWav);

    // Convert WAV → MP3 via ffmpeg, piping stdout so callers get a stream
    // with the same contract as OpenAIAdapter (MP3 Readable).
    //
    // -ar 22050  Down-samples to 22 kHz — sufficient for voice, halves file size vs 44.1 kHz
    // -b:a 96k   96 kbps is transparent for speech (OpenAI uses 128k, difference is inaudible)
    // pipe:1     Writes MP3 directly to stdout instead of a file
    const ffmpeg = spawn(
      'ffmpeg',
      ['-i', tmpWav, '-f', 'mp3', '-ar', '22050', '-b:a', '96k', '-y', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    // Clean up the temp WAV once ffmpeg has finished reading it.
    ffmpeg.on('close', () => {
      fs.remove(tmpWav).catch(() => {});
    });

    return ffmpeg.stdout as Readable;
  }
}
