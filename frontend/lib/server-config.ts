import 'server-only';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseEnv } from 'node:util';

/** The repo root when run from `frontend/` (npm workspaces); the working directory otherwise (Docker). */
const ROOT = basename(process.cwd()) === 'frontend' ? resolve(process.cwd(), '..') : process.cwd();

let loaded = false;

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
  };
}
