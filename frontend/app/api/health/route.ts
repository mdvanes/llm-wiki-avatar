import { NextResponse } from 'next/server';
import { modelSettings, serverConfig } from '@/lib/server-config';

export const dynamic = 'force-dynamic';

/** Public, secret-free facts for error messages: the LiveKit URL the browser uses and the configured model. */
export async function GET() {
  const model = modelSettings();
  let livekitUrl: string | null = null;
  let configError: string | null = null;
  try {
    livekitUrl = serverConfig().livekitUrl;
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json(
    { livekitUrl, provider: model.provider, model: model.model, configError },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
