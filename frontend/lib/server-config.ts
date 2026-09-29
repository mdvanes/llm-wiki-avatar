import 'server-only';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { AvatarView } from './avatar-calm';
import { type AvatarGender, DEFAULT_PRESENTATION, type Presentation, presentationForVoice } from './presentation';
import { isVoice } from './protocol';

/** The repo root when run from `frontend/` (npm workspaces); the working directory otherwise (Docker). */
const ROOT = basename(process.cwd()) === 'frontend' ? resolve(process.cwd(), '..') : process.cwd();

let loaded = false;

export type AvatarBody = 'M' | 'F';

/** One avatar model. */
export interface AvatarModel {
  url: string;
  /** Posture and gestures; follows the gender. */
  body: AvatarBody;
}

/** Camera settings shared by all models. */
export interface AvatarFraming {
  /** `head` frames the face, `upper` the upper body. */
  view: AvatarView;
  /** Vertical camera offset; null places the camera at eye height (best eye contact). */
  cameraY: number | null;
  /** Extra camera distance; negative zooms in, positive zooms out. */
  cameraDistance: number;
}

/** The avatar that is shown. */
export type AvatarConfig = AvatarModel & AvatarFraming;

/** Everything the browser needs to show either avatar and to pick the initial presentation. */
export interface AvatarSettings extends AvatarFraming {
  models: Record<AvatarGender, AvatarModel>;
  /** Used until the user picks a presentation; follows the agent's DEFAULT_VOICE. */
  defaultPresentation: Presentation;
}

type Env = Record<string, string | undefined>;

function optionalNumber(env: Env, name: string): number | null {
  const value = Number.parseFloat(env[name] ?? '');
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads the avatar settings. `AVATAR_FEMALE_URL` and `AVATAR_MALE_URL` pick the models; the older `AVATAR_URL`
 * still works and fills the slot given by `AVATAR_BODY` (female unless `M`). A URL is a path under frontend/public
 * or a full URL (the host must allow CORS).
 */
export function avatarSettings(env: Env = process.env): AvatarSettings {
  const legacy = env.AVATAR_URL || undefined;
  const legacyMale = env.AVATAR_BODY?.toUpperCase() === 'M';
  const voice = env.DEFAULT_VOICE?.toLowerCase();
  return {
    models: {
      female: { url: env.AVATAR_FEMALE_URL || (legacyMale ? undefined : legacy) || '/avatars/mpfb.glb', body: 'F' },
      male: { url: env.AVATAR_MALE_URL || (legacyMale ? legacy : undefined) || '/avatars/avatarsdk.glb', body: 'M' },
    },
    view: env.AVATAR_VIEW?.toLowerCase() === 'upper' ? 'upper' : 'head',
    cameraY: optionalNumber(env, 'AVATAR_CAMERA_Y'),
    cameraDistance: optionalNumber(env, 'AVATAR_CAMERA_DISTANCE') ?? 0,
    defaultPresentation: isVoice(voice) ? presentationForVoice(voice) : DEFAULT_PRESENTATION,
  };
}

/** Shares the repo-level .env.local/.env with the agent; real env vars and frontend/.env* (loaded by Next) win. */
function loadRootEnv(): void {
  for (const file of ['.env.local', '.env']) {
    let text: string;
    try {
      text = readFileSync(resolve(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parseEnv(text))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Server-side settings; defaults match `livekit-server --dev` and the repo layout. */
export function serverConfig() {
  if (!loaded) {
    loadRootEnv();
    loaded = true;
  }
  return {
    livekitUrl: required('LIVEKIT_URL', 'ws://localhost:7880'),
    apiKey: required('LIVEKIT_API_KEY', 'devkey'),
    apiSecret: required('LIVEKIT_API_SECRET', 'secret'),
    agentName: required('AGENT_NAME', 'llm-wiki-avatar'),
    // Relative paths are relative to the repo root, as for the agent.
    wikiDir: resolve(ROOT, required('WIKI_DIR', 'sample-wiki')),
    avatar: avatarSettings(),
  };
}
