import { NextResponse } from 'next/server';
import { serverConfig } from '@/lib/server-config';
import { WikiPathError, findWikiPage, readWikiPage } from '@/lib/wiki-files';

export const dynamic = 'force-dynamic';

/** Serves a wiki page by `?path=` or `?name=`, optionally scoped to `?sourceId=`. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const { wikiSources } = serverConfig();
  try {
    const sourceId = params.get('sourceId') ?? undefined;
    const name = params.get('name');
    const path = name ? await findWikiPage(wikiSources, name, sourceId) : (params.get('path') ?? '');
    return NextResponse.json(await readWikiPage(wikiSources, path, sourceId));
  } catch (err) {
    const status = err instanceof WikiPathError ? (err.message === 'page not found' ? 404 : 400) : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status });
  }
}
