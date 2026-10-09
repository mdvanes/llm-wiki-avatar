import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { NextResponse } from 'next/server';
import { LANGUAGE_ATTRIBUTE } from '@/lib/protocol';
import { isLanguage } from '@/lib/language';
import { serverConfig } from '@/lib/server-config';

export const dynamic = 'force-dynamic';

/**
 * Issues a LiveKit token and dispatches the wiki agent into a fresh room. The selected language travels as a
 * participant attribute, which the agent reads when the session starts.
 *
 * NOTE: there is no authentication here. That is fine on a laptop or a trusted network; put the
 * app behind your SSO/reverse proxy before exposing it more widely.
 */
export async function POST(req: Request) {
  try {
    return await issueToken(req);
  } catch (err) {
    // Configuration errors (e.g. an invalid WIKI_SOURCES) carry no secrets; show them instead of a bare 500.
    const error = err instanceof Error ? err.message : String(err);
    console.error('token route failed:', error);
    return NextResponse.json({ error }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function issueToken(req: Request) {
  const cfg = serverConfig();
  const body = (await req.json().catch(() => ({}))) as {
    participant_name?: string;
    participant_attributes?: Record<string, string>;
  };
  const requested = body.participant_attributes?.[LANGUAGE_ATTRIBUTE];
  const language = isLanguage(requested) ? requested : 'en';

  const suffix = crypto.randomUUID().slice(0, 8);
  const roomName = `wiki-${suffix}`;
  const identity = `user-${suffix}`;
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity,
    name: body.participant_name?.slice(0, 64) || 'user',
    attributes: { [LANGUAGE_ATTRIBUTE]: language },
    ttl: '30m',
  });
  token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: true });
  token.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: cfg.agentName })],
  });

  return NextResponse.json(
    {
      server_url: cfg.livekitUrl,
      participant_token: await token.toJwt(),
      room_name: roomName,
      participant_name: identity,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
