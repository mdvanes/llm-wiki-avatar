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
    stop: 'Stop',
    stopSpeaking: 'Stop speaking',
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
    history: 'Conversations',
    noHistory: 'Past conversations appear here.',
    today: 'Today',
    yesterday: 'Yesterday',
    previous7Days: 'Previous 7 days',
    untitled: 'Conversation',
    continueConversation: 'Continue conversation',
    continuing: 'Continuing an earlier conversation',
    deleteConversation: 'Delete',
    confirmDelete: 'Delete this conversation?',
    clearHistory: 'Clear all',
    confirmClear: 'Delete all saved conversations?',
    showHistory: 'Show conversations',
    hideHistory: 'Hide conversations',
    historyNote: 'Saved in this browser only.',
    presentation: 'Voice and avatar',
    presentationOff: 'Off (text replies only)',
    voiceFemale: 'Voice only, female',
    voiceMale: 'Voice only, male',
    avatarFemale: 'Voice and avatar, female',
    avatarMale: 'Voice and avatar, male',
    switchingVoice: 'Switching voice…',
    loadingAvatar: 'Loading avatar…',
    answering: 'Answering',
    textOnly: 'Replies as text only',
    voiceOnly: 'Voice only',
    avatarUnavailable: 'Avatar unavailable.',
    avatarMissingFemale: 'The female avatar is not installed.',
    avatarMissingMale: 'The male avatar is not installed.',
    avatarMissingRun: 'Download it by running this in the repository root:',
    avatarMissingReload: 'Then reload this page.',
    avatarMissingDocker: 'With Docker, run the command before "docker compose up --build": the avatars are copied into the image.',
    avatarMissingLicense: 'This sample avatar may only be used for non-commercial purposes.',
    avatarMissingCustom: 'No model found at {url}. Check {envVar} in .env and restart the frontend.',
    avatarMissingFallback: 'Or pick a "Voice only" option in the menu above.',
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
    stop: 'Stop',
    stopSpeaking: 'Stoppen met praten',
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
    history: 'Gesprekken',
    noHistory: 'Eerdere gesprekken verschijnen hier.',
    today: 'Vandaag',
    yesterday: 'Gisteren',
    previous7Days: 'Afgelopen 7 dagen',
    untitled: 'Gesprek',
    continueConversation: 'Gesprek voortzetten',
    continuing: 'Een eerder gesprek wordt voortgezet',
    deleteConversation: 'Verwijderen',
    confirmDelete: 'Dit gesprek verwijderen?',
    clearHistory: 'Alles wissen',
    confirmClear: 'Alle bewaarde gesprekken verwijderen?',
    showHistory: 'Gesprekken tonen',
    hideHistory: 'Gesprekken verbergen',
    historyNote: 'Alleen in deze browser bewaard.',
    presentation: 'Stem en avatar',
    presentationOff: 'Uit (alleen tekstantwoorden)',
    voiceFemale: 'Alleen stem, vrouw',
    voiceMale: 'Alleen stem, man',
    avatarFemale: 'Stem en avatar, vrouw',
    avatarMale: 'Stem en avatar, man',
    switchingVoice: 'Stem wisselen…',
    loadingAvatar: 'Avatar laden…',
    answering: 'Antwoordt',
    textOnly: 'Antwoorden alleen als tekst',
    voiceOnly: 'Alleen stem',
    avatarUnavailable: 'Avatar niet beschikbaar.',
    avatarMissingFemale: 'De vrouwelijke avatar is niet geïnstalleerd.',
    avatarMissingMale: 'De mannelijke avatar is niet geïnstalleerd.',
    avatarMissingRun: 'Download hem door dit in de hoofdmap van de repository uit te voeren:',
    avatarMissingReload: 'Herlaad daarna deze pagina.',
    avatarMissingDocker: 'Met Docker: voer het commando uit vóór "docker compose up --build"; de avatars worden in de image gekopieerd.',
    avatarMissingLicense: 'Deze voorbeeldavatar mag alleen voor niet-commerciële doeleinden worden gebruikt.',
    avatarMissingCustom: 'Geen model gevonden op {url}. Controleer {envVar} in .env en herstart de frontend.',
    avatarMissingFallback: 'Of kies een optie "Alleen stem" in het menu hierboven.',
  },
} satisfies Record<Language, Record<string, string>>;

export type Strings = (typeof STRINGS)['en'];
