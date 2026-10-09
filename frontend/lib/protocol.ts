/** Wire protocol shared with the agent (see agent/src/publisher.ts). */
export const TOPICS = {
  mood: 'wiki.mood',
  answer: 'wiki.answer',
  sources: 'wiki.sources',
  language: 'wiki.language',
  error: 'wiki.error',
} as const;

export const RPC_SET_LANGUAGE = 'set_language';
/** Push-to-talk pressed: the agent stops its reply. The transcript follows as a chat message. */
export const RPC_INTERRUPT = 'interrupt';
/** Continues an earlier conversation; see restorePayload in lib/history.ts. */
export const RPC_RESTORE_HISTORY = 'restore_history';
export const LANGUAGE_ATTRIBUTE = 'language';

/** `off`: replies are text only (push-to-talk keeps working). Otherwise the gender of the voice. */
export const VOICES = ['off', 'female', 'male'] as const;
export type Voice = (typeof VOICES)[number];

export function isVoice(value: unknown): value is Voice {
  return typeof value === 'string' && (VOICES as readonly string[]).includes(value);
}

export const MOODS = ['neutral', 'happy', 'sad', 'confused'] as const;
export type Mood = (typeof MOODS)[number];

export interface Source {
  sourceId?: string;
  sourceName?: string;
  path: string;
  title: string;
}

export interface Answer {
  markdown: string;
  sources: Source[];
}

export interface SourcesUpdate {
  turn: number;
  sources: Source[];
}

/** LLM failure codes the agent publishes on `wiki.error` (see agent/src/llmDiagnostics.ts). */
export const AGENT_ERROR_CODES = [
  'unreachable',
  'timeout',
  'auth',
  'entra_token',
  'model_not_found',
  'rate_limited',
  'bad_request',
  'server_error',
  'empty_response',
  'unknown',
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export interface AgentError {
  code: AgentErrorCode;
  provider: 'ollama' | 'openai-compatible';
  model: string;
  /** Origin plus path of the LLM base URL, as the agent sees it. */
  endpoint: string;
  status?: number;
  /** Redacted technical detail. */
  detail?: string;
  recoverable: boolean;
  timestamp: number;
}

export function isAgentError(value: unknown): value is AgentError {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' &&
    (AGENT_ERROR_CODES as readonly string[]).includes(v.code) &&
    (v.provider === 'ollama' || v.provider === 'openai-compatible') &&
    typeof v.model === 'string' &&
    typeof v.endpoint === 'string' &&
    (v.status === undefined || typeof v.status === 'number') &&
    (v.detail === undefined || typeof v.detail === 'string') &&
    typeof v.recoverable === 'boolean' &&
    typeof v.timestamp === 'number'
  );
}

export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && (MOODS as readonly string[]).includes(value);
}

export function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
