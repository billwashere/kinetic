export type Tone = 'training' | 'marketing';

export interface VoiceProfile {
  voiceId: string;
  engineVersion: string;
  speed: number;
  pitch: string;
}

// FIX #5: Use Partial<Record<Tone, VoiceProfile>> for per-locale entries so TypeScript
// correctly models that some locales (e.g. ar-AE) don't define every tone.
// Callers must now handle the undefined case explicitly rather than crashing at runtime.
export type LocaleVoiceMap = Partial<Record<Tone, VoiceProfile>>;

export const VOICE_REGISTRY: Record<string, LocaleVoiceMap> = {
  'en-US': {
    training: { voiceId: 'alloy', engineVersion: 'tts-1', speed: 1.0, pitch: '0' },
    marketing: { voiceId: 'nova', engineVersion: 'tts-1', speed: 1.1, pitch: '0' },
  },
  'ar-AE': {
    training: { voiceId: 'onyx', engineVersion: 'tts-1', speed: 1.0, pitch: '0' },
    // marketing intentionally omitted — no approved voice for this locale yet
  },
};

// Safe accessor: returns undefined when the tone isn't configured for a locale,
// letting callers decide whether to skip, fallback, or throw.
export function getVoiceProfile(locale: string, tone: Tone): VoiceProfile | undefined {
  return VOICE_REGISTRY[locale]?.[tone];
}
