import type { WordTiming } from '@/lib/wordLipsync';
import type { VoiceSpec } from './voices';

export interface Speech {
  audio: Float32Array;
  sampleRate: number;
  /** Word timings in ms from the start of `audio`, for voices that have them. */
  words?: WordTiming[];
}

export type TtsRequest = { id: number } & (
  | { type: 'download'; spec: VoiceSpec }
  | { type: 'load'; spec: VoiceSpec }
  | { type: 'synthesize'; spec: VoiceSpec; text: string; speed: number }
);

export type TtsResponse =
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'done'; id: number; speech?: Speech }
  | { type: 'error'; id: number; message: string };

type Done = Extract<TtsResponse, { type: 'done' }>;
type Progress = (loaded: number, total: number) => void;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface Pending {
  resolve: (done: Done) => void;
  reject: (err: Error) => void;
  onProgress?: Progress;
}

/** Talks to the text-to-speech Web Worker. */
export class TtsClient {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  #next = 1;

  constructor() {
    this.#worker = new Worker(new URL('../../workers/tts.worker.ts', import.meta.url), { type: 'module' });
    this.#worker.onmessage = ({ data }: MessageEvent<TtsResponse>) => {
      const pending = this.#pending.get(data.id);
      if (!pending) return;
      if (data.type === 'progress') {
        pending.onProgress?.(data.loaded, data.total);
        return;
      }
      this.#pending.delete(data.id);
      if (data.type === 'done') pending.resolve(data);
      else pending.reject(new Error(data.message));
    };
    this.#worker.onerror = (event) => this.#failAll(new Error(event.message || 'speech worker crashed'));
  }

  #send(request: DistributiveOmit<TtsRequest, 'id'>, onProgress?: Progress): Promise<Done> {
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onProgress });
      this.#worker.postMessage({ ...request, id });
    });
  }

  #failAll(err: Error): void {
    for (const pending of this.#pending.values()) pending.reject(err);
    this.#pending.clear();
  }

  /** Fills the browser cache with the voice's files. */
  async download(spec: VoiceSpec, onProgress?: Progress): Promise<void> {
    await this.#send({ type: 'download', spec }, onProgress);
  }

  /** Loads the voice and runs it once, so the first sentence is not slowed down by the set-up. */
  async load(spec: VoiceSpec): Promise<void> {
    await this.#send({ type: 'load', spec });
  }

  async synthesize(spec: VoiceSpec, text: string, speed = 1): Promise<Speech> {
    const { speech } = await this.#send({ type: 'synthesize', spec, text, speed });
    if (!speech) throw new Error('no speech returned');
    return speech;
  }

  terminate(): void {
    this.#worker.terminate();
    this.#failAll(new DOMException('speech worker stopped', 'AbortError'));
  }
}
