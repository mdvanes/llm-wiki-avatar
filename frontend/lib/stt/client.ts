import type { LoadSpec } from './models';

export type SttRequest = { id: number } & (
  | { type: 'load'; spec: LoadSpec }
  | { type: 'download'; spec: LoadSpec }
  | { type: 'check'; specs: Record<string, LoadSpec> }
  | { type: 'transcribe'; audio: Float32Array; language: string }
);

export type SttResponse =
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'done'; id: number; text?: string; cached?: Record<string, boolean> }
  | { type: 'error'; id: number; message: string };

type Done = Extract<SttResponse, { type: 'done' }>;
type Progress = (loaded: number, total: number) => void;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface Pending {
  resolve: (done: Done) => void;
  reject: (err: Error) => void;
  onProgress?: Progress;
}

/** Talks to the speech-to-text Web Worker, which runs Whisper off the main thread. */
export class SttClient {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  #next = 1;

  constructor() {
    this.#worker = new Worker(new URL('../../workers/stt.worker.ts', import.meta.url), { type: 'module' });
    this.#worker.onmessage = ({ data }: MessageEvent<SttResponse>) => {
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

  #send(request: DistributiveOmit<SttRequest, 'id'>, onProgress?: Progress): Promise<Done> {
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

  /** Loads the model for transcribing, downloading what is not cached yet. */
  async load(spec: LoadSpec, onProgress?: Progress): Promise<void> {
    await this.#send({ type: 'load', spec }, onProgress);
  }

  /** Fills the browser cache with the model's files without keeping it in memory. */
  async download(spec: LoadSpec, onProgress?: Progress): Promise<void> {
    await this.#send({ type: 'download', spec }, onProgress);
  }

  /** Per key: whether all files of that model are in the browser cache. */
  async check(specs: Record<string, LoadSpec>): Promise<Record<string, boolean>> {
    return (await this.#send({ type: 'check', specs })).cached ?? {};
  }

  /** 16 kHz mono audio in, text out. */
  async transcribe(audio: Float32Array, language: string): Promise<string> {
    return (await this.#send({ type: 'transcribe', audio, language })).text ?? '';
  }

  terminate(): void {
    this.#worker.terminate();
    this.#failAll(new DOMException('speech worker stopped', 'AbortError'));
  }
}
