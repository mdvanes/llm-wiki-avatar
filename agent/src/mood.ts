import type { StreamingTextFilter } from './textStream.ts';

export const MOODS = ['neutral', 'happy', 'sad', 'confused'] as const;
export type Mood = (typeof MOODS)[number];

const SYNONYMS: Record<string, Mood> = {
  neutral: 'neutral',
  calm: 'neutral',
  happy: 'happy',
  glad: 'happy',
  joyful: 'happy',
  excited: 'happy',
  positive: 'happy',
  cheerful: 'happy',
  sad: 'sad',
  sorry: 'sad',
  apologetic: 'sad',
  negative: 'sad',
  confused: 'confused',
  unsure: 'confused',
  uncertain: 'confused',
  puzzled: 'confused',
  thinking: 'confused',
};

export function normalizeMood(value: string): Mood {
  return SYNONYMS[value.trim().toLowerCase()] ?? 'neutral';
}

const TAG_RE = /^\[\s*mood\s*:\s*([\p{L}_-]+)\s*\]/iu;
const PREFIX = '[mood:';
const MAX_TAG_LENGTH = 32;

/**
 * Removes `[mood:x]` tags from streamed LLM text and reports each mood.
 * Tags may be split across chunks, so a possible tag start is held back until it can be decided.
 */
export class MoodFilter implements StreamingTextFilter {
  #pending = '';
  #skipWhitespace = false;
  #onMood: ((mood: Mood) => void) | undefined;

  constructor(onMood?: (mood: Mood) => void) {
    this.#onMood = onMood;
  }

  push(chunk: string): string {
    let text = this.#pending + chunk;
    this.#pending = '';
    let out = '';
    while (text) {
      const idx = text.indexOf('[');
      if (idx < 0) {
        out += this.#emit(text);
        break;
      }
      out += this.#emit(text.slice(0, idx));
      const rest = text.slice(idx);
      const match = TAG_RE.exec(rest);
      if (match) {
        this.#onMood?.(normalizeMood(match[1]!));
        this.#skipWhitespace = true;
        text = rest.slice(match[0].length);
        continue;
      }
      if (isPossibleTagStart(rest)) {
        this.#pending = rest;
        break;
      }
      out += this.#emit('[');
      text = rest.slice(1);
    }
    return out;
  }

  flush(): string {
    const pending = this.#pending;
    this.#pending = '';
    // An unfinished "[mood:..." at the very end is a truncated tag, not content.
    if (pending.toLowerCase().replace(/\s/g, '').startsWith(PREFIX)) return '';
    return this.#emit(pending);
  }

  #emit(text: string): string {
    if (!this.#skipWhitespace) return text;
    const trimmed = text.replace(/^\s+/, '');
    if (trimmed) this.#skipWhitespace = false;
    return trimmed;
  }
}

function isPossibleTagStart(text: string): boolean {
  if (text.length > MAX_TAG_LENGTH || text.includes(']')) return false;
  const compact = text.toLowerCase().replace(/\s/g, '');
  if (compact.length <= PREFIX.length) return PREFIX.startsWith(compact);
  return compact.startsWith(PREFIX) && /^[\p{L}_-]*$/u.test(compact.slice(PREFIX.length));
}

/** Strips all mood tags from a complete string, returning the text and the last mood found. */
export function extractMood(text: string): { text: string; mood: Mood | undefined } {
  let mood: Mood | undefined;
  const filter = new MoodFilter((m) => (mood = m));
  const out = filter.push(text) + filter.flush();
  return { text: out, mood };
}
