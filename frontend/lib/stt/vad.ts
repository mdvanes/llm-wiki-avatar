import { SPEECH_RMS } from './audio';

export interface VadOptions {
  /** Loud for this long before an utterance counts as started. */
  startMs: number;
  /** Silence this long ends the utterance. */
  endMs: number;
  /** Utterances with less speech than this are noise (a cough, a door). */
  minMs: number;
  /** Utterances are cut here; Whisper works on 30 s windows. */
  maxMs: number;
  /** Audio kept from before the start, so the first syllable is not lost. */
  preRollMs: number;
  /** The lowest level that counts as speech. */
  minRms: number;
  /** Speech must be this many times louder than the background noise. */
  noiseFactor: number;
}

export const DEFAULT_VAD: VadOptions = {
  startMs: 150,
  endMs: 900,
  minMs: 400,
  maxMs: 30_000,
  preRollMs: 300,
  minRms: SPEECH_RMS,
  noiseFactor: 3,
};

export type VadEvent = { type: 'start' } | { type: 'end'; samples: Float32Array } | { type: 'discard' };

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

/** Splits a continuous microphone stream into utterances, with a threshold that adapts to background noise (a car). */
export class Vad {
  readonly #sampleRate: number;
  readonly #opts: VadOptions;
  #floor = 0;
  #ring: { frame: Float32Array; ms: number }[] = [];
  #ringMs = 0;
  #loudMs = 0;
  #speaking = false;
  #utterance: Float32Array[] = [];
  #totalMs = 0;
  #silenceMs = 0;

  constructor(sampleRate: number, opts: Partial<VadOptions> = {}) {
    this.#sampleRate = sampleRate;
    this.#opts = { ...DEFAULT_VAD, ...opts };
  }

  get speaking(): boolean {
    return this.#speaking;
  }

  /** The level above which a frame counts as speech. */
  get threshold(): number {
    return Math.max(this.#opts.minRms, this.#floor * this.#opts.noiseFactor);
  }

  /** Drops what was heard so far, e.g. after a pause in which the microphone was ignored. */
  reset(): void {
    this.#ring = [];
    this.#ringMs = 0;
    this.#loudMs = 0;
    this.#speaking = false;
    this.#utterance = [];
    this.#totalMs = 0;
    this.#silenceMs = 0;
  }

  push(frame: Float32Array): VadEvent | undefined {
    const ms = (frame.length / this.#sampleRate) * 1000;
    const level = rms(frame);
    const loud = level > this.threshold;
    return this.#speaking ? this.#whileSpeaking(frame, ms, loud) : this.#whileIdle(frame, ms, loud, level);
  }

  #whileIdle(frame: Float32Array, ms: number, loud: boolean, level: number): VadEvent | undefined {
    const { startMs, preRollMs } = this.#opts;
    this.#ring.push({ frame, ms });
    this.#ringMs += ms;
    while (this.#ring.length > 1 && this.#ringMs - this.#ring[0]!.ms >= preRollMs + startMs) {
      this.#ringMs -= this.#ring.shift()!.ms;
    }
    if (!loud) {
      this.#loudMs = 0;
      // Quiet frames steer the background level slowly; capped so steady loud noise cannot lock the threshold.
      this.#floor = Math.min(0.05, this.#floor * 0.95 + level * 0.05);
      return undefined;
    }
    this.#loudMs += ms;
    if (this.#loudMs < startMs) return undefined;
    this.#speaking = true;
    this.#utterance = this.#ring.map((r) => r.frame);
    this.#totalMs = this.#ringMs;
    this.#silenceMs = 0;
    this.#ring = [];
    this.#ringMs = 0;
    return { type: 'start' };
  }

  #whileSpeaking(frame: Float32Array, ms: number, loud: boolean): VadEvent | undefined {
    this.#utterance.push(frame);
    this.#totalMs += ms;
    this.#silenceMs = loud ? 0 : this.#silenceMs + ms;
    const { endMs, minMs, maxMs } = this.#opts;
    if (this.#silenceMs < endMs && this.#totalMs < maxMs) return undefined;
    const spoken = this.#totalMs - this.#silenceMs;
    const chunks = this.#utterance;
    this.reset();
    if (spoken < minMs) return { type: 'discard' };
    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    return { type: 'end', samples };
  }
}
