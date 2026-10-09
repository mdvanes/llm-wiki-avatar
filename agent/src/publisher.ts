import type { Room } from '@livekit/rtc-node';
import type { LLMErrorCode, Provider } from './llmDiagnostics.ts';
import type { Mood } from './mood.ts';

/** Text-stream topics shared with the frontend (see frontend/lib/protocol.ts). */
export const TOPICS = {
  mood: 'wiki.mood',
  answer: 'wiki.answer',
  sources: 'wiki.sources',
  language: 'wiki.language',
  error: 'wiki.error',
} as const;

export const RPC_SET_LANGUAGE = 'set_language';
/** The user pressed push-to-talk: stop the current reply. The transcript follows as a chat message. */
export const RPC_INTERRUPT = 'interrupt';
/** Payload: JSON array of `{ role: 'user' | 'assistant', text }` from an earlier conversation. */
export const RPC_RESTORE_HISTORY = 'restore_history';

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

/** An LLM failure, as codes and redacted facts; the frontend owns the (localized) wording. */
export interface AgentErrorPayload {
  code: LLMErrorCode;
  provider: Provider;
  model: string;
  /** Origin plus path of the LLM base URL. */
  endpoint: string;
  status?: number;
  detail?: string;
  recoverable: boolean;
  timestamp: number;
}

/** Side channel from the agent to the UI (mood, on-screen answers, sources used). */
export interface Publisher {
  mood(mood: Mood): void;
  answer(answer: Answer): void;
  sources(update: SourcesUpdate): void;
  language(code: string): void;
  error(payload: AgentErrorPayload): void;
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

  error(payload: AgentErrorPayload): void {
    this.#send(TOPICS.error, payload);
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

  error(payload: AgentErrorPayload): void {
    this.events.push({ topic: TOPICS.error, payload });
  }
}
