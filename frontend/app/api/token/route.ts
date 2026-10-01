import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { NextResponse } from 'next/server';
import {
  INPUT_MODE_ATTRIBUTE,
  LANGUAGE_ATTRIBUTE,
  LIPSYNC_ATTRIBUTE,
  VOICE_ATTRIBUTE,
  isInputMode,
  isLipsync,
  isVoice,
} from '@/lib/protocol';
import { isLanguage } from '@/lib/language';
import { serverConfig } from '@/lib/server-config';

export const dynamic = 'force-dynamic';

/**
 * Issues a LiveKit token and dispatches the wiki agent into a fresh room. The selected language,
 * microphone mode, voice and lip-sync travel as participant attributes, which the agent reads when the session starts.
 *
 * NOTE: there is no authentication here. That is fine on a laptop or a trusted network; put the
 * app behind your SSO/reverse proxy before exposing it more widely.
 */
export async function POST(req: Request) {
  const cfg = serverConfig();
  const body = (await req.json().catch(() => ({}))) as {
    participant_name?: string;
    participant_attributes?: Record<string, string>;
  };
  const requested = body.participant_attributes?.[LANGUAGE_ATTRIBUTE];
  const language = isLanguage(requested) ? requested : 'en';
  const requestedMode = body.participant_attributes?.[INPUT_MODE_ATTRIBUTE];
  const inputMode = isInputMode(requestedMode) ? requestedMode : 'always';
  const requestedVoice = body.participant_attributes?.[VOICE_ATTRIBUTE];
  // Without a (valid) voice the agent uses its DEFAULT_VOICE.
  const voice: Record<string, string> = isVoice(requestedVoice) ? { [VOICE_ATTRIBUTE]: requestedVoice } : {};
  const requestedLipsync = body.participant_attributes?.[LIPSYNC_ATTRIBUTE];
  const lipsync: Record<string, string> = isLipsync(requestedLipsync) ? { [LIPSYNC_ATTRIBUTE]: requestedLipsync } : {};

  const suffix = crypto.randomUUID().slice(0, 8);
  const roomName = `wiki-${suffix}`;
  const identity = `user-${suffix}`;
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity,
    name: body.participant_name?.slice(0, 64) || 'user',
    attributes: { [LANGUAGE_ATTRIBUTE]: language, [INPUT_MODE_ATTRIBUTE]: inputMode, ...voice, ...lipsync },
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
