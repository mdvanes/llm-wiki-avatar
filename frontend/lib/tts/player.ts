import type { WordTiming } from '@/lib/protocol';
import type { WordListener, WordSource } from '@/lib/wordLipsync';
import type { Speech, TtsClient } from './client';
import { SentenceSplitter } from './sentences';
import type { VoiceSpec } from './voices';

/** `preparing`: text is waiting to be spoken, but nothing is playing yet. */
export type PlayerState = 'idle' | 'preparing' | 'playing';

export interface PlayedSentence<M> {
  text: string;
  meta?: M;
  words?: WordTiming[];
  /** AudioContext time at which the sentence starts playing. */
  startAt: number;
  durationMs: number;
  synthMs: number;
}

export interface SpeechPlayerEvents<M> {
  /** A sentence starts playing. */
  onSentence?: (sentence: PlayedSentence<M>) => void;
  onState?: (state: PlayerState) => void;
  onError?: (err: unknown) => void;
}

interface Item<M> {
  text: string;
  meta?: M;
}

/**
 * Speaks text sentence by sentence: synthesizes the next sentence while the current one plays, so speech can start
 * as soon as the first sentence is complete. `track` carries the voice for the avatar's lip-sync; sentences with word
 * timings are passed on to word subscribers with the moment they are heard.
 */
export class SpeechPlayer<M = unknown> implements WordSource {
  readonly context = new AudioContext();
  readonly analyser = this.context.createAnalyser();
  readonly track: MediaStreamTrack;
  readonly #client: TtsClient;
  readonly #events: SpeechPlayerEvents<M>;
  #spec: VoiceSpec | undefined;
  #splitter = new SentenceSplitter();
  #queue: Item<M>[] = [];
  #epoch = 0;
  #synthesizing = false;
  #nextStart = 0;
  #state: PlayerState = 'idle';
  #segments = 0;
  readonly #sources = new Set<AudioBufferSourceNode>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #wordListeners = new Set<WordListener>();

  constructor(client: TtsClient, events: SpeechPlayerEvents<M> = {}) {
    this.#client = client;
    this.#events = events;
    this.analyser.fftSize = 1024;
    this.analyser.connect(this.context.destination);
    const stream = this.context.createMediaStreamDestination();
    this.analyser.connect(stream);
    this.track = stream.stream.getAudioTracks()[0]!;
  }

  get state(): PlayerState {
    return this.#state;
  }

  setVoice(spec: VoiceSpec | undefined): void {
    this.#spec = spec;
  }

  subscribe(listener: WordListener): () => void {
    this.#wordListeners.add(listener);
    return () => this.#wordListeners.delete(listener);
  }

  /** Speaks sentences that are already split. */
  enqueue(items: Item<M>[]): void {
    if (items.length === 0) return;
    void this.context.resume();
    this.#queue.push(...items);
    if (!this.#synthesizing) void this.#pump(this.#epoch);
    this.#updateState();
  }

  /** Adds streamed text; complete sentences are spoken right away. */
  push(text: string): void {
    this.enqueue(this.#splitter.push(text).map((sentence) => ({ text: sentence })));
  }

  /** Speaks what is left of the streamed text. */
  end(): void {
    this.enqueue(this.#splitter.flush().map((sentence) => ({ text: sentence })));
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
    for (const listener of this.#wordListeners) listener(null);
    this.#updateState();
  }

  close(): void {
    this.stop();
    this.track.stop();
    void this.context.close();
  }

  #updateState(): void {
    const state: PlayerState =
      this.#sources.size > 0 ? 'playing' : this.#synthesizing || this.#queue.length > 0 ? 'preparing' : 'idle';
    if (state === this.#state) return;
    this.#state = state;
    this.#events.onState?.(state);
  }

  async #pump(epoch: number): Promise<void> {
    this.#synthesizing = true;
    try {
      while (epoch === this.#epoch && this.#queue.length > 0) {
        const item = this.#queue.shift()!;
        const spec = this.#spec;
        if (!spec) throw new Error('no voice selected');
        const started = performance.now();
        const speech = await this.#client.synthesize(spec, item.text);
        if (epoch !== this.#epoch) return;
        if (speech.audio.length > 0) this.#play(item, speech, performance.now() - started);
      }
    } catch (err) {
      if (epoch === this.#epoch) {
        this.stop();
        this.#events.onError?.(err);
      }
      return;
    } finally {
      if (epoch === this.#epoch) {
        this.#synthesizing = false;
        this.#updateState();
      }
    }
  }

  #play(item: Item<M>, speech: Speech, synthMs: number) {
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
      if (this.#sources.delete(source)) this.#updateState();
    };
    this.#updateState();

    const durationMs = buffer.duration * 1000;
    if (speech.words?.length) {
      const latency = this.context.outputLatency || this.context.baseLatency || 0;
      const startsAt = performance.now() + (startAt - this.context.currentTime + latency) * 1000;
      const segment = { id: `speech-${++this.#segments}`, words: speech.words, final: true, durationMs };
      for (const listener of this.#wordListeners) listener({ segment, startsAt });
    }
    const sentence = { text: item.text, meta: item.meta, words: speech.words, startAt, durationMs, synthMs };
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
