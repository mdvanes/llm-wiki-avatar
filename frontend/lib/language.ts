import { type InputMode, isInputMode } from './protocol';

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

const INPUT_MODE_KEY = 'llm-wiki-avatar.inputMode';

export function loadInputMode(): InputMode {
  if (typeof window === 'undefined') return 'always';
  const stored = window.localStorage.getItem(INPUT_MODE_KEY);
  return isInputMode(stored) ? stored : 'always';
}

export function saveInputMode(mode: InputMode): void {
  window.localStorage.setItem(INPUT_MODE_KEY, mode);
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
    hearing: 'Hearing you…',
    transcribing: 'Processing your speech…',
    preparing: 'Preparing an answer…',
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
    micMode: 'Microphone mode',
    alwaysOn: 'Always on',
    pushToTalk: 'Push to talk',
    holdToTalk: 'Hold to talk (or hold Space)',
    talking: 'Release to send',
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
    hearing: 'Hoort je…',
    transcribing: 'Spraak verwerken…',
    preparing: 'Antwoord voorbereiden…',
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
    micMode: 'Microfoonmodus',
    alwaysOn: 'Altijd aan',
    pushToTalk: 'Drukken om te praten',
    holdToTalk: 'Ingedrukt houden om te praten (of houd spatie ingedrukt)',
    talking: 'Loslaten om te versturen',
    empty: 'Zeg hallo, of vraag bijvoorbeeld "Hoe worden Stripe-webhooks opnieuw geprobeerd?"',
  },
} satisfies Record<Language, Record<string, string>>;

export type Strings = (typeof STRINGS)['en'];
