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
  greeting: string;
  switched: string;
}

export function languageProfiles(cfg: Config): Record<Language, LanguageProfile> {
  return {
    en: {
      code: 'en',
      name: 'English',
      whisperLanguage: 'en',
      voices: {
        female: {
          baseURL: cfg.TTS_EN_BASE_URL ?? cfg.SPEACHES_URL,
          model: cfg.TTS_EN_MODEL,
          voice: cfg.TTS_EN_VOICE,
        },
        male: {
          baseURL: cfg.TTS_EN_MALE_BASE_URL ?? cfg.SPEACHES_URL,
          model: cfg.TTS_EN_MALE_MODEL,
          voice: cfg.TTS_EN_MALE_VOICE,
        },
      },
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
