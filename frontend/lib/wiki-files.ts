import 'server-only';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export class WikiPathError extends Error {}

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

export async function readWikiPage(wikiDir: string, path: string) {
  const markdown = await readFile(await resolveWikiPath(wikiDir, path), 'utf8');
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? path.split('/').pop()!.replace(/\.md$/i, '');
  return { path, title, markdown };
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
  return out;
}

/** Finds a page by wikilink name (file name first, then H1 title). */
export async function findWikiPage(wikiDir: string, name: string): Promise<string> {
  const key = normalizeName(name.split('/').pop() ?? name);
  if (!key) throw new WikiPathError('page not found');
  const root = await realpath(wikiDir);
  const files = await listMarkdown(root);
  const byFile = files.find((f) => normalizeName(f.split('/').pop()!) === key);
  if (byFile) return byFile;
  for (const file of files) {
    const title = /^#\s+(.+)$/m.exec(await readFile(join(root, file), 'utf8'))?.[1];
    if (title && normalizeName(title) === key) return file;
  }
  throw new WikiPathError('page not found');
}
