/** Wire protocol shared with the agent (see agent/src/publisher.ts). */
export const TOPICS = {
  mood: 'wiki.mood',
  answer: 'wiki.answer',
  sources: 'wiki.sources',
  language: 'wiki.language',
  reply: 'wiki.reply',
} as const;

/** Attribute on a `wiki.reply` stream: the transcript message the full reply belongs to. */
export const REPLY_TARGET_ATTRIBUTE = 'target';

export const RPC_SET_LANGUAGE = 'set_language';
export const RPC_SET_INPUT_MODE = 'set_input_mode';
/** Switches the agent's voice; payload: a Voice. */
export const RPC_SET_VOICE = 'set_voice';
export const RPC_PTT_START = 'ptt_start';
export const RPC_PTT_END = 'ptt_end';
export const RPC_PTT_CANCEL = 'ptt_cancel';
/** Continues an earlier conversation; see restorePayload in lib/history.ts. */
export const RPC_RESTORE_HISTORY = 'restore_history';
/** Stops the voice at once; the rest of the reply arrives as text on the `wiki.reply` topic. */
export const RPC_STOP_SPEAKING = 'stop_speaking';
export const LANGUAGE_ATTRIBUTE = 'language';
export const INPUT_MODE_ATTRIBUTE = 'input_mode';
export const VOICE_ATTRIBUTE = 'voice';
/** Set by the agent on itself: where speech-to-text is with the user's current utterance. */
export const SPEECH_STATE_ATTRIBUTE = 'speech_state';
export type SpeechState = 'idle' | 'hearing' | 'transcribing';

export function toSpeechState(value: string | undefined): SpeechState {
  return value === 'hearing' || value === 'transcribing' ? value : 'idle';
}

/** `always`: hands-free with automatic turn detection. `ptt`: hold a button while talking. */
export const INPUT_MODES = ['always', 'ptt'] as const;
export type InputMode = (typeof INPUT_MODES)[number];

export function isInputMode(value: unknown): value is InputMode {
  return typeof value === 'string' && (INPUT_MODES as readonly string[]).includes(value);
}

/** `off`: the agent replies in text only (speech-to-text keeps working). Otherwise the gender of the voice. */
export const VOICES = ['off', 'female', 'male'] as const;
export type Voice = (typeof VOICES)[number];

export function isVoice(value: unknown): value is Voice {
  return typeof value === 'string' && (VOICES as readonly string[]).includes(value);
}

export const MOODS = ['neutral', 'happy', 'sad', 'confused'] as const;
export type Mood = (typeof MOODS)[number];

export interface Source {
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
