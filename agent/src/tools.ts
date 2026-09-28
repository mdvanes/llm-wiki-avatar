import { llm } from '@livekit/agents';
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Publisher, Source } from './publisher.ts';
import type { WikiPage } from './wiki/store.ts';
import type { Wiki } from './wiki/wiki.ts';

export interface ToolDeps {
  wiki: Wiki;
  cfg: Pick<Config, 'WIKI_PAGE_MAX_CHARS'>;
  publisher: Publisher;
  /** Collects sources used in the current turn so the UI can list them. */
  sources: SourceTracker;
}

/** Tracks which pages were used for the current user turn. */
export class SourceTracker {
  #turn = 0;
  #sources = new Map<string, Source>();
  #shown = false;
  #publisher: Publisher;

  constructor(publisher: Publisher) {
    this.#publisher = publisher;
  }

  newTurn(): void {
    this.#turn++;
    this.#sources.clear();
    this.#shown = false;
  }

  /** Whether showOnScreen was used in the current turn. */
  get shown(): boolean {
    return this.#shown;
  }

  markShown(): void {
    this.#shown = true;
  }

  add(pages: Array<Pick<WikiPage, 'path' | 'title'>>): void {
    let changed = false;
    for (const { path, title } of pages) {
      if (!this.#sources.has(path)) {
        this.#sources.set(path, { path, title });
        changed = true;
      }
    }
    if (changed) this.#publisher.sources({ turn: this.#turn, sources: this.list() });
  }

  list(): Source[] {
    return [...this.#sources.values()];
  }
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf('\n', maxChars);
  return `${text.slice(0, cut > maxChars / 2 ? cut : maxChars)}\n\n[... page truncated ...]`;
}

export function searchWiki(deps: ToolDeps, query: string, limit = 5): string {
  const hits = deps.wiki.search.search(query, limit);
  if (hits.length === 0) return `No wiki pages match "${query}".`;
  deps.sources.add(hits.slice(0, 3));
  return hits.map((h, i) => `${i + 1}. ${h.title} (${h.path})\n   ${h.snippet}`).join('\n');
}

export function readPage(deps: ToolDeps, name: string): string {
  const page = deps.wiki.store.resolve(name);
  if (!page) {
    const suggestions = deps.wiki.search.search(name, 3).map((h) => `${h.title} (${h.path})`);
    return `No page named "${name}".${suggestions.length ? ` Did you mean: ${suggestions.join('; ')}?` : ''}`;
  }
  deps.sources.add([page]);
  return `Page: ${page.title} (${page.path})\n\n${truncate(page.content, deps.cfg.WIKI_PAGE_MAX_CHARS)}`;
}

export function listRecentChanges(deps: ToolDeps, limit = 5): string {
  const log = deps.wiki.store.log();
  if (log) {
    deps.sources.add([log]);
    // log.md is expected to have one "## <date or title>" section per change set, newest first.
    const sections = log.content.split(/\n(?=##\s)/).filter((s) => /^##\s/.test(s));
    const picked = sections.length ? sections.slice(0, limit) : [log.content];
    return truncate(picked.join('\n'), deps.cfg.WIKI_PAGE_MAX_CHARS);
  }
  const recent = deps.wiki.store
    .pages()
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
  return recent
    .map((p) => `${p.title} (${p.path}) — last modified ${new Date(p.mtimeMs).toISOString().slice(0, 10)}`)
    .join('\n');
}

export function showOnScreen(deps: ToolDeps, markdown: string, sourcePaths: string[]): string {
  const sources: Source[] = [];
  for (const path of sourcePaths) {
    const page = deps.wiki.store.resolve(path);
    if (page) sources.push({ path: page.path, title: page.title });
  }
  deps.publisher.answer({ markdown, sources });
  deps.sources.markShown();
  if (sources.length) deps.sources.add(sources);
  return 'Shown on screen. Now tell the user in one short sentence that the details are on their screen; do not repeat them.';
}

export function createWikiTools(deps: ToolDeps) {
  return {
    searchWiki: llm.tool({
      description:
        'Full-text search over the wiki. Use English keywords and identifiers, even when the user speaks Dutch. ' +
        'Returns page titles, paths and matching snippets.',
      parameters: z.object({
        query: z.string().describe('English search keywords, e.g. "refresh token rotation"'),
      }),
      execute: async ({ query }) => searchWiki(deps, query),
    }),
    readPage: llm.tool({
      description: 'Read the full content of one wiki page by title, file name or path.',
      parameters: z.object({
        page: z.string().describe('Page title, file name or path, e.g. "Auth Service"'),
      }),
      execute: async ({ page }) => readPage(deps, page),
    }),
    listRecentChanges: llm.tool({
      description: 'List the most recent changes to the wiki (from log.md).',
      parameters: z.object({
        limit: z.number().int().min(1).max(20).nullable().describe('Number of entries, default 5'),
      }),
      execute: async ({ limit }) => listRecentChanges(deps, limit ?? 5),
    }),
    showOnScreen: llm.tool({
      description:
        'Show details on the user\'s screen instead of speaking them: code, commands, file paths, ' +
        'exact values or lists. Write short markdown. Mention the wiki pages you used.',
      parameters: z.object({
        markdown: z.string().describe('Markdown to display, may contain code blocks'),
        sources: z.array(z.string()).describe('Paths or titles of the wiki pages used'),
      }),
      execute: async ({ markdown, sources }) => showOnScreen(deps, markdown, sources),
    }),
  };
}
