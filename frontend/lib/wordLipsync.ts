/**
 * Word-timed lip-sync for the premium avatar. The agent sends the word timings of each TTS segment (usually a
 * sentence) over a text stream, ahead of the audio that arrives over WebRTC. There is no shared clock, so each segment
 * is anchored to the moment its audio is heard: the rise in loudness where the first word starts, or, when the audio
 * runs on without a pause, the end of the previous segment. Words become Oculus visemes (via TalkingHead's lip-sync
 * module) with overlapping attack/release envelopes, so the mouth moves through the sounds instead of flapping.
 */
import type { WordSegment, WordTiming } from './protocol';

export const VISEMES = ['PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'] as const;
export type Viseme = (typeof VISEMES)[number];
export type VisemeKey = `viseme_${Viseme}`;
export type VisemeShape = Record<VisemeKey | 'jawOpen', number>;

export const VISEME_KEYS = VISEMES.map((v) => `viseme_${v}` as VisemeKey);
export const REST: VisemeShape = Object.fromEntries(
  [...VISEME_KEYS, 'jawOpen'].map((k) => [k, 0]),
) as VisemeShape;

/** Output of TalkingHead's `LipsyncEn.wordsToVisemes`: visemes with times and durations in relative units. */
export interface WordVisemes {
  visemes: string[];
  times: number[];
  durations: number[];
}
export type WordsToVisemes = (word: string) => WordVisemes | undefined;

interface VisemeEvent {
  key: VisemeKey;
  start: number;
  peak: number;
  end: number;
  level: number;
}

/** How much each viseme opens the jaw; the viseme morphs do most of the work, this adds a little weight. */
const JAW: Partial<Record<Viseme, number>> = { aa: 0.25, O: 0.2, E: 0.12, I: 0.08, U: 0.08, RR: 0.06, TH: 0.05 };
const JAW_MAX = 0.2;

/**
 * Viseme envelopes for one word, the way TalkingHead's `speakAudio` builds them: the visemes are spread over the word
 * (at most 200 ms each), each rising before its sound and fading after it, so neighbours overlap.
 */
export function wordEvents(word: WordTiming, toVisemes: WordsToVisemes): VisemeEvent[] {
  const v = toVisemes(word.w);
  const n = v?.visemes.length ?? 0;
  if (!v || n === 0) return [];
  const total = v.times[n - 1]! + v.durations[n - 1]!;
  if (total <= 0) return [];
  const span = Math.max(0, word.e - word.s);
  const overdrive = Math.min(span, Math.max(0, span - n * 150));
  const level = 0.6 + (span > 0 ? (overdrive / span) * 0.4 : 0);
  const duration = Math.min(span, n * 200);
  const events: VisemeEvent[] = [];
  for (let j = 0; j < n; j++) {
    const viseme = v.visemes[j] as Viseme;
    if (!(VISEMES as readonly string[]).includes(viseme)) continue;
    const t = word.s + (v.times[j]! / total) * duration;
    const d = (v.durations[j]! / total) * duration;
    events.push({
      key: `viseme_${viseme}`,
      start: t - Math.min(60, (2 * d) / 3),
      peak: t + Math.min(25, d / 2),
      end: t + d + Math.min(60, d / 2),
      level: viseme === 'PP' || viseme === 'FF' ? 0.9 : level,
    });
  }
  return events;
}

const smoothstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function envelope(e: VisemeEvent, t: number): number {
  if (t <= e.start || t >= e.end) return 0;
  if (t < e.peak) return e.level * smoothstep((t - e.start) / Math.max(1, e.peak - e.start));
  return e.level * smoothstep((e.end - t) / Math.max(1, e.end - e.peak));
}

/** Mouth shape at `t` ms into a segment. */
export function shapeAt(events: readonly VisemeEvent[], t: number): VisemeShape {
  const shape = { ...REST };
  for (const e of events) {
    if (t <= e.start || t >= e.end) continue;
    shape[e.key] = Math.max(shape[e.key], envelope(e, t));
  }
  let jaw = 0;
  for (const v of VISEMES) jaw += (JAW[v] ?? 0.03) * shape[`viseme_${v}`];
  shape.jawOpen = Math.min(JAW_MAX, jaw);
  return shape;
}

interface Segment {
  id: string;
  words: WordTiming[];
  events: VisemeEvent[];
  final: boolean;
  durationMs?: number;
  receivedAt: number;
  /** Time at which the segment's audio starts; set once heard. */
  anchor?: number;
}

export interface WordLipSyncOptions {
  /** Level (RMS) above which audio counts as speech, and below which as silence. */
  onsetLevel?: number;
  releaseLevel?: number;
  /** Loudness detection lags the start of the first sound by about this much. */
  onsetLagMs?: number;
  /** A rise in loudness this long before the expected start of the next segment still belongs to it. */
  earlyOnsetMs?: number;
  /** Audio that runs on this long past a segment's expected start (no pause between sentences) anchors it there. */
  continuousAfterMs?: number;
  /** Words that arrive this soon after their audio started are still anchored to its start. */
  lateWordsMs?: number;
  /** How long after a segment the mouth stays at rest while waiting for the next one. */
  betweenMs?: number;
  /** Time constant of the final smoothing. */
  smoothingMs?: number;
  /** Segments that were never heard are dropped after this long. */
  staleMs?: number;
}

