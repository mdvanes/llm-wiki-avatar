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

  LLM_PROVIDER: z.enum(['ollama', 'openai-compatible']).optional(),
  LLM_AUTH: z.enum(['api-key', 'entra']).default('api-key'),
  ENTRA_SCOPE: z.string().optional(),
  ENTRA_AUTH_MODE: z.enum(['cli', 'sp', 'managed-identity', 'auto']).default('cli'),
  AZURE_TENANT_ID: z.string().optional(),
  AZURE_CLIENT_ID: z.string().optional(),
  AZURE_CLIENT_SECRET: z.string().optional(),
  LLM_BASE_URL: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'LLM_BASE_URL must be an HTTP(S) URL without embedded credentials').default('http://localhost:11434/v1'),
  LLM_MODEL: z.string().default('qwen3:4b-instruct'),
  LLM_API_KEY: z.string().default('ollama'),
  LLM_TEMPERATURE: z.union([
    z.literal('omit'),
    z.coerce.number().min(0).max(2),
  ]).default(0.3).transform((value) => value === 'omit' ? undefined : value),
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
  if (cleaned.LLM_AUTH === 'entra') {
    if (cleaned.LLM_PROVIDER !== 'openai-compatible') {
      throw new Error('LLM_AUTH=entra requires LLM_PROVIDER=openai-compatible');
    }
    if (!cleaned.ENTRA_SCOPE?.trim().endsWith('/.default')) {
      throw new Error('ENTRA_SCOPE is required and must end with /.default for LLM_AUTH=entra');
    }
    const servicePrincipalFields = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];
    const usesServicePrincipal = cleaned.ENTRA_AUTH_MODE === 'sp' ||
      (cleaned.ENTRA_AUTH_MODE === 'auto' && servicePrincipalFields.some((name) => cleaned[name]?.trim()));
    if (usesServicePrincipal) {
      for (const name of servicePrincipalFields) {
        if (!cleaned[name]?.trim()) throw new Error(`${name} is required for Entra service-principal authentication`);
      }
    }
  }
  if (cleaned.LLM_PROVIDER === 'openai-compatible') {
    const requiredFields = cleaned.LLM_AUTH === 'entra'
      ? ['LLM_BASE_URL', 'LLM_MODEL']
      : ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY'];
    for (const name of requiredFields) {
      if (!cleaned[name]?.trim()) throw new Error(`${name} is required for LLM_PROVIDER=openai-compatible`);
    }
    if (cleaned.LLM_AUTH !== 'entra' && ['ollama', 'YOUR_API_KEY'].includes(cleaned.LLM_API_KEY!.trim())) {
      throw new Error('LLM_API_KEY must be a real API key for LLM_PROVIDER=openai-compatible');
    }
  }
  const cfg = schema.parse({
    ...cleaned,
    LLM_BASE_URL: cleaned.LLM_BASE_URL || (cleaned.LLM_PROVIDER !== 'openai-compatible' ? cleaned.LLM_OLLAMA_BASE_URL : undefined),
  });
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
