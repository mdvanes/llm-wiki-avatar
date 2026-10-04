/** Wire protocol shared with the agent (see agent/src/publisher.ts). */
export const TOPICS = {
  mood: 'wiki.mood',
  answer: 'wiki.answer',
  sources: 'wiki.sources',
  language: 'wiki.language',
  reply: 'wiki.reply',
  /** Word timings for the premium avatar's lip-sync; payload: a WordSegment. */
  words: 'wiki.words',
} as const;

/** Attribute on a `wiki.reply` stream: the transcript message the full reply belongs to. */
export const REPLY_TARGET_ATTRIBUTE = 'target';

export const RPC_SET_LANGUAGE = 'set_language';
export const RPC_SET_INPUT_MODE = 'set_input_mode';
/** Switches the agent's voice; payload: a Voice. */
export const RPC_SET_VOICE = 'set_voice';
/** Switches between loudness and word-timed lip-sync; payload: a Lipsync. */
export const RPC_SET_LIPSYNC = 'set_lipsync';
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
export const LIPSYNC_ATTRIBUTE = 'lipsync';
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

/** `audio`: the mouth follows the loudness of the voice. `words`: word timings from the TTS (premium avatar). */
export const LIPSYNCS = ['audio', 'words'] as const;
export type Lipsync = (typeof LIPSYNCS)[number];

export function isLipsync(value: unknown): value is Lipsync {
  return typeof value === 'string' && (LIPSYNCS as readonly string[]).includes(value);
}

/** A spoken word; times in ms from the start of its segment's audio. */
export interface WordTiming {
  w: string;
  s: number;
  e: number;
}

/** Word timings of one TTS segment, sent in pieces; the last has `final` and the audio length. */
export interface WordSegment {
  id: string;
  words: WordTiming[];
  final: boolean;
  durationMs?: number;
}

export function isWordSegment(value: unknown): value is WordSegment {
  const v = value as WordSegment | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.id === 'string' &&
    Array.isArray(v.words) &&
    v.words.every((w) => typeof w?.w === 'string' && typeof w.s === 'number' && typeof w.e === 'number')
  );
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
