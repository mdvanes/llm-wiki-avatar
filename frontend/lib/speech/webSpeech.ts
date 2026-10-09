import type { Language } from '@/lib/language';

/** The parts of the Web Speech API's `SpeechRecognition` used here; TypeScript's DOM library does not include it. */
export interface RecognitionAlternative {
  transcript: string;
}
export interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
export interface RecognitionEvent {
  resultIndex: number;
  results: { readonly length: number; [index: number]: RecognitionResult };
}
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionCtor = new () => Recognition;

interface SpeechWindow {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
}

export function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function supportsRecognition(): boolean {
  return recognitionCtor() !== undefined;
}

export function supportsSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

/** BCP 47 tag for the browser's recognizer and voices. */
export function speechLang(language: Language): string {
  return language === 'nl' ? 'nl-NL' : 'en-US';
}

/** What to do about a recognition error. */
export type ErrorKind = 'ignore' | 'network' | 'fatal';

export function classifyError(code: string): ErrorKind {
  switch (code) {
    case 'no-speech':
    case 'aborted':
    case 'audio-capture':
      return 'ignore';
    case 'not-allowed':
    case 'service-not-allowed':
    case 'language-not-supported':
    case 'bad-grammar':
      return 'fatal';
    default:
      return 'network';
  }
}

export const MIN_RESTART_MS = 300;
export const MAX_RESTART_MS = 8000;

/** Pause before listening again: short normally, longer after repeated failures so a broken service is not hammered. */
export function restartDelay(failures: number): number {
  return Math.min(MAX_RESTART_MS, MIN_RESTART_MS * 2 ** Math.max(0, failures));
}

/** Joins the results of a recognition event into the final and the interim text. */
export function readResults(event: RecognitionEvent): {
  final: string;
  interim: string;
} {
  let final = '';
  let interim = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i]!;
    const text = result[0]?.transcript ?? '';
    if (result.isFinal) final += text;
    else interim += text;
  }
  return { final: final.trim(), interim: interim.trim() };
}

interface VoiceLike {
  voiceURI: string;
  lang: string;
  localService: boolean;
}

/** The installed voice to speak with: the chosen one, else an offline voice for the language, else any for it. */
export function pickVoice<V extends VoiceLike>(
  voices: readonly V[],
  lang: string,
  chosenUri?: string | null,
): V | undefined {
  const chosen = chosenUri ? voices.find((v) => v.voiceURI === chosenUri) : undefined;
  if (chosen) return chosen;
  const base = lang.slice(0, 2).toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base));
  return (
    matching.find((v) => v.localService && v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase()) ??
    matching.find((v) => v.localService) ??
    matching[0]
  );
}
