/**
 * Tier 0 lip-sync: turns the loudness and rough spectral shape of the agent's audio into mouth
 * shapes (Oculus visemes + ARKit jawOpen). It is language-independent, which suits English and
 * Dutch alike, and needs nothing from the TTS but the audio itself.
 */
export interface MouthShape {
  jawOpen: number;
  viseme_aa: number;
  viseme_O: number;
  viseme_E: number;
  viseme_U: number;
}

export const CLOSED: MouthShape = { jawOpen: 0, viseme_aa: 0, viseme_O: 0, viseme_E: 0, viseme_U: 0 };

export interface LipSyncOptions {
  /** RMS below this is treated as silence. */
  noiseFloor?: number;
  /** Scales RMS above the floor to a 0..1 mouth opening. */
  gain?: number;
  /** Time constants in ms: how fast the mouth opens and closes. */
  attackMs?: number;
  releaseMs?: number;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/**
 * Share of energy in the "bright" band (1.5-4 kHz: e, i, s) versus the "dark" band
 * (200-900 Hz: o, u). Returns 0.5 when there is no energy.
 */
export function brightness(freq: Uint8Array, sampleRate: number): number {
  const binHz = sampleRate / 2 / freq.length;
  const band = (lo: number, hi: number) => {
    let sum = 0;
    for (let i = Math.floor(lo / binHz); i <= Math.min(freq.length - 1, Math.ceil(hi / binHz)); i++) sum += freq[i]!;
    return sum;
  };
  const dark = band(200, 900);
  const bright = band(1500, 4000);
  return dark + bright === 0 ? 0.5 : bright / (dark + bright);
}

export class LipSync {
  #level = 0;
  #tone = 0.5;
  #opts: Required<LipSyncOptions>;

  constructor(opts: LipSyncOptions = {}) {
    this.#opts = { noiseFloor: 0.008, gain: 7, attackMs: 40, releaseMs: 90, ...opts };
  }

  get level(): number {
    return this.#level;
  }

  /** Feed one analysis frame; `dtMs` is the time since the previous frame. */
  update(level: number, tone: number, dtMs: number): MouthShape {
    const { noiseFloor, gain, attackMs, releaseMs } = this.#opts;
    const target = Math.min(1, Math.max(0, (level - noiseFloor) * gain));
    const tau = target > this.#level ? attackMs : releaseMs;
    const alpha = 1 - Math.exp(-Math.max(0, dtMs) / tau);
    this.#level += (target - this.#level) * alpha;
    this.#tone += (tone - this.#tone) * (1 - Math.exp(-Math.max(0, dtMs) / 120));
    return this.shape();
  }

  shape(): MouthShape {
    const open = this.#level < 0.02 ? 0 : Math.sqrt(this.#level);
    if (open === 0) return CLOSED;
    const t = this.#tone;
    return {
      jawOpen: open * 0.35,
      viseme_aa: open * 0.6 * (1 - Math.abs(t - 0.5)),
      viseme_O: open * 0.7 * Math.max(0, 0.55 - t) * 2,
      viseme_U: open * 0.3 * Math.max(0, 0.4 - t) * 2.5,
      viseme_E: open * 0.6 * Math.max(0, t - 0.45) * 2,
    };
  }

  reset(): void {
    this.#level = 0;
    this.#tone = 0.5;
  }
}
