import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WikiSearch, tokenize } from '../src/wiki/search.ts';
import { WikiStore, normalizeName, parsePage, parseWikilinks } from '../src/wiki/store.ts';
import { Wiki } from '../src/wiki/wiki.ts';
import { SAMPLE_WIKI } from './helpers.ts';


describe('parsePage', () => {
  it('extracts title, headings and wikilinks, ignoring code blocks', () => {
    const page = parsePage(
      'pages/x.md',
      '# The Title\n\nSee [[Other Page|other]] and [[Third#Section]].\n\n```md\n# not a heading\n[[Nope]]\n```\n\n## Details\n',
    );
    expect(page.title).toBe('The Title');
    expect(page.headings).toEqual(['Details']);
    expect(page.links).toEqual(['Other Page', 'Third']);
    expect(page.name).toBe('x');
  });

  it('falls back to the file name when there is no H1', () => {
    expect(parsePage('pages/my-page.md', 'no heading').title).toBe('my-page');
  });

  it('parses wikilinks', () => {
    expect(parseWikilinks('[[A]] [[B|b]] [[C#h|c]]')).toEqual(['A', 'B', 'C']);
  });

  it('normalizes names', () => {
    expect(normalizeName('Auth-Service')).toBe(normalizeName('auth service'));
  });
});

describe('WikiStore', () => {
  const store = new WikiStore(SAMPLE_WIKI);
  beforeAll(() => store.load());

  it('loads all markdown pages', () => {
    expect(store.size).toBe(9);
    expect(store.index()?.path).toBe('index.md');
    expect(store.log()?.path).toBe('log.md');
  });

  it('resolves pages by title, file name, path and wikilink', () => {
    expect(store.resolve('Auth Service')?.path).toBe('pages/auth-service.md');
    expect(store.resolve('auth-service')?.path).toBe('pages/auth-service.md');
    expect(store.resolve('pages/billing-service.md')?.title).toBe('Billing Service');
    expect(store.resolve('billing')?.title).toBe('Billing Service');
    expect(store.resolve('does not exist')).toBeUndefined();
  });

  it('refuses paths outside the wiki', () => {
    expect(() => store.toRelative('/etc/passwd')).toThrow();
    expect(() => store.toRelative(join(SAMPLE_WIKI, '..', 'package.json'))).toThrow();
    expect(store.resolve('../package.json')).toBeUndefined();
  });
});

describe('WikiSearch', () => {
  const store = new WikiStore(SAMPLE_WIKI);
  let search: WikiSearch;
  beforeAll(async () => {
    await store.load();
    search = new WikiSearch(store);
  });

  it('splits identifiers into searchable parts', () => {
    expect(tokenize('getUserByID k8s-staging-eu2 invoice_scheduler')).toEqual(
      expect.arrayContaining(['getUserByID', 'get', 'User', 'By', 'ID', 'k8s', 'staging', 'eu2', 'invoice', 'scheduler']),
    );
  });

  it.each([
    ['refresh token rotation', 'pages/auth-service.md'],
    ['stripe webhook retries', 'pages/billing-service.md'],
    ['InvoiceScheduler', 'pages/billing-service.md'],
    ['invoice scheduler', 'pages/billing-service.md'],
    ['which cluster is staging', 'pages/deployment.md'],
    ['how do I run the stack locally', 'pages/local-development.md'],
    ['feature flag rollout', 'pages/feature-flags.md'],
  ])('finds "%s" on %s', (query, path) => {
    expect(search.search(query, 3)[0]?.path).toBe(path);
  });

  it('returns snippets containing the matched terms', () => {
    const [hit] = search.search('StripeWebhookHandler retry', 1);
    expect(hit?.snippet.toLowerCase()).toMatch(/retr/);
    expect(hit!.snippet.length).toBeLessThanOrEqual(330);
  });

  it('shows short pages whole, so answers phrased differently from the question are included', () => {
    const [hit] = search.search('hoe draai ik een deployment terug', 1, 600);
    expect(hit?.path).toBe('pages/deployment.md');
    expect(hit!.snippet).toContain('helm rollback');
  });

  it('returns nothing for unrelated queries', () => {
    expect(search.search('zzzqqq', 3)).toEqual([]);
  });
});

describe('Multi-source wiki', () => {
  const tempRoot = join(import.meta.dirname, '..', '..', 'tmp');
  let firstRoot: string;
  let secondRoot: string;
  let wiki: Wiki;

  beforeAll(async () => {
    await mkdir(tempRoot, { recursive: true });
    firstRoot = await mkdtemp(join(tempRoot, 'wiki-first-'));
    secondRoot = await mkdtemp(join(tempRoot, 'wiki-second-'));
    await mkdir(join(firstRoot, 'pages'));
    await mkdir(join(secondRoot, 'pages'));
    await writeFile(join(firstRoot, 'pages', 'shared.md'), '# Shared Page\n\nAlpha feature details.');
    await writeFile(join(secondRoot, 'pages', 'shared.md'), '# Shared Page\n\nBeta feature details.');
    wiki = await Wiki.open([
      { id: 'alpha', name: 'Alpha', path: firstRoot },
      { id: 'beta', name: 'Beta', path: secondRoot },
    ]);
  });

  afterAll(async () => {
    await wiki?.close();
    await Promise.all([
      rm(firstRoot, { recursive: true, force: true }),
      rm(secondRoot, { recursive: true, force: true }),
    ]);
  });

  it('keeps duplicate relative paths distinct in search and source-qualified resolution', () => {
    expect(wiki.search.search('shared page', 5).map((hit) => hit.sourceId)).toEqual(['alpha', 'beta']);
    expect(wiki.store.resolve('pages/shared.md')?.sourceId).toBe('alpha');
    expect(wiki.store.resolve('pages/shared.md', 'beta')?.content).toContain('Beta feature');
  });
});

describe('Wiki watcher', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiki-'));
    await writeFile(join(dir, 'index.md'), '# Index\n\n- [[Alpha]]\n');
    await writeFile(join(dir, 'alpha.md'), '# Alpha\n\nThe alpha service handles apples.\n');
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('reindexes when pages are added, changed or removed', async () => {
    let reindexed = 0;
    const wiki = await Wiki.open(dir, { onReindex: () => reindexed++ });
    wiki.watch();
    try {
      expect(wiki.search.search('bananas')).toEqual([]);
      await new Promise((r) => setTimeout(r, 300));
      await writeFile(join(dir, 'beta.md'), '# Beta\n\nThe beta service handles bananas.\n');
      await expect.poll(() => wiki.search.search('bananas')[0]?.title, { timeout: 5000 }).toBe('Beta');
      await expect.poll(() => reindexed, { timeout: 5000 }).toBe(1);
      await rm(join(dir, 'beta.md'));
      await expect.poll(() => reindexed, { timeout: 5000 }).toBe(2);
      expect(wiki.search.search('bananas')).toEqual([]);
      expect(wiki.store.resolve('Beta')).toBeUndefined();
    } finally {
      await wiki.close();
    }
  });
});