/** Follows the word timings of the agent's speech and turns them into mouth shapes. */
export class WordLipSync {
  #opts: Required<WordLipSyncOptions>;
  #toVisemes: WordsToVisemes;
  #queue: Segment[] = [];
  #loud = false;
  #riseAt: number | undefined;
  /** When the previous segment's audio ended, while segments follow each other. */
  #expected: number | undefined;
  #out: VisemeShape = { ...REST };

  constructor(toVisemes: WordsToVisemes, opts: WordLipSyncOptions = {}) {
    this.#toVisemes = toVisemes;
    this.#opts = {
      onsetLevel: 0.02,
      releaseLevel: 0.01,
      onsetLagMs: 20,
      earlyOnsetMs: 150,
      continuousAfterMs: 40,
      lateWordsMs: 300,
      betweenMs: 1000,
      smoothingMs: 30,
      staleMs: 30_000,
      ...opts,
    };
  }

  /** Segments not yet finished. */
  get pending(): number {
    return this.#queue.length;
  }

  /** Adds (a piece of) a segment's word timings. */
  add(update: WordSegment, now: number): void {
    let seg = this.#queue.find((s) => s.id === update.id);
    if (!seg) {
      if (update.final && update.words.length === 0 && !update.durationMs) return;
      seg = { id: update.id, words: [], events: [], final: false, receivedAt: now };
      this.#queue.push(seg);
    }
    for (const word of update.words) {
      seg.words.push(word);
      seg.events.push(...wordEvents(word, this.#toVisemes));
    }
    if (update.final) {
      seg.final = true;
      seg.durationMs = update.durationMs;
    }
  }

  /** Forgets all segments, e.g. when the speech was interrupted. */
  clear(): void {
    this.#queue = [];
    this.#expected = undefined;
    this.#riseAt = undefined;
  }

  /**
   * Advances to `now` (ms, e.g. `performance.now()`) given the current audio level (RMS). Returns the mouth shape,
   * or null when no segment is being heard, so the caller can fall back to loudness lip-sync.
   */
  update(now: number, level: number, dtMs: number): VisemeShape | null {
    this.#detectRise(now, level);
    const target = this.#target(now);
    if (!target) {
      this.#out = { ...REST };
      return null;
    }
    const alpha = 1 - Math.exp(-Math.max(0, dtMs) / this.#opts.smoothingMs);
    for (const key of Object.keys(target) as (keyof VisemeShape)[]) {
      this.#out[key] += (target[key] - this.#out[key]) * alpha;
    }
    return { ...this.#out };
  }

  #detectRise(now: number, level: number): void {
    if (this.#loud) {
      if (level < this.#opts.releaseLevel) this.#loud = false;
    } else if (level > this.#opts.onsetLevel) {
      this.#loud = true;
      this.#riseAt = now;
    }
  }

  #target(now: number): VisemeShape | null {
    const o = this.#opts;
    this.#queue = this.#queue.filter((s) => s.anchor !== undefined || now - s.receivedAt < o.staleMs);
    // A finished segment hands over to the next within one frame.
    for (let i = 0; i < 3; i++) {
      const seg = this.#queue[0];
      if (!seg) return this.#between(now);
      if (seg.anchor === undefined) {
        if (seg.final && seg.words.length === 0) {
          // Nothing to say (e.g. only punctuation): skip its audio.
          if (this.#expected !== undefined) this.#expected += seg.durationMs ?? 0;
          this.#queue.shift();
          continue;
        }
        const first = seg.words[0]?.s ?? 0;
        const expected = this.#expected;
        const rise = this.#riseAt;
        // A recent rise in loudness (the words may arrive just after their audio starts).
        if (rise !== undefined && now - rise < o.lateWordsMs && (expected === undefined || rise >= expected - o.earlyOnsetMs)) {
          seg.anchor = rise - first - o.onsetLagMs;
          this.#riseAt = undefined;
        } else if (this.#loud && expected !== undefined && now >= expected + first + o.continuousAfterMs) {
          // The audio ran on without a pause.
          seg.anchor = expected;
        } else {
          return this.#between(now);
        }
      }
      const t = now - seg.anchor;
      const lastEnd = seg.words.at(-1)?.e ?? 0;
      const done = seg.final ? t >= (seg.durationMs ?? lastEnd) : t >= lastEnd + 2000;
      if (done) {
        this.#expected = seg.anchor + (seg.final ? (seg.durationMs ?? lastEnd) : t);
        this.#riseAt = undefined;
        this.#queue.shift();
        continue;
      }
      return shapeAt(seg.events, t + o.smoothingMs);
    }
    return this.#between(now);
  }

  /** Just after a segment: keep the mouth at rest rather than switching to loudness lip-sync between sentences. */
  #between(now: number): VisemeShape | null {
    return this.#expected !== undefined && now - this.#expected < this.#opts.betweenMs ? { ...REST } : null;
  }
}
