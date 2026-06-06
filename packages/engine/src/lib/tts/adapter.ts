import { Readable } from 'stream';

export interface TTSRequest {
  text: string;
  profile: {
    voiceId: string;
    engineVersion: string;
    speed: number;
  };
}

// FIX #8: Shared interface makes the adapter genuinely swappable (OpenAI, ElevenLabs, Azure, etc.)
// and eliminates the inline require() stub that would break under ESM.
export interface TTSAdapter {
  getAudioStream(req: TTSRequest): Promise<Readable>;
}

// NullTTSAdapter: returns a minimal valid MP3 frame (silence).
// Used when OPENAI_API_KEY is absent so the pipeline can complete end-to-end without API calls.
export class NullTTSAdapter implements TTSAdapter {
  async getAudioStream(_req: TTSRequest): Promise<Readable> {
    // Minimal valid MP3: ID3v2 header + one silent MPEG frame
    // This is enough for ffprobe to detect a real duration rather than erroring.
    const silentMp3 = Buffer.from([
      0x49,
      0x44,
      0x33,
      0x03,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // ID3v2 header
      0xff,
      0xfb,
      0x90,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // MPEG frame header
      ...new Array(413).fill(0), // silent frame body
    ]);
    return Readable.from([silentMp3]);
  }
}
