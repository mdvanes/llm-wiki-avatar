import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

dotenv.config({
  path: [resolve(REPO_ROOT, '.env.local'), resolve(REPO_ROOT, '.env')],
  quiet: true,
});

export const SUPPORTED_LANGUAGES = ['en', 'nl'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const wikiSourcesSchema = z
  .array(
    z.object({
      id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
      name: z.string().min(1),
      path: z.string().min(1),
    }),
  )
  .min(1)
  .superRefine((sources, ctx) => {
    const ids = new Set<string>();
    for (const [index, source] of sources.entries()) {
      if (ids.has(source.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'IDs must be unique' });
      ids.add(source.id);
    }
  });

export interface WikiSource {
  id: string;
  name: string;
  path: string;
}

const schema = z.object({
  AGENT_NAME: z.string().default('llm-wiki-avatar'),
  // Defaults match `livekit-server --dev`.
  LIVEKIT_URL: z.string().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().default('devkey'),
  LIVEKIT_API_SECRET: z.string().default('secret'),

  WIKI_SOURCES: z.string().default('[{"id":"wiki","name":"Wiki","path":"sample-wiki"}]'),
  WIKI_CONTEXT_CHARS: z.coerce.number().int().positive().default(1800),
  WIKI_INDEX_MAX_CHARS: z.coerce.number().int().positive().default(4000),
  WIKI_PAGE_MAX_CHARS: z.coerce.number().int().positive().default(6000),
  WIKI_WATCH_POLL: bool.default(false),
  /** Chat role of the auto-injected wiki excerpts; some local chat templates ignore mid-conversation system messages. */
  WIKI_CONTEXT_ROLE: z.enum(['system', 'assistant', 'user']).default('system'),

  LLM_BASE_URL: z.string().default('http://localhost:11434/v1'),
  LLM_MODEL: z.string().default('qwen3:4b-instruct'),
  LLM_API_KEY: z.string().default('ollama'),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
  /** Local models on CPU can take a while before the first token (prompt processing, model load). */
  LLM_TIMEOUT_S: z.coerce.number().positive().default(90),
  LLM_REASONING_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional(),

  DEFAULT_LANGUAGE: z.enum(SUPPORTED_LANGUAGES).default('en'),
});

export type Config = Omit<z.infer<typeof schema>, 'WIKI_SOURCES'> & { WIKI_SOURCES: WikiSource[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const cfg = schema.parse(cleaned);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cfg.WIKI_SOURCES);
  } catch {
    throw new Error('WIKI_SOURCES must be a JSON array of { id, name, path } objects');
  }
  return {
    ...cfg,
    WIKI_SOURCES: wikiSourcesSchema.parse(parsed).map((source) => ({
      ...source,
      path: resolve(REPO_ROOT, source.path),
    })),
  };
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
