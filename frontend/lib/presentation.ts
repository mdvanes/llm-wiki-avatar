import type { Lipsync, Voice } from './protocol';

/**
 * How the agent answers: text only, a voice, or a voice with a talking avatar. `avatar-female-premium` and
 * `avatar-female-vrm` lip-sync to Kokoro's word timings (English only; elsewhere they fall back to loudness lip-sync).
 * `avatar-female-vrm` is a 3D VRM model instead of an animated photo.
 */
export const PRESENTATIONS = [
  'off',
  'voice-female',
  'voice-male',
  'avatar-female-premium',
  'avatar-female-vrm',
  'avatar-male',
] as const;
export type Presentation = (typeof PRESENTATIONS)[number];
export type AvatarGender = 'female' | 'male';
/** `photo`: the animated photo (or the cartoon without WebGL); `vrm`: a 3D VRM model. */
export type AvatarKind = 'photo' | 'vrm';

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

/** How the avatar is drawn, or null for no avatar. */
export function avatarKindOf(presentation: Presentation): AvatarKind | null {
  if (!presentation.startsWith('avatar-')) return null;
  return presentation === 'avatar-female-vrm' ? 'vrm' : 'photo';
}

/** How the avatar's mouth follows the voice. */
export function lipsyncOf(presentation: Presentation): Lipsync {
  return presentation === 'avatar-female-premium' || presentation === 'avatar-female-vrm' ? 'words' : 'audio';
}

/** The presentation that matches the default voice (`DEFAULT_VOICE`), with an avatar. */
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
