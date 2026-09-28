import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface WikiPage {
  /** Path relative to the wiki root, always with forward slashes. */
  path: string;
  /** File name without the `.md` extension. */
  name: string;
  /** First H1 heading, or the file name when there is none. */
  title: string;
  headings: string[];
  content: string;
  /** Targets of `[[wikilinks]]` found in the page. */
  links: string[];
  mtimeMs: number;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash']);
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** Lowercase and drop everything except letters and digits, so "Auth Service" matches "auth-service.md". */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/, '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function parseWikilinks(content: string): string[] {
  const links = new Set<string>();
  for (const match of content.matchAll(WIKILINK_RE)) {
    const target = match[1]?.trim();
    if (target) links.add(target);
  }
  return [...links];
}

export function parsePage(path: string, content: string, mtimeMs = 0): WikiPage {
  const name = path.split('/').pop()!.replace(/\.md$/i, '');
  const headings: string[] = [];
  let title: string | undefined;
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2]!;
    if (m[1] === '#' && title === undefined) title = text;
    else headings.push(text);
  }
  return {
    path,
    name,
    title: title ?? name,
    headings,
    content,
    links: parseWikilinks(content.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1/gm, '')),
    mtimeMs,
  };
}

export class WikiStore {
  readonly root: string;
  #pages = new Map<string, WikiPage>();

  constructor(root: string) {
    this.root = resolve(root);
  }

  async load(): Promise<void> {
    const rootStat = await stat(this.root).catch(() => undefined);
    if (!rootStat?.isDirectory()) {
      throw new Error(`WIKI_DIR does not exist or is not a directory: ${this.root}`);
    }
    this.#pages.clear();
    for (const rel of await this.#scan('')) {
      await this.reloadFile(rel);
    }
  }

  async #scan(dir: string): Promise<string[]> {
    const entries = await readdir(join(this.root, dir), { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          files.push(...(await this.#scan(rel)));
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(rel);
      }
    }
    return files;
  }

  /** Converts an absolute or relative path to a wiki-relative path, rejecting anything outside the root. */
  toRelative(path: string): string {
    const abs = isAbsolute(path) ? resolve(path) : resolve(this.root, path);
    const rel = relative(this.root, abs);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path is outside the wiki: ${path}`);
    }
    return rel.split(sep).join('/');
  }

  async reloadFile(path: string): Promise<WikiPage | undefined> {
    const rel = this.toRelative(path);
    const abs = join(this.root, rel);
    try {
      const [content, st] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
      const page = parsePage(rel, content, st.mtimeMs);
      this.#pages.set(rel, page);
      return page;
    } catch {
      this.#pages.delete(rel);
      return undefined;
    }
  }

  removeFile(path: string): void {
    this.#pages.delete(this.toRelative(path));
  }

  pages(): WikiPage[] {
    return [...this.#pages.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  get size(): number {
    return this.#pages.size;
  }

  /** Finds a page by relative path, file name, title or wikilink target (case/punctuation-insensitive). */
  resolve(query: string): WikiPage | undefined {
    const q = query.trim().replace(/^\[\[|\]\]$/g, '');
    if (!q) return undefined;
    const direct = this.#pages.get(q) ?? this.#pages.get(`${q}.md`);
    if (direct) return direct;
    const key = normalizeName(q.split('/').pop() ?? q);
    if (!key) return undefined;
    const pages = this.pages();
    return (
      pages.find((p) => normalizeName(p.name) === key) ??
      pages.find((p) => normalizeName(p.title) === key) ??
      pages.find((p) => normalizeName(p.title).includes(key) || normalizeName(p.name).includes(key))
    );
  }

  /** The wiki's `index.md` at the root, if present. */
  index(): WikiPage | undefined {
    return this.pages().find((p) => p.path.toLowerCase() === 'index.md');
  }

  /** The wiki's `log.md` at the root, if present. */
  log(): WikiPage | undefined {
    return this.pages().find((p) => p.path.toLowerCase() === 'log.md');
  }
}
