import type { Config, Language } from './config.ts';

export interface LanguageProfile {
  code: Language;
  /** Language name as used in instructions to the LLM. */
  name: string;
  /** ISO code passed to Whisper. */
  whisperLanguage: string;
  tts: { baseURL: string; model: string; voice: string };
  greeting: string;
  switched: string;
}

export function languageProfiles(cfg: Config): Record<Language, LanguageProfile> {
  return {
    en: {
      code: 'en',
      name: 'English',
      whisperLanguage: 'en',
      tts: {
        baseURL: cfg.TTS_EN_BASE_URL ?? cfg.SPEACHES_URL,
        model: cfg.TTS_EN_MODEL,
        voice: cfg.TTS_EN_VOICE,
      },
      greeting: 'Hi! Ask me anything about the wiki.',
      switched: "Okay, I'll speak English from now on.",
    },
    nl: {
      code: 'nl',
      name: 'Dutch',
      whisperLanguage: 'nl',
      tts: {
        baseURL: cfg.TTS_NL_BASE_URL ?? cfg.SPEACHES_URL,
        model: cfg.TTS_NL_MODEL,
        voice: cfg.TTS_NL_VOICE,
      },
      greeting: 'Hoi! Stel me gerust een vraag over de wiki.',
      switched: 'Prima, vanaf nu spreek ik Nederlands.',
    },
  };
}
