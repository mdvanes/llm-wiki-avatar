import type { Voice } from './protocol';

/** How the agent answers: text only, a voice, or a voice with a talking avatar. */
export const PRESENTATIONS = ['off', 'voice-female', 'voice-male', 'avatar-female', 'avatar-male'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];
export type AvatarGender = 'female' | 'male';

export const DEFAULT_PRESENTATION: Presentation = 'avatar-female';

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

/** The presentation that matches the agent's default voice (`DEFAULT_VOICE`), with an avatar. */
export function presentationForVoice(voice: Voice): Presentation {
  return voice === 'off' ? 'off' : `avatar-${voice}`;
}

export function loadPresentation(fallback: Presentation = DEFAULT_PRESENTATION): Presentation {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isPresentation(stored) ? stored : fallback;
}

export function savePresentation(presentation: Presentation): void {
  window.localStorage.setItem(STORAGE_KEY, presentation);
}
