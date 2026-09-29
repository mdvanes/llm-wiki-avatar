import { stt, type voice } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';
import { ReadableStream, TransformStream } from 'node:stream/web';

/** `always`: the turn detector decides when the user is done. `ptt`: the user holds a button while talking. */
export const INPUT_MODES = ['always', 'ptt'] as const;
export type InputMode = (typeof INPUT_MODES)[number];

export function isInputMode(value: unknown): value is InputMode {
  return typeof value === 'string' && (INPUT_MODES as readonly string[]).includes(value);
}

const FRAME_MS = 20;

/** Where STT is with the user's current utterance; published to the frontend as a participant attribute. */
export const SPEECH_STATES = ['idle', 'hearing', 'transcribing'] as const;
export type SpeechState = (typeof SPEECH_STATES)[number];

/** The recognize method of a non-streaming STT; the StreamAdapter calls it once per speech segment. */
interface Recognizer {
  recognize(...args: never[]): Promise<stt.SpeechEvent>;
}

/**
 * Sits around the STT node: can append silence to the audio going into STT (so the VAD that segments
 * speech for Whisper closes the segment right away) and tracks where STT is in the current utterance.
 */
export class SttTap {
  #controller: ReadableStreamDefaultController<AudioFrame> | undefined;
  #format: { sampleRate: number; channels: number } | undefined;
  #speaking = false;
  #pendingFinal = false;
  #finals = 0;
  #listeners = new Set<() => void>();

  /** STT is still hearing speech, or transcribing the last segment. */
  get busy(): boolean {
    return this.#speaking || this.#pendingFinal;
  }

  /** Hearing speech, transcribing it, or neither. */
  get state(): SpeechState {
    return this.#speaking ? 'hearing' : this.#pendingFinal ? 'transcribing' : 'idle';
  }

  /** Calls the listener whenever `state` may have changed; returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Notices recognitions that produce no transcript (silence, noise, errors): the StreamAdapter then emits no
   * FINAL_TRANSCRIPT, which would otherwise leave the tap busy until a timeout.
   */
  trackRecognition(engine: Recognizer): void {
    const original = engine.recognize.bind(engine) as (...args: unknown[]) => Promise<stt.SpeechEvent>;
    (engine as { recognize: (...args: unknown[]) => Promise<stt.SpeechEvent> }).recognize = async (...args) => {
      try {
        const event = await original(...args);
        if (!event.alternatives?.[0]?.text) this.#recognizedNothing();
        return event;
      } catch (err) {
        this.#recognizedNothing();
        throw err;
      }
    };
  }

