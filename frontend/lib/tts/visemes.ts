import type { WordVisemes } from '@/lib/wordLipsync';

/** Oculus visemes for the IPA symbols eSpeak uses for English (Kokoro's phonemes). */
const VISEME: Record<string, string> = {
  p: 'PP', b: 'PP', m: 'PP',
  f: 'FF', v: 'FF',
  θ: 'TH', ð: 'TH',
  t: 'DD', d: 'DD', ɾ: 'DD',
  k: 'kk', g: 'kk', ɡ: 'kk', ŋ: 'kk', h: 'kk',
  ʃ: 'CH', ʒ: 'CH', ʧ: 'CH', ʤ: 'CH', j: 'I',
  s: 'SS', z: 'SS',
  n: 'nn', l: 'nn', ɫ: 'nn',
  ɹ: 'RR', r: 'RR', ɚ: 'RR', ɝ: 'RR',
  a: 'aa', ɑ: 'aa', æ: 'aa', ʌ: 'aa', ɐ: 'aa', ɒ: 'O',
  e: 'E', ɛ: 'E', ə: 'E', ɜ: 'E',
  i: 'I', ɪ: 'I', ᵻ: 'I',
  o: 'O', ɔ: 'O',
  u: 'U', ʊ: 'U', w: 'U',
}; // prettier-ignore

const VOWELS = new Set(['aa', 'E', 'I', 'O', 'U']);

/** Visemes of one IPA word with relative timing; vowels take a little longer than consonants. */
export function ipaToVisemes(word: string): WordVisemes | undefined {
  const visemes: string[] = [];
  const times: number[] = [];
  const durations: number[] = [];
  let t = 0;
  for (const symbol of word) {
    const viseme = VISEME[symbol];
    if (!viseme) continue;
    const duration = VOWELS.has(viseme) ? 1.4 : 1;
    if (visemes.at(-1) === viseme) {
      durations[durations.length - 1]! += duration;
    } else {
      visemes.push(viseme);
      times.push(t);
      durations.push(duration);
    }
    t += duration;
  }
  return visemes.length > 0 ? { visemes, times, durations } : undefined;
}
