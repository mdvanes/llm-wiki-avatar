import type { Config, Language, VoiceGender } from './config.ts';
import type { SpeachesVoice } from './speachesTts.ts';

export interface LanguageProfile {
  code: Language;
  /** Language name as used in instructions to the LLM. */
  name: string;
  /** ISO code passed to Whisper. */
  whisperLanguage: string;
  /** TTS voice per gender. */
  voices: Record<VoiceGender, SpeachesVoice>;
  /** Female voice with word timings for the premium avatar's lip-sync; absent where not supported. */
  wordTimedVoice?: SpeachesVoice;
  greeting: string;
  switched: string;
}

/** The only voice with word timings: Kokoro `af_heart` on Kokoro-FastAPI. */
export const WORD_TIMED_VOICE = { model: 'kokoro', voice: 'af_heart' } as const;

export function languageProfiles(cfg: Config): Record<Language, LanguageProfile> {
  const enFemale: SpeachesVoice = {
    baseURL: cfg.TTS_EN_BASE_URL ?? cfg.SPEACHES_URL,
    model: cfg.TTS_EN_MODEL,
    voice: cfg.TTS_EN_VOICE,
  };
  return {
    en: {
      code: 'en',
      name: 'English',
      whisperLanguage: 'en',
      voices: {
        female: enFemale,
        male: {
          baseURL: cfg.TTS_EN_MALE_BASE_URL ?? cfg.SPEACHES_URL,
          model: cfg.TTS_EN_MALE_MODEL,
          voice: cfg.TTS_EN_MALE_VOICE,
        },
      },
      ...(cfg.KOKORO_URL
        ? { wordTimedVoice: { baseURL: cfg.KOKORO_URL, ...WORD_TIMED_VOICE, wordTimings: true, fallback: enFemale } }
        : {}),
      greeting: 'Hi! Ask me anything about the wiki.',
      switched: "Okay, I'll speak English from now on.",
    },
    nl: {
      code: 'nl',
      name: 'Dutch',
      whisperLanguage: 'nl',
      voices: {
        female: {
          baseURL: cfg.TTS_NL_BASE_URL ?? cfg.SPEACHES_URL,
          model: cfg.TTS_NL_MODEL,
          voice: cfg.TTS_NL_VOICE,
        },
        male: {
          baseURL: cfg.TTS_NL_MALE_BASE_URL ?? cfg.SPEACHES_URL,
          model: cfg.TTS_NL_MALE_MODEL,
          voice: cfg.TTS_NL_MALE_VOICE,
        },
      },
      greeting: 'Hoi! Stel me gerust een vraag over de wiki.',
      switched: 'Prima, vanaf nu spreek ik Nederlands.',
    },
  };
}