  #recognizedNothing(): void {
    if (!this.#pendingFinal) return;
    this.#pendingFinal = false;
    this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /** Number of final transcripts so far. */
  get finals(): number {
    return this.#finals;
  }

  wrapAudio(audio: ReadableStream<AudioFrame> | AsyncIterable<AudioFrame>): ReadableStream<AudioFrame> {
    const source =
      audio instanceof ReadableStream
        ? audio
        : ReadableStream.from(audio as AsyncIterable<AudioFrame>);
    const reader = source.getReader();
    let own: ReadableStreamDefaultController<AudioFrame>;
    const release = () => {
      if (this.#controller === own) this.#controller = undefined;
    };
    return new ReadableStream<AudioFrame>({
      start: (controller) => {
        own = controller;
        this.#controller = controller;
      },
      pull: async (controller) => {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
          return;
        }
        this.#format = { sampleRate: value.sampleRate, channels: value.channels };
        controller.enqueue(value);
      },
      cancel: async (reason) => {
        release();
        await reader.cancel(reason);
      },
    });
  }

  watchEvents(events: ReadableStream<stt.SpeechEvent | string>): ReadableStream<stt.SpeechEvent | string> {
    return events.pipeThrough(
      new TransformStream<stt.SpeechEvent | string, stt.SpeechEvent | string>({
        transform: (event, controller) => {
          controller.enqueue(event);
          if (typeof event !== 'string') this.observe(event.type);
        },
      }),
    );
  }

  /** @internal Exposed for tests. */
  observe(type: stt.SpeechEventType): void {
    if (type === stt.SpeechEventType.START_OF_SPEECH) {
      this.#speaking = true;
    } else if (type === stt.SpeechEventType.END_OF_SPEECH) {
      this.#speaking = false;
      this.#pendingFinal = true;
    } else if (type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
      this.#pendingFinal = false;
      this.#finals++;
    } else {
      return;
    }
    this.#notify();
  }

  /** Forget an unfinished utterance (the user turn was cleared). */
  reset(): void {
    if (!this.#speaking && !this.#pendingFinal) return;
    this.#speaking = false;
    this.#pendingFinal = false;
    this.#notify();
  }

  /** Appends silence to the STT input. Returns false when no audio has flowed yet. */
  injectSilence(ms: number): boolean {
    const controller = this.#controller;
    const format = this.#format;
    if (!controller || !format) return false;
    const samples = Math.round((format.sampleRate * FRAME_MS) / 1000);
    try {
      for (let t = 0; t < ms; t += FRAME_MS) {
        controller.enqueue(
          new AudioFrame(new Int16Array(samples * format.channels), format.sampleRate, format.channels, samples),
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Resolves once STT is idle (no speech, no transcription in flight) or after the timeout. */
  waitUntilIdle(timeoutMs: number): Promise<boolean> {
    if (!this.busy) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (idle: boolean) => {
        clearTimeout(timer);
        this.#listeners.delete(check);
        resolve(idle);
      };
      const check = () => {
        if (!this.busy) done(true);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      this.#listeners.add(check);
    });
  }
}

type TurnDetection = NonNullable<NonNullable<voice.AgentSessionUpdateOptions['turnHandling']>['turnDetection']>;

/** The parts of AgentSession used here, so tests can pass a fake. */
export interface InputSession {
  interrupt(): unknown;
  clearUserTurn(): void;
  commitUserTurn(): void;
  updateOptions(options: voice.AgentSessionUpdateOptions): void;
  input: { setAudioEnabled(enabled: boolean): void };
}

export interface InputModeOptions {
  /** Turn detection to restore in `always` mode. */
  autoTurnDetection: TurnDetection;
  /** Silence appended on release, longer than the VAD's minimum silence (0.55 s by default). */
  releaseSilenceMs?: number;
  /** Time for the VAD to notice speech right before the release. */
  settleMs?: number;
  /** Maximum wait for the transcript after the release. */
  transcriptTimeoutMs?: number;
}

export type TurnResult = 'committed' | 'empty' | 'superseded';

/** Switches between hands-free and push-to-talk and runs push-to-talk turns. */
export class InputModeController {
  readonly #session: InputSession;
  readonly #tap: SttTap;
  readonly #opts: Required<InputModeOptions>;
  #mode: InputMode = 'always';
  #turn = 0;
  #finalsAtStart = 0;

  constructor(session: InputSession, tap: SttTap, opts: InputModeOptions) {
    this.#session = session;
    this.#tap = tap;
    this.#opts = { releaseSilenceMs: 1000, settleMs: 250, transcriptTimeoutMs: 15_000, ...opts };
  }

  get mode(): InputMode {
    return this.#mode;
  }

  setMode(mode: InputMode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#turn++;
    if (mode === 'ptt') {
      this.#session.updateOptions({ turnHandling: { turnDetection: 'manual' } });
      this.#clear();
      this.#session.input.setAudioEnabled(false);
    } else {
      this.#session.updateOptions({ turnHandling: { turnDetection: this.#opts.autoTurnDetection } });
      this.#session.input.setAudioEnabled(true);
    }
  }

  /** Button pressed: stop the agent and start listening. */
  startTurn(): void {
    if (this.#mode !== 'ptt') throw new Error('push-to-talk is not enabled');
    this.#turn++;
    this.#session.interrupt();
    this.#clear();
    this.#finalsAtStart = this.#tap.finals;
    this.#session.input.setAudioEnabled(true);
  }

  /** Button released: finish transcribing, then hand the turn to the LLM. */
  async endTurn(): Promise<TurnResult> {
    if (this.#mode !== 'ptt') return 'superseded';
    const turn = this.#turn;
    this.#tap.injectSilence(this.#opts.releaseSilenceMs);
    await new Promise((r) => setTimeout(r, this.#opts.settleMs));
    await this.#tap.waitUntilIdle(this.#opts.transcriptTimeoutMs);
    if (turn !== this.#turn) return 'superseded';

    this.#session.input.setAudioEnabled(false);
    if (this.#tap.finals > this.#finalsAtStart) {
      this.#session.commitUserTurn();
      return 'committed';
    }
    this.#clear();
    return 'empty';
  }

  /** Button released without wanting an answer (e.g. the pointer left the window). */
  cancelTurn(): void {
    if (this.#mode !== 'ptt') return;
    this.#turn++;
    this.#session.input.setAudioEnabled(false);
    this.#clear();
  }

  #clear(): void {
    this.#session.clearUserTurn();
    this.#tap.reset();
  }
}
