import { distance } from 'fastest-levenshtein';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MANUAL_VOCAB_FILE = 'hotwords.txt';
export const GENERATED_VOCAB_FILE = 'hotwords.generated.txt';

/** Parses a hotword file: one term per line, `#` starts a comment. */
export function parseVocabFile(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

/** Loads the hand-maintained list first (it has priority), then the generated one, de-duplicated. */
export function loadVocabulary(vocabDir: string): string[] {
  const terms: string[] = [];
  for (const file of [MANUAL_VOCAB_FILE, GENERATED_VOCAB_FILE]) {
    const path = join(vocabDir, file);
    if (existsSync(path)) terms.push(...parseVocabFile(readFileSync(path, 'utf8')));
  }
  return dedupe(terms);
}

function dedupe(terms: string[]): string[] {
  const seen = new Set<string>();
  return terms.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Builds the Whisper `prompt`. Whisper only looks at the last ~224 tokens of the prompt, and
 * identifiers tokenize poorly, so the list is capped by characters (highest-priority terms first).
 */
export function buildSttPrompt(terms: string[], maxChars = 600): string | undefined {
  if (terms.length === 0) return undefined;
  const prefix = 'Glossary: ';
  let prompt = prefix;
  for (const term of terms) {
    const next = prompt === prefix ? term : `, ${term}`;
    if (prompt.length + next.length > maxChars) break;
    prompt += next;
  }
  return prompt === prefix ? undefined : `${prompt}.`;
}

/** Terms worth correcting: identifiers that Whisper tends to split or misspell. */
export function isIdentifierLike(term: string): boolean {
  return (
    /[a-z][A-Z]/.test(term) ||
    /[A-Za-z]\d|\d[A-Za-z]/.test(term) ||
    /[_./-]/.test(term) ||
    /^[A-Z]{2,}$/.test(term)
  );
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Replaces misrecognized identifiers in a transcript with their vocabulary spelling, e.g.
 * "the invoice scheduler" -> "the InvoiceScheduler", "get user by id" -> "getUserByID".
 * Only identifier-like terms are considered, so ordinary words are never "corrected".
 */
export class VocabularyCorrector {
  #exact = new Map<string, string>();
  #byLength = new Map<number, Array<[string, string]>>();

  constructor(terms: string[]) {
    for (const term of terms) {
      if (!isIdentifierLike(term)) continue;
      const key = normalize(term);
      if (key.length < 4 || this.#exact.has(key)) continue;
      this.#exact.set(key, term);
      if (key.length >= 7) {
        const bucket = this.#byLength.get(key.length) ?? [];
        bucket.push([key, term]);
        this.#byLength.set(key.length, bucket);
      }
    }
  }

  get size(): number {
    return this.#exact.size;
  }

  correct(text: string): string {
    if (this.#exact.size === 0 || !text.trim()) return text;
    const tokens = text.split(/(\s+)/);
    const words = tokens.filter((_, i) => i % 2 === 0);
    const out: string[] = [];
    let i = 0;
    while (i < words.length) {
      let replaced = false;
      for (let n = Math.min(4, words.length - i); n >= 1; n--) {
        const window = words.slice(i, i + n);
        const key = normalize(window.join(''));
        if (key.length < 4) continue;
        const term = this.#lookup(key, n);
        if (!term) continue;
        const last = window[n - 1]!;
        const trailing = /[^\p{L}\p{N}]*$/u.exec(last)?.[0] ?? '';
        const leading = /^[^\p{L}\p{N}]*/u.exec(window[0]!)?.[0] ?? '';
        out.push(`${leading}${term}${trailing}`);
        i += n;
        replaced = true;
        break;
      }
      if (!replaced) {
        out.push(words[i]!);
        i++;
      }
    }
    return out.join(' ');
  }

  #lookup(key: string, wordCount: number): string | undefined {
    const exact = this.#exact.get(key);
    if (exact) return exact;
    // Fuzzy matching only for multi-word windows or long single words, to stay conservative.
    if (key.length < 7 || (wordCount === 1 && key.length < 10)) return undefined;
    const maxDist = key.length >= 14 ? 2 : 1;
    let best: string | undefined;
    let bestDist = maxDist + 1;
    for (let len = key.length - maxDist; len <= key.length + maxDist; len++) {
      for (const [candidate, term] of this.#byLength.get(len) ?? []) {
        // Same first and last character, so a neighbouring word is never swallowed ("on k8s-...").
        if (candidate[0] !== key[0] || candidate.at(-1) !== key.at(-1)) continue;
        const d = distance(key, candidate);
        if (d < bestDist) {
          best = term;
          bestDist = d;
        }
      }
    }
    return best;
  }
}

const CODE_SPAN_RE = /`([^`\n]{2,60})`/g;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const PATTERNS: RegExp[] = [
  /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, // camelCase
  /\b(?:[A-Z][a-z0-9]+){2,}\b/g, // PascalCase
  /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g, // snake_case
  /\b[A-Z][A-Z0-9]{1,7}\b/g, // acronyms like JWT, RS256
  /\b[\w-]+\.(?:ts|tsx|js|mjs|go|py|rs|java|kt|rb|cs|md|ya?ml|json|toml|hbs|sh|sql|proto)\b/g, // file names
  /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-[a-z]*\d[a-z0-9]*\b/g, // kebab names with digits: k8s-prod-eu1
];
const IGNORED_TERMS = new Set(['I', 'A', 'OK', 'US', 'EU', 'UTC', 'TODO', 'NOTE']);

/** Extracts candidate hotwords from markdown: code spans, identifiers, acronyms, file names and page names. */
export function extractTerms(markdown: string): string[] {
  const terms: string[] = [];
  for (const m of markdown.matchAll(CODE_SPAN_RE)) {
    const code = m[1]!.trim();
    if (!/\s/.test(code) && !/[(){};=<>]/.test(code)) terms.push(code);
  }
  for (const m of markdown.matchAll(WIKILINK_RE)) terms.push(m[1]!.trim());
  const prose = markdown.replace(/```[\s\S]*?```/g, ' ');
  for (const re of PATTERNS) {
    for (const m of prose.matchAll(re)) terms.push(m[0]);
  }
  return terms.filter((t) => t.length >= 2 && !IGNORED_TERMS.has(t));
}

/** Ranks terms by frequency (ties alphabetically) and returns the top `limit`, de-duplicated case-insensitively. */
export function rankTerms(terms: Iterable<string>, limit: number, exclude: Iterable<string> = []): string[] {
  const excluded = new Set([...exclude].map((t) => t.toLowerCase()));
  const counts = new Map<string, number>();
  for (const term of terms) {
    if (excluded.has(term.toLowerCase())) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term]) => term);
  return dedupe(ranked).slice(0, limit);
}
