import 'server-only';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export class WikiPathError extends Error {}

export interface WikiRoot {
  id: string;
  name: string;
  path: string;
}

type WikiRoots = string | WikiRoot[];

function selectWikiRoot(roots: WikiRoots, sourceId?: string): WikiRoot {
  const configured = typeof roots === 'string' ? [{ id: 'wiki', name: 'Wiki', path: roots }] : roots;
  const root = sourceId ? configured.find((candidate) => candidate.id === sourceId) : configured[0];
  if (!root) throw new WikiPathError(sourceId ? 'unknown wiki source' : 'page not found');
  return root;
}

/** Resolves a wiki-relative markdown path, refusing anything outside the wiki folder. */
export async function resolveWikiPath(wikiDir: string, path: string): Promise<string> {
  if (!path || isAbsolute(path) || !path.toLowerCase().endsWith('.md') || path.split(/[\\/]/).some((p) => p.startsWith('.'))) {
    throw new WikiPathError('invalid wiki path');
  }
  const root = await realpath(wikiDir);
  const full = await realpath(resolve(root, path)).catch(() => {
    throw new WikiPathError('page not found');
  });
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new WikiPathError('invalid wiki path');
  }
  return full;
}

export async function readWikiPage(roots: WikiRoots, path: string, sourceId?: string) {
  const root = selectWikiRoot(roots, sourceId);
  const markdown = await readFile(await resolveWikiPath(root.path, path), 'utf8');
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? path.split('/').pop()!.replace(/\.md$/i, '');
  return { sourceId: root.id, sourceName: root.name, path, title, markdown };
}

/** Same normalisation as the agent's store: "Auth Service" matches "auth-service.md". */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/, '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

async function listMarkdown(root: string, dir = ''): Promise<string[]> {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listMarkdown(root, rel)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(rel);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Finds a page by wikilink name (file name first, then H1 title). */
export async function findWikiPage(roots: WikiRoots, name: string, sourceId?: string): Promise<string> {
  const key = normalizeName(name.split('/').pop() ?? name);
  if (!key) throw new WikiPathError('page not found');
  const configured = typeof roots === 'string' ? [{ id: 'wiki', name: 'Wiki', path: roots }] : roots;
  const candidates = sourceId ? [selectWikiRoot(configured, sourceId)] : configured;
  for (const candidate of candidates) {
    const root = await realpath(candidate.path);
    const files = await listMarkdown(root);
    const byFile = files.find((file) => normalizeName(file.split('/').pop()!) === key);
    if (byFile) return byFile;
    for (const file of files) {
      const title = /^#\s+(.+)$/m.exec(await readFile(join(root, file), 'utf8'))?.[1];
      if (title && normalizeName(title) === key) return file;
    }
  }
  throw new WikiPathError('page not found');
}
