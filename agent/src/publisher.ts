import type { Room, TextStreamWriter } from '@livekit/rtc-node';
import type { Mood } from './mood.ts';

/** Text-stream topics shared with the frontend (see frontend/lib/topics.ts). */
export const TOPICS = {
  mood: 'wiki.mood',
  answer: 'wiki.answer',
  sources: 'wiki.sources',
  language: 'wiki.language',
  reply: 'wiki.reply',
  words: 'wiki.words',
} as const;

/** Attribute on a `wiki.reply` stream: the transcript message the full reply belongs to. */
export const REPLY_TARGET_ATTRIBUTE = 'target';

export const RPC_SET_LANGUAGE = 'set_language';
export const RPC_SET_INPUT_MODE = 'set_input_mode';
/** Payload: `off`, `female` or `male`. */
export const RPC_SET_VOICE = 'set_voice';
/** Payload: `audio` or `words` (see Lipsync). */
export const RPC_SET_LIPSYNC = 'set_lipsync';
export const RPC_PTT_START = 'ptt_start';
export const RPC_PTT_END = 'ptt_end';
export const RPC_PTT_CANCEL = 'ptt_cancel';
/** Payload: JSON array of `{ role: 'user' | 'assistant', text }` from an earlier conversation. */
export const RPC_RESTORE_HISTORY = 'restore_history';
/** Stops the voice; payload: id of the transcript message being spoken (may be empty). */
export const RPC_STOP_SPEAKING = 'stop_speaking';

export interface Source {
  sourceId: string;
  sourceName: string;
  path: string;
  title: string;
}

export interface Answer {
  markdown: string;
  sources: Source[];
}

export interface SourcesUpdate {
  /** Increments per user turn; the frontend replaces its list when the turn changes. */
  turn: number;
  sources: Source[];
}

/** A spoken word; times in ms from the start of its segment's audio. */
export interface WordTiming {
  w: string;
  s: number;
  e: number;
}

/**
 * Word timings for one TTS segment (usually a sentence), sent in pieces as the audio is synthesized. The last piece
 * has `final: true` and the segment's audio length.
 */
export interface WordSegment {
  id: string;
  words: WordTiming[];
  final: boolean;
  durationMs?: number;
}

/** Streams text to the UI piece by piece. */
export interface TextWriter {
  write(text: string): void;
  close(): void;
}

/** Side channel from the agent to the UI (mood, on-screen answers, sources used). */
export interface Publisher {
  mood(mood: Mood): void;
  answer(answer: Answer): void;
  sources(update: SourcesUpdate): void;
  language(code: string): void;
  /** The complete text of a reply whose speech was stopped; replaces the truncated transcript message. */
  fullReply(target: string): TextWriter;
  /** Word timings for the avatar's lip-sync. */
  words(segment: WordSegment): void;
}

export class RoomPublisher implements Publisher {
  #room: Room;
  #onError: (err: unknown) => void;

  constructor(room: Room, onError: (err: unknown) => void = () => {}) {
    this.#room = room;
    this.#onError = onError;
  }

  #send(topic: string, payload: unknown): void {
    const participant = this.#room.localParticipant;
    if (!participant) return;
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    participant.sendText(text, { topic }).catch(this.#onError);
  }

  mood(mood: Mood): void {
    this.#send(TOPICS.mood, mood);
  }

  answer(answer: Answer): void {
    this.#send(TOPICS.answer, answer);
  }

  sources(update: SourcesUpdate): void {
    this.#send(TOPICS.sources, update);
  }

  language(code: string): void {
    this.#send(TOPICS.language, code);
  }

  words(segment: WordSegment): void {
    this.#send(TOPICS.words, segment);
  }

  fullReply(target: string): TextWriter {
    const participant = this.#room.localParticipant;
    if (!participant) return { write: () => {}, close: () => {} };
    let writer: TextStreamWriter | undefined;
    // Steps are chained so they keep their order while the stream is being opened.
    let queue: Promise<void> = participant
      .streamText({ topic: TOPICS.reply, attributes: { [REPLY_TARGET_ATTRIBUTE]: target } })
      .then((w) => {
        writer = w;
      });
    const enqueue = (step: (w: TextStreamWriter) => Promise<void>) => {
      queue = queue.then(() => step(writer!));
      queue.catch(() => {}); // reported on close
    };
    return {
      write: (text) => enqueue((w) => w.write(text)),
      close: () => {
        enqueue((w) => w.close());
        queue.catch(this.#onError);
      },
    };
  }
}

/** Publisher that just records events; used in tests and console mode. */
export class RecordingPublisher implements Publisher {
  readonly events: Array<{ topic: string; payload: unknown }> = [];

  mood(mood: Mood): void {
    this.events.push({ topic: TOPICS.mood, payload: mood });
  }

  answer(answer: Answer): void {
    this.events.push({ topic: TOPICS.answer, payload: answer });
  }

  sources(update: SourcesUpdate): void {
    this.events.push({ topic: TOPICS.sources, payload: update });
  }

  language(code: string): void {
    this.events.push({ topic: TOPICS.language, payload: code });
  }

  words(segment: WordSegment): void {
    this.events.push({ topic: TOPICS.words, payload: segment });
  }

  fullReply(target: string): TextWriter {
    const event = { topic: TOPICS.reply, payload: { target, text: '', closed: false } };
    this.events.push(event);
    return {
      write: (text) => {
        event.payload.text += text;
      },
      close: () => {
        event.payload.closed = true;
      },
    };
  }
}
