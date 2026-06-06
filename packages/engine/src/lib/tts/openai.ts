import OpenAI from 'openai';
import { Readable } from 'stream';
import type { TTSAdapter, TTSRequest } from './adapter';

export class OpenAIAdapter implements TTSAdapter {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined, // supports enterprise proxies
    });
  }

  async getAudioStream(req: TTSRequest): Promise<Readable> {
    // OpenAI TTS doesn't support SSML, so strip XML tags and Markdown syntax before sending.
    const cleanText = req.text.replace(/<[^>]*>?/gm, '').replace(/[*_~`]/g, '');

    const response = await this.client.audio.speech.create({
      model: req.profile.engineVersion,
      voice: req.profile.voiceId as Parameters<typeof this.client.audio.speech.create>[0]['voice'],
      input: cleanText,
      speed: req.profile.speed,
      response_format: 'mp3',
    });

    return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  }
}
