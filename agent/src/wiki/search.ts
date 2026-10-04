import MiniSearch, { type SearchResult } from 'minisearch';
import type { WikiPage, WikiStore } from './store.ts';

export interface SearchHit {
  sourceId: string;
  sourceName: string;
  path: string;
  title: string;
  score: number;
  snippet: string;
}

// Filler words in English and Dutch, so spoken questions don't match every page.
const STOPWORDS = new Set(
  (
    'a an and are as at be but by can could do does did for from has have how i if in into is it its ' +
    'me my of on or our please so tell that the their them then there these this to us was we what ' +
    'when where which who why will with would you your about explain know show give ' +
    'de het een en of is zijn was waren wat wie waar wanneer hoe waarom welke die dat dit deze ' +
    'ik je jij u we wij ze zij hij mij mijn jouw uw ons onze van voor met op in aan bij om te ' +
    'naar uit over door kan kun kunt kunnen moet moeten wordt worden er ook niet geen maar dan ' +
    'nog al me mij eens even graag vertel uitleggen leg'
  ).split(/\s+/),
);

const WORD_RE = /[\p{L}\p{N}_][\p{L}\p{N}_.\-/]*[\p{L}\p{N}_]|[\p{L}\p{N}_]/gu;

/** Splits text into search tokens; identifiers like `getUserByID` or `k8s-prod-eu1` also yield their parts. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    tokens.push(word);
    const parts = word
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_.\-/]+/)
      .filter(Boolean);
    if (parts.length > 1) tokens.push(...parts);
  }
  return tokens;
}

function processTerm(term: string): string | null {
  const t = term.toLowerCase();
  if (t.length < 2 || STOPWORDS.has(t)) return null;
  return t;
}

interface IndexedDoc {
  id: string;
  title: string;
  headings: string;
  content: string;
}

export class WikiSearch {
  #store: WikiStore;
  #index!: MiniSearch<IndexedDoc>;
  #logIds = new Set<string>();

  constructor(store: WikiStore) {
    this.#store = store;
    this.rebuild();
  }

  rebuild(): void {
    // index.md and log.md mention everything briefly; prefer the pages that explain it.
    const indexes = this.#store.indexes();
    const logs = this.#store.logs();
    const meta = new Set([...indexes, ...logs].map((page) => `${page.sourceId}:${page.path}`));
    this.#logIds = new Set(logs.map((page) => `${page.sourceId}:${page.path}`));
    const index = new MiniSearch<IndexedDoc>({
      fields: ['title', 'headings', 'content'],
      storeFields: ['title'],
      tokenize,
      processTerm,
      searchOptions: {
        boost: { title: 4, headings: 2 },
        prefix: (term) => term.length > 3,
        fuzzy: (term) => (term.length > 5 ? 0.2 : false),
        combineWith: 'OR',
        boostDocument: (id) => (meta.has(id) ? 0.4 : 1),
      },
    });
    index.addAll(
      this.#store.pages().map((p) => ({
        id: `${p.sourceId}:${p.path}`,
        title: p.title,
        headings: p.headings.join('\n'),
        content: p.content,
      })),
    );
    this.#index = index;
  }

  search(query: string, limit = 5, snippetChars = 320): SearchHit[] {
    const results = this.#index.search(query);
    const hits: SearchHit[] = [];
    for (const result of results.slice(0, limit)) {
      const page = this.#store.resolve(result.id);
      if (!page) continue;
      hits.push({
        sourceId: page.sourceId,
        sourceName: page.sourceName,
        path: page.path,
        title: page.title,
        score: Math.round(result.score * 100) / 100,
        // The log is newest-first, so its most useful excerpt is the top, not the best keyword match.
        snippet: this.#logIds.has(`${page.sourceId}:${page.path}`)
          ? leadingSnippet(page, snippetChars)
          : bestSnippet(page, result, snippetChars),
      });
    }
    return hits;
  }
}

/** The start of a page (without its title), flattened and trimmed to `maxChars`. */
export function leadingSnippet(page: WikiPage, maxChars: number): string {
  const flat = page.content.replace(/^#\s.*\n/, '').replace(/\s+/g, ' ').trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars)}…`;
}

/**
 * Picks the paragraphs that contain the most matched terms, then fills any room left with the
 * other paragraphs, and returns them in page order. A hit shows the passage that answers the
 * question, and short pages are shown whole (the answer may use words the question did not,
 * e.g. a Dutch question about an English page).
 */
export function bestSnippet(
  page: WikiPage,
  result: Pick<SearchResult, 'terms'>,
  maxChars: number,
): string {
  const terms = result.terms.map((t) => t.toLowerCase());
  const paragraphs = page.content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    // Skip paragraphs that are just a heading line.
    .filter((p) => p && !(/^#{1,6}\s/.test(p) && !p.includes('\n')))
    .map((p, index) => ({ index, text: p.replace(/\s+/g, ' ') }))
    .map((p) => ({ ...p, score: terms.reduce((acc, t) => acc + (p.text.toLowerCase().includes(t) ? 1 : 0), 0) }));
  if (paragraphs.length === 0) return '';
  const ranked = [...paragraphs].sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: typeof paragraphs = [];
  let used = 0;
  for (const p of ranked) {
    if (picked.length > 0 && used + p.text.length + 3 > maxChars) continue;
    picked.push(p);
    used += p.text.length + 3;
  }
  picked.sort((a, b) => a.index - b.index);
  const text = picked.map((p) => p.text).join(' … ');
  if (text.length <= maxChars) return text;
  // A single long paragraph: centre the window on the first matched term.
  const lower = text.toLowerCase();
  const firstHit = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0), Number.MAX_SAFE_INTEGER);
  const start = firstHit === Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, firstHit - Math.floor(maxChars / 4));
  return `${start > 0 ? '…' : ''}${text.slice(start, start + maxChars)}${start + maxChars < text.length ? '…' : ''}`;
}
