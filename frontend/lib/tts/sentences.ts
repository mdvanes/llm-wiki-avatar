/** Longest piece of text synthesized at once; Kokoro's context fits about this much English. */
export const MAX_SENTENCE = 250;

const BOUNDARY = /([.!?…]+)(["'”’)\]]*)\s+|\n\s*/g;
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|bijv|d\.w\.z|o\.a|ca|nr)\.$/i;
const LIST_NUMBER = /(?:^|\n)\s*\d+\.$/;

/** Where the first complete sentence of `text` ends (after its trailing space), or -1. */
export function sentenceEnd(text: string): number {
  for (const m of text.matchAll(BOUNDARY)) {
    const before = text.slice(0, m.index + 1);
    if (m[1] === '.' && (ABBREVIATION.test(before) || LIST_NUMBER.test(before))) continue;
    return m.index + m[0].length;
  }
  return -1;
}

/** Splits text that is too long for one synthesis at a comma, or else at a space. */
export function limitLength(sentence: string, max = MAX_SENTENCE): string[] {
  const parts: string[] = [];
  let rest = sentence.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(', ', max);
    if (cut < max / 3) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max - 1;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Cuts streamed text into sentences, so speech can start before the whole reply is there. */
export class SentenceSplitter {
  #buffer = '';

  /** Adds text; returns the sentences completed by it. */
  push(text: string): string[] {
    this.#buffer += text;
    const sentences: string[] = [];
    for (let end = sentenceEnd(this.#buffer); end >= 0; end = sentenceEnd(this.#buffer)) {
      sentences.push(...limitLength(this.#buffer.slice(0, end)));
      this.#buffer = this.#buffer.slice(end);
    }
    if (this.#buffer.length > MAX_SENTENCE * 2) {
      const parts = limitLength(this.#buffer);
      this.#buffer = parts.pop() ?? '';
      sentences.push(...parts);
    }
    return sentences;
  }

  /** Returns what is left at the end of the text. */
  flush(): string[] {
    const rest = limitLength(this.#buffer);
    this.#buffer = '';
    return rest;
  }
}

/** All sentences of a complete text. */
export function splitSentences(text: string): string[] {
  const splitter = new SentenceSplitter();
  return [...splitter.push(text), ...splitter.flush()];
}
