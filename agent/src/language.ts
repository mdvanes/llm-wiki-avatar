import type { Language } from './config.ts';

export interface LanguageProfile {
  code: Language;
  /** Language name as used in instructions to the LLM. */
  name: string;
  greeting: string;
  switched: string;
}

export const LANGUAGE_PROFILES: Record<Language, LanguageProfile> = {
  en: {
    code: 'en',
    name: 'English',
    greeting: 'Hi! Ask me anything about the wiki.',
    switched: "Okay, I'll speak English from now on.",
  },
  nl: {
    code: 'nl',
    name: 'Dutch',
    greeting: 'Hoi! Stel me gerust een vraag over de wiki.',
    switched: 'Prima, vanaf nu spreek ik Nederlands.',
  },
};
