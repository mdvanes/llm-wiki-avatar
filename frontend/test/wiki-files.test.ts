import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WikiPathError, findWikiPage, readWikiPage, resolveWikiPath } from '@/lib/wiki-files';

let wiki: string;
let secondWiki: string;
let outside: string;

beforeAll(async () => {
  wiki = await mkdtemp(join(tmpdir(), 'wiki-'));
  secondWiki = await mkdtemp(join(tmpdir(), 'wiki-second-'));
  outside = await mkdtemp(join(tmpdir(), 'outside-'));
  await mkdir(join(wiki, 'pages'));
  await mkdir(join(wiki, '.git'));
  await mkdir(join(secondWiki, 'pages'));
  await writeFile(join(wiki, 'index.md'), '# Index\n\nSee [[Auth Service]].\n');
  await writeFile(join(wiki, 'pages', 'auth-service.md'), '# Auth Service\n\nJWT.\n');
  await writeFile(join(wiki, 'pages', 'billing.md'), '# Billing & Payments\n\nStripe.\n');
  await writeFile(join(wiki, '.git', 'secret.md'), '# Secret\n');
  await writeFile(join(wiki, 'pages', 'shared.md'), '# Shared\n\nFirst wiki.');
  await writeFile(join(secondWiki, 'pages', 'shared.md'), '# Shared\n\nSecond wiki.');
  await writeFile(join(outside, 'secret.md'), '# Outside\n');
  await symlink(join(outside, 'secret.md'), join(wiki, 'pages', 'link.md'));
});

afterAll(async () => {
  await Promise.all([
    rm(wiki, { recursive: true, force: true }),
    rm(secondWiki, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]);
});

describe('resolveWikiPath', () => {
  it('reads pages inside the wiki', async () => {
    const page = await readWikiPage(wiki, 'pages/auth-service.md');
    expect(page).toMatchObject({ path: 'pages/auth-service.md', title: 'Auth Service' });
  });

  it.each(['../outside/secret.md', '/etc/passwd.md', 'pages/../../x.md', '.git/secret.md', 'pages/auth-service.txt', ''])(
    'rejects %j',
    async (path) => {
      await expect(resolveWikiPath(wiki, path)).rejects.toBeInstanceOf(WikiPathError);
    },
  );

  it('rejects symlinks that leave the wiki', async () => {
    await expect(resolveWikiPath(wiki, 'pages/link.md')).rejects.toThrow('invalid wiki path');
  });

  it('reports missing pages', async () => {
    await expect(resolveWikiPath(wiki, 'pages/nope.md')).rejects.toThrow('page not found');
  });
});

describe('findWikiPage', () => {
  it('finds pages by file name or title like the agent does', async () => {
    expect(await findWikiPage(wiki, 'Auth Service')).toBe('pages/auth-service.md');
    expect(await findWikiPage(wiki, 'auth-service')).toBe('pages/auth-service.md');
    expect(await findWikiPage(wiki, 'Billing & Payments')).toBe('pages/billing.md');
  });

  it('ignores hidden folders and unknown names', async () => {
    await expect(findWikiPage(wiki, 'secret')).rejects.toThrow('page not found');
    await expect(findWikiPage(wiki, '')).rejects.toThrow('page not found');
  });

  it('preserves configured source order and resolves a duplicate path in its requested source', async () => {
    const sources = [
      { id: 'first', name: 'First Wiki', path: wiki },
      { id: 'second', name: 'Second Wiki', path: secondWiki },
    ];
    expect(await findWikiPage(sources, 'shared')).toBe('pages/shared.md');
    expect(await findWikiPage(sources, 'shared', 'second')).toBe('pages/shared.md');
    await expect(readWikiPage(sources, 'pages/shared.md', 'second')).resolves.toMatchObject({
      sourceId: 'second',
      sourceName: 'Second Wiki',
      markdown: '# Shared\n\nSecond wiki.',
    });
  });
});
