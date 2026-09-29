import 'server-only';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { AvatarView } from './avatar-calm';

/** The repo root when run from `frontend/` (npm workspaces); the working directory otherwise (Docker). */
const ROOT = basename(process.cwd()) === 'frontend' ? resolve(process.cwd(), '..') : process.cwd();

let loaded = false;

export type AvatarBody = 'M' | 'F';
export interface AvatarConfig {
  url: string;
  body: AvatarBody;
  /** `head` frames the face, `upper` the upper body. */
  view: AvatarView;
  /** Vertical camera offset; null places the camera at eye height (best eye contact). */
  cameraY: number | null;
  /** Extra camera distance; negative zooms in, positive zooms out. */
  cameraDistance: number;
}

function optionalNumber(name: string): number | null {
  const value = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(value) ? value : null;
}

function number(name: string, fallback: number): number {
  return optionalNumber(name) ?? fallback;
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
    avatar: {
      // A path under frontend/public or a full URL (the host must allow CORS).
      url: required('AVATAR_URL', '/avatars/mpfb.glb'),
      body: (process.env.AVATAR_BODY?.toUpperCase() === 'M' ? 'M' : 'F') as AvatarBody,
      view: (process.env.AVATAR_VIEW?.toLowerCase() === 'upper' ? 'upper' : 'head') as AvatarView,
      cameraY: optionalNumber('AVATAR_CAMERA_Y'),
      cameraDistance: number('AVATAR_CAMERA_DISTANCE', 0),
    },
  };
}
