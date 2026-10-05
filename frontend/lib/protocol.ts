/** Wire protocol shared with the agent (see agent/src/publisher.ts). */
export const TOPICS = {
  mood: 'wiki.mood',
  answer: 'wiki.answer',
  sources: 'wiki.sources',
  language: 'wiki.language',
} as const;

export const RPC_SET_LANGUAGE = 'set_language';
/** Push-to-talk pressed: the agent stops its reply. The transcript follows as a chat message. */
export const RPC_INTERRUPT = 'interrupt';
/** Continues an earlier conversation; see restorePayload in lib/history.ts. */
export const RPC_RESTORE_HISTORY = 'restore_history';
export const LANGUAGE_ATTRIBUTE = 'language';

/** `off`: replies are text only (push-to-talk keeps working). Otherwise the gender of the voice. */
export const VOICES = ['off', 'female', 'male'] as const;
export type Voice = (typeof VOICES)[number];

export function isVoice(value: unknown): value is Voice {
  return typeof value === 'string' && (VOICES as readonly string[]).includes(value);
}

export const MOODS = ['neutral', 'happy', 'sad', 'confused'] as const;
export type Mood = (typeof MOODS)[number];

export interface Source {
  sourceId?: string;
  sourceName?: string;
  path: string;
  title: string;
}

export interface Answer {
  markdown: string;
  sources: Source[];
}

export interface SourcesUpdate {
  turn: number;
  sources: Source[];
}

export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && (MOODS as readonly string[]).includes(value);
}

export function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
