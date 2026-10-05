import 'server-only';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { DEFAULT_PRESENTATION, type Presentation, presentationForVoice } from './presentation';
import { isVoice } from './protocol';

/** The repo root when run from `frontend/` (npm workspaces); the working directory otherwise (Docker). */
const ROOT = basename(process.cwd()) === 'frontend' ? resolve(process.cwd(), '..') : process.cwd();

let loaded = false;

export interface PublicModelConfig {
  provider: 'ollama' | 'openai-compatible' | 'legacy';
  auth: 'api-key' | 'entra';
  model: string | null;
}

export function publicModelConfig(env: Record<string, string | undefined> = process.env): PublicModelConfig {
  const provider = env.LLM_PROVIDER === 'ollama' || env.LLM_PROVIDER === 'openai-compatible'
    ? env.LLM_PROVIDER
    : env.LLM_BASE_URL || env.LLM_BASE_URL_DOCKER || env.LLM_MODEL ? 'legacy' : 'ollama';
  return {
    provider,
    auth: env.LLM_AUTH === 'entra' ? 'entra' : 'api-key',
    model: env.LLM_MODEL?.trim() || (provider === 'openai-compatible' ? null : 'qwen3:4b-instruct'),
  };
}

export function modelSettings(): PublicModelConfig {
  if (!loaded) {
    loadRootEnv();
    loaded = true;
  }
  return publicModelConfig();
}

/** The presentation until the user picks one: the one that matches DEFAULT_VOICE, with an avatar. */
export function defaultPresentation(env: Record<string, string | undefined> = process.env): Presentation {
  const voice = env.DEFAULT_VOICE?.toLowerCase();
  return isVoice(voice) ? presentationForVoice(voice) : DEFAULT_PRESENTATION;
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
  const wikiSources = parseWikiSources(process.env.WIKI_SOURCES);
  return {
    livekitUrl: required('LIVEKIT_URL', 'ws://localhost:7880'),
    apiKey: required('LIVEKIT_API_KEY', 'devkey'),
    apiSecret: required('LIVEKIT_API_SECRET', 'secret'),
    agentName: required('AGENT_NAME', 'llm-wiki-avatar'),
    wikiSources,
    defaultPresentation: defaultPresentation(),
  };
}

function parseWikiSources(raw: string | undefined) {
  if (!raw) return [{ id: 'wiki', name: 'Wiki', path: resolve(ROOT, 'sample-wiki') }];
  let sources: unknown;
  try {
    sources = JSON.parse(raw);
  } catch {
    throw new Error('WIKI_SOURCES must be a JSON array of { id, name, path } objects');
  }
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('WIKI_SOURCES must contain at least one source');
  const ids = new Set<string>();
  return sources.map((source: unknown) => {
    const item = source as { id?: unknown; name?: unknown; path?: unknown };
    if (
      typeof item?.id !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      typeof item.path !== 'string' ||
      !item.path
    ) {
      throw new Error('WIKI_SOURCES entries require unique IDs, names, and paths');
    }
    ids.add(item.id);
    return { id: item.id, name: item.name, path: resolve(ROOT, item.path) };
  });
}
