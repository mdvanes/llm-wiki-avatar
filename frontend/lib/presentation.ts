import type { Lipsync, Voice } from './protocol';

/**
 * How the agent answers: text only, a voice, or a voice with a talking avatar. `avatar-female-premium` lip-syncs
 * to word timings from the TTS (English only; elsewhere it falls back to the regular voice and loudness lip-sync).
 */
export const PRESENTATIONS = ['off', 'voice-female', 'voice-male', 'avatar-female-premium', 'avatar-male'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];
export type AvatarGender = 'female' | 'male';

export const DEFAULT_PRESENTATION: Presentation = 'avatar-female-premium';

const STORAGE_KEY = 'llm-wiki-avatar.presentation';

export function isPresentation(value: unknown): value is Presentation {
  return typeof value === 'string' && (PRESENTATIONS as readonly string[]).includes(value);
}

/** The voice the agent should use. */
export function voiceOf(presentation: Presentation): Voice {
  return presentation === 'off' ? 'off' : presentation.endsWith('-male') ? 'male' : 'female';
}

/** The avatar to show, or null for no avatar. */
export function avatarOf(presentation: Presentation): AvatarGender | null {
  return presentation.startsWith('avatar-') ? (voiceOf(presentation) as AvatarGender) : null;
}

/** How the avatar's mouth follows the voice. */
export function lipsyncOf(presentation: Presentation): Lipsync {
  return presentation === 'avatar-female-premium' ? 'words' : 'audio';
}

/** The presentation that matches the agent's default voice (`DEFAULT_VOICE`), with an avatar. */
export function presentationForVoice(voice: Voice): Presentation {
  return voice === 'off' ? 'off' : voice === 'female' ? 'avatar-female-premium' : 'avatar-male';
}

export function loadPresentation(fallback: Presentation = DEFAULT_PRESENTATION): Presentation {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  // `avatar-female` was removed; it is replaced by the premium female avatar.
  if (stored === 'avatar-female') return 'avatar-female-premium';
  return isPresentation(stored) ? stored : fallback;
}

export function savePresentation(presentation: Presentation): void {
  window.localStorage.setItem(STORAGE_KEY, presentation);
}

/** Show replies as they arrive instead of along with the voice. */
export const INSTANT_TRANSCRIPT_KEY = 'llm-wiki-avatar.instantTranscript';

export function loadInstantTranscript(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(INSTANT_TRANSCRIPT_KEY) === 'true';
}

export function saveInstantTranscript(instant: boolean): void {
  window.localStorage.setItem(INSTANT_TRANSCRIPT_KEY, String(instant));
}
