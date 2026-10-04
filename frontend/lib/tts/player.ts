import type { WordTiming } from '@/lib/protocol';
import type { TtsClient } from './client';
import { SentenceSplitter } from './sentences';
import type { VoiceSpec } from './voices';

export interface PlayedSentence {
  text: string;
  words?: WordTiming[];
  /** AudioContext time at which the sentence starts playing. */
  startAt: number;
  durationMs: number;
  synthMs: number;
}

export interface SpeechPlayerEvents {
  onSentence?: (sentence: PlayedSentence) => void;
  /** Nothing left to say or play. */
  onIdle?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Speaks text sentence by sentence: synthesizes the next sentence while the current one plays, so speech can start
 * as soon as the first sentence is complete. The analyser carries the voice, for loudness lip-sync.
 */
export class SpeechPlayer {
  readonly context = new AudioContext();
  readonly analyser = this.context.createAnalyser();
  readonly #client: TtsClient;
  readonly #events: SpeechPlayerEvents;
  #spec: VoiceSpec | undefined;
  #splitter = new SentenceSplitter();
  #queue: string[] = [];
  #epoch = 0;
  #synthesizing = false;
  #nextStart = 0;
  readonly #sources = new Set<AudioBufferSourceNode>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(client: TtsClient, events: SpeechPlayerEvents = {}) {
    this.#client = client;
    this.#events = events;
    this.analyser.fftSize = 1024;
    this.analyser.connect(this.context.destination);
  }

  setVoice(spec: VoiceSpec | undefined): void {
    this.#spec = spec;
  }

  get busy(): boolean {
    return this.#synthesizing || this.#queue.length > 0 || this.#sources.size > 0;
  }

  /** Adds streamed text; complete sentences are spoken right away. */
  push(text: string): void {
    this.#enqueue(this.#splitter.push(text));
  }

  /** Speaks what is left of the streamed text. */
  end(): void {
    this.#enqueue(this.#splitter.flush());
  }

  /** Speaks a complete text. */
  speak(text: string): void {
    this.push(text);
    this.end();
  }

  /** Stops speaking at once and forgets the text not spoken yet. */
  stop(): void {
    this.#epoch++;
    this.#queue = [];
    this.#splitter = new SentenceSplitter();
    for (const source of this.#sources) source.stop();
    this.#sources.clear();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#nextStart = 0;
    this.#synthesizing = false;
  }

  close(): void {
    this.stop();
    void this.context.close();
  }

  #enqueue(sentences: string[]): void {
    if (sentences.length === 0) return;
    void this.context.resume();
    this.#queue.push(...sentences);
    if (!this.#synthesizing) void this.#pump(this.#epoch);
  }

  async #pump(epoch: number): Promise<void> {
    this.#synthesizing = true;
    try {
      while (epoch === this.#epoch && this.#queue.length > 0) {
        const text = this.#queue.shift()!;
        const spec = this.#spec;
        if (!spec) throw new Error('no voice selected');
        const started = performance.now();
        const speech = await this.#client.synthesize(spec, text);
        if (epoch !== this.#epoch) return;
        if (speech.audio.length > 0) this.#play(text, speech, performance.now() - started);
      }
    } catch (err) {
      if (epoch === this.#epoch) {
        this.stop();
        this.#events.onError?.(err);
      }
      return;
    } finally {
      if (epoch === this.#epoch) this.#synthesizing = false;
    }
    if (epoch === this.#epoch && !this.busy) this.#events.onIdle?.();
  }

  #play(text: string, speech: { audio: Float32Array; sampleRate: number; words?: WordTiming[] }, synthMs: number) {
    const buffer = this.context.createBuffer(1, speech.audio.length, speech.sampleRate);
    buffer.copyToChannel(speech.audio as Float32Array<ArrayBuffer>, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    const startAt = Math.max(this.context.currentTime + 0.05, this.#nextStart);
    source.start(startAt);
    this.#nextStart = startAt + buffer.duration;
    this.#sources.add(source);
    source.onended = () => {
      if (!this.#sources.delete(source)) return;
      if (!this.busy) this.#events.onIdle?.();
    };
    const sentence = { text, words: speech.words, startAt, durationMs: buffer.duration * 1000, synthMs };
    const timer = setTimeout(
      () => {
        this.#timers.delete(timer);
        this.#events.onSentence?.(sentence);
      },
      Math.max(0, (startAt - this.context.currentTime) * 1000),
    );
    this.#timers.add(timer);
  }
}
