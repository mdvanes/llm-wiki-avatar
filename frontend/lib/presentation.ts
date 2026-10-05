import type { Voice } from './protocol';

/**
 * How the agent answers: text only, a voice, or a voice with a talking 3D avatar (Ember for female, Nova for male).
 * The avatars lip-sync to Kokoro's word timings (English only; elsewhere they fall back to loudness lip-sync).
 */
export const PRESENTATIONS = ['off', 'voice-female', 'voice-male', 'avatar-female-premium', 'avatar-male'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];
export type AvatarGender = 'female' | 'male';

export const DEFAULT_PRESENTATION: Presentation = 'avatar-female-premium';

const STORAGE_KEY = 'llm-wiki-avatar.presentation';

export function isPresentation(value: unknown): value is Presentation {
  return typeof value === 'string' && (PRESENTATIONS as readonly string[]).includes(value);
}

/** The voice that speaks the replies. */
export function voiceOf(presentation: Presentation): Voice {
  return presentation === 'off' ? 'off' : presentation.endsWith('-male') ? 'male' : 'female';
}

/** The avatar to show, or null for no avatar. */
export function avatarOf(presentation: Presentation): AvatarGender | null {
  return presentation.startsWith('avatar-') ? (voiceOf(presentation) as AvatarGender) : null;
}

/** The presentation that matches the default voice (`DEFAULT_VOICE`), with an avatar. */
export function presentationForVoice(voice: Voice): Presentation {
  return voice === 'off' ? 'off' : voice === 'female' ? 'avatar-female-premium' : 'avatar-male';
}

export function loadPresentation(fallback: Presentation = DEFAULT_PRESENTATION): Presentation {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  // Removed female avatars are replaced by the premium one.
  if (stored === 'avatar-female' || stored === 'avatar-female-vrm') return 'avatar-female-premium';
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
