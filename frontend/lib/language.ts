export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'nl', label: 'Nederlands', short: 'NL' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'llm-wiki-avatar.language';

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}

export function loadLanguage(fallback: Language = 'en'): Language {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isLanguage(stored)) return stored;
  return navigator.language.toLowerCase().startsWith('nl') ? 'nl' : fallback;
}

export function saveLanguage(language: Language): void {
  window.localStorage.setItem(STORAGE_KEY, language);
}

/** UI strings; the agent handles the spoken side. */
export const STRINGS = {
  en: {
    title: 'Talk to the wiki',
    subtitle: 'Ask questions about the code base out loud. Code and details show up on screen.',
    start: 'Start conversation',
    connecting: 'Connecting…',
    waiting: 'Waiting for the agent…',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
    end: 'End',
    mute: 'Mute microphone',
    unmute: 'Unmute microphone',
    typePlaceholder: 'Or type a question…',
    send: 'Send',
    transcript: 'Transcript',
    onScreen: 'On screen',
    sources: 'Sources',
    noSources: 'Pages used for the answer appear here.',
    close: 'Close',
    language: 'Language',
    empty: 'Say hello, or ask something like "How are Stripe webhooks retried?"',
  },
  nl: {
    title: 'Praat met de wiki',
    subtitle: 'Stel hardop vragen over de code. Code en details verschijnen op het scherm.',
    start: 'Gesprek starten',
    connecting: 'Verbinden…',
    waiting: 'Wachten op de agent…',
    listening: 'Luistert',
    thinking: 'Denkt na',
    speaking: 'Spreekt',
    end: 'Stoppen',
    mute: 'Microfoon dempen',
    unmute: 'Microfoon aan',
    typePlaceholder: 'Of typ een vraag…',
    send: 'Versturen',
    transcript: 'Transcript',
    onScreen: 'Op het scherm',
    sources: 'Bronnen',
    noSources: 'Gebruikte pagina’s verschijnen hier.',
    close: 'Sluiten',
    language: 'Taal',
    empty: 'Zeg hallo, of vraag bijvoorbeeld "Hoe worden Stripe-webhooks opnieuw geprobeerd?"',
  },
} satisfies Record<Language, Record<string, string>>;

export type Strings = (typeof STRINGS)['en'];
