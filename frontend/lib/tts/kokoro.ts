/**
 * Kokoro text handling: English text normalization and phoneme clean-up ported from kokoro-js
 * (https://github.com/hexgrad/kokoro, Apache-2.0), and word timings from the timestamped model's durations.
 */
import type { WordTiming } from '@/lib/wordLipsync';

export const KOKORO_SAMPLE_RATE = 24_000;
/** Kokoro's context is 512 tokens, including the padding at both ends. */
export const KOKORO_MAX_PHONEMES = 510;
/** One duration frame is 600 samples at 24 kHz. */
const MS_PER_FRAME = 25;

function splitNum(match: string): string {
  if (match.includes('.')) return match;
  if (match.includes(':')) {
    const [h, m] = match.split(':').map(Number) as [number, number];
    if (m === 0) return `${h} o'clock`;
    if (m < 10) return `${h} oh ${m}`;
    return `${h} ${m}`;
  }
  const year = Number.parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return match;
  const left = match.slice(0, 2);
  const right = Number.parseInt(match.slice(2, 4), 10);
  const suffix = match.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${suffix}`;
    if (right < 10) return `${left} oh ${right}${suffix}`;
  }
  return `${left} ${right}${suffix}`;
}

function flipMoney(match: string): string {
  const bill = match[0] === '$' ? 'dollar' : 'pound';
  const amount = match.slice(1);
  if (Number.isNaN(Number(amount))) return `${amount} ${bill}s`;
  if (!match.includes('.')) return `${amount} ${bill}${amount === '1' ? '' : 's'}`;
  const [b, c] = amount.split('.') as [string, string];
  const d = Number.parseInt(c.padEnd(2, '0'), 10);
  const coins = match[0] === '$' ? (d === 1 ? 'cent' : 'cents') : d === 1 ? 'penny' : 'pence';
  return `${b} ${bill}${b === '1' ? '' : 's'} and ${d} ${coins}`;
}

function pointNum(match: string): string {
  const [a, b] = match.split('.') as [string, string];
  return `${a} point ${b.split('').join(' ')}`;
}

/** Spells out what eSpeak reads poorly: times, years, money, decimals, abbreviations. */
export function normalizeEnglish(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .replace(/[“”]/g, '"')
    .replace(/\(/g, '«')
    .replace(/\)/g, '»')
    .replace(/[^\S \n]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

/** Adapts eSpeak's American English phonemes to Kokoro's vocabulary. */
export function kokoroPhonemes(espeak: string): string {
  return (
    espeak
      // eSpeak runs sentences together; Kokoro expects a space after the punctuation.
      .replace(/([.!?…])(?=[^\s.!?…])/g, '$1 ')
      .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
      .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
      .replace(/ʲ/g, 'j')
      .replace(/r/g, 'ɹ')
      .replace(/x/g, 'k')
      .replace(/ɬ/g, 'l')
      .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
      .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')
      .replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
      .trim()
  );
}

const PUNCTUATION = new Set(';:,.!?¡¿—…"«»“”(){}[]');

/**
 * Word timings (in ms) from the model's per-token durations (in frames): `durations[0]` is the start padding and
 * `durations[i + 1]` belongs to the i-th phoneme. Words are the phoneme words; pauses at punctuation are left out.
 */
export function kokoroWordTimings(phonemes: string, durations: ArrayLike<number>): WordTiming[] {
  const chars = [...phonemes];
  if (durations.length < chars.length + 1) return [];
  const words: WordTiming[] = [];
  let word: WordTiming | undefined;
  let frames = Number(durations[0]);
  const at = (f: number) => Math.round(f * MS_PER_FRAME);
  chars.forEach((c, i) => {
    const d = Number(durations[i + 1]);
    if (c === ' ' || PUNCTUATION.has(c)) {
      if (word) words.push(word);
      word = undefined;
    } else {
      word ??= { w: '', s: at(frames), e: 0 };
      word.w += c;
      word.e = at(frames + d);
    }
    frames += d;
  });
  if (word) words.push(word);
  return words;
}
