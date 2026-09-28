import { NextResponse } from 'next/server';
import { serverConfig } from '@/lib/server-config';
import { WikiPathError, findWikiPage, readWikiPage } from '@/lib/wiki-files';

export const dynamic = 'force-dynamic';

/** Serves a wiki page (markdown) by `?path=` or wikilink `?name=`, so the UI can open sources. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const { wikiDir } = serverConfig();
  try {
    const name = params.get('name');
    const path = name ? await findWikiPage(wikiDir, name) : (params.get('path') ?? '');
    return NextResponse.json(await readWikiPage(wikiDir, path));
  } catch (err) {
    const status = err instanceof WikiPathError ? (err.message === 'page not found' ? 404 : 400) : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status });
  }
}
