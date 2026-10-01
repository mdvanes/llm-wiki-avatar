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

/** `off`: replies are text only (speech-to-text keeps working). Otherwise the gender of the TTS voice. */
export const VOICES = ['off', 'female', 'male'] as const;
export type Voice = (typeof VOICES)[number];
export type VoiceGender = Exclude<Voice, 'off'>;

/** How the avatar's mouth follows the voice: `audio` (loudness) or `words` (word timings from the TTS, premium). */
export const LIPSYNCS = ['audio', 'words'] as const;
export type Lipsync = (typeof LIPSYNCS)[number];

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const schema = z.object({
  AGENT_NAME: z.string().default('llm-wiki-avatar'),
  // Defaults match `livekit-server --dev`.
  LIVEKIT_URL: z.string().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().default('devkey'),
  LIVEKIT_API_SECRET: z.string().default('secret'),

  WIKI_DIR: z.string().default(resolve(REPO_ROOT, 'sample-wiki')),
  VOCAB_DIR: z.string().default(resolve(REPO_ROOT, 'vocab')),
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

  SPEACHES_URL: z.string().default('http://localhost:8000/v1'),
  SPEACHES_API_KEY: z.string().default('speaches'),
  STT_MODEL: z.string().default('Systran/faster-whisper-small'),
  STT_FUZZY_CORRECTION: bool.default(true),
  /** Request timeout for Speaches STT/TTS calls. */
  SPEECH_TIMEOUT_S: z.coerce.number().positive().default(30),

  TTS_EN_BASE_URL: z.string().optional(),
  TTS_EN_MODEL: z.string().default('speaches-ai/Kokoro-82M-v1.0-ONNX'),
  TTS_EN_VOICE: z.string().default('af_heart'),
  TTS_NL_BASE_URL: z.string().optional(),
  TTS_NL_MODEL: z.string().default('speaches-ai/piper-nl_BE-nathalie-medium'),
  TTS_NL_VOICE: z.string().default('nathalie'),
  // The TTS_EN_* / TTS_NL_* settings above are the female voices; these are the male ones.
  TTS_EN_MALE_BASE_URL: z.string().optional(),
  TTS_EN_MALE_MODEL: z.string().default('speaches-ai/Kokoro-82M-v1.0-ONNX'),
  TTS_EN_MALE_VOICE: z.string().default('am_michael'),
  TTS_NL_MALE_BASE_URL: z.string().optional(),
  TTS_NL_MALE_MODEL: z.string().default('speaches-ai/piper-nl_BE-rdh-medium'),
  TTS_NL_MALE_VOICE: z.string().default('rdh'),
  TTS_SPEED: z.coerce.number().min(0.5).max(2).default(1),
  /**
   * Kokoro-FastAPI (e.g. `http://localhost:8880`), for the premium avatar: English female voice `af_heart` with word
   * timings for lip-sync. Without it the premium avatar uses the regular voice and loudness lip-sync.
   */
  KOKORO_URL: z.string().optional(),

  DEFAULT_LANGUAGE: z.enum(SUPPORTED_LANGUAGES).default('en'),
  /** Used when the browser does not send a voice. */
  DEFAULT_VOICE: z.enum(VOICES).default('female'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const cfg = schema.parse(cleaned);
  return {
    ...cfg,
    WIKI_DIR: resolve(REPO_ROOT, cfg.WIKI_DIR),
    VOCAB_DIR: resolve(REPO_ROOT, cfg.VOCAB_DIR),
  };
}

export function isVoice(value: unknown): value is Voice {
  return typeof value === 'string' && (VOICES as readonly string[]).includes(value);
}

export function isLipsync(value: unknown): value is Lipsync {
  return typeof value === 'string' && (LIPSYNCS as readonly string[]).includes(value);
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
