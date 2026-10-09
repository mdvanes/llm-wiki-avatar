import type { Language } from '@/lib/language';
import { supportsRecognition, supportsSynthesis } from './webSpeech';

/** `device`: Whisper and Piper/Kokoro in this browser. `browser`: the Web Speech API (faster; recognition goes to the browser vendor). */
export type Engine = 'device' | 'browser';
export type EngineKind = 'input' | 'output';

export const ENGINE_KEYS: Record<EngineKind, string> = {
  input: 'llm-wiki-avatar.speechInputEngine',
  output: 'llm-wiki-avatar.speechOutputEngine',
};
export const webVoiceKey = (language: Language) => `llm-wiki-avatar.webVoice.${language}`;

export function isEngine(value: unknown): value is Engine {
  return value === 'device' || value === 'browser';
}

export function browserSupports(kind: EngineKind): boolean {
  return kind === 'input' ? supportsRecognition() : supportsSynthesis();
}

/** Phones and tablets cannot run the on-device models at a useful speed, so they start with the browser's speech. */
export function isTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function defaultEngine(kind: EngineKind): Engine {
  return browserSupports(kind) && isTouchDevice() ? 'browser' : 'device';
}

export function loadEngine(kind: EngineKind): Engine {
  if (typeof window === 'undefined') return 'device';
  const stored = window.localStorage.getItem(ENGINE_KEYS[kind]);
  if (isEngine(stored) && (stored === 'device' || browserSupports(kind))) return stored;
  return defaultEngine(kind);
}

export function saveEngine(kind: EngineKind, engine: Engine): void {
  window.localStorage.setItem(ENGINE_KEYS[kind], engine);
}

export function loadWebVoice(language: Language): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(webVoiceKey(language));
}

export function saveWebVoice(language: Language, voiceURI: string | null): void {
  if (voiceURI) window.localStorage.setItem(webVoiceKey(language), voiceURI);
  else window.localStorage.removeItem(webVoiceKey(language));
}
