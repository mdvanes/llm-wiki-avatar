import { APIConnectionError, APIError, APIStatusError, APITimeoutError, llm } from '@livekit/agents';
import type { Config } from './config.ts';

/** Error codes shared with the frontend (see frontend/lib/protocol.ts), which turns them into localized text. */
export const LLM_ERROR_CODES = [
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
export type LLMErrorCode = (typeof LLM_ERROR_CODES)[number];

export type Provider = 'ollama' | 'openai-compatible';

export interface LLMErrorInfo {
  code: LLMErrorCode;
  status?: number;
  /** Redacted, truncated technical detail; safe to log and show. */
  detail: string;
  recoverable: boolean;
}

export interface EndpointInfo {
  provider: Provider;
  model: string;
  auth: Config['LLM_AUTH'];
  /** Origin plus path of LLM_BASE_URL; never a query string or credentials. */
  endpoint: string;
}

type EndpointConfig = Pick<Config, 'LLM_PROVIDER' | 'LLM_MODEL' | 'LLM_AUTH' | 'LLM_BASE_URL'>;
type SecretConfig = Partial<Pick<Config, 'LLM_API_KEY' | 'AZURE_CLIENT_SECRET'>>;

const DETAIL_MAX = 300;
const ENTRA_MESSAGE = 'Entra token acquisition failed';
const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);
const TLS_PATTERN = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i;

export function describeEndpoint(cfg: EndpointConfig): EndpointInfo {
  return {
    provider: cfg.LLM_PROVIDER ?? 'ollama',
    model: cfg.LLM_MODEL,
    auth: cfg.LLM_AUTH,
    endpoint: safeUrl(cfg.LLM_BASE_URL),
  };
}

/** Origin plus path, so credentials, query strings (e.g. `api-key=`) and fragments never leak. */
export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return '(invalid URL)';
  }
}

/** Strips secrets (configured keys, bearer tokens, `key=` params, URL credentials and queries) and truncates. */
export function redact(text: string, secrets: SecretConfig = {}): string {
  let out = text;
  for (const secret of [secrets.LLM_API_KEY, secrets.AZURE_CLIENT_SECRET]) {
    if (secret && secret.length >= 4 && secret !== 'ollama') out = out.split(secret).join('[redacted]');
  }
  out = out
    .replace(/(bearer\s+)[\w\-.~+/=]+/gi, '$1[redacted]')
    .replace(/\b(sk|rk|pk)-[\w-]{8,}/g, '[redacted]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]')
    .replace(/((?:api[-_]?key|key|token|secret|password|access_token)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1')
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > DETAIL_MAX ? `${out.slice(0, DETAIL_MAX - 1)}…` : out;
}

function causes(err: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = err;
  while (current && chain.length < 6 && !chain.includes(current)) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function messageOf(err: unknown): string {
  return causes(err)
    .map((e) => {
      if (e instanceof Error) {
        const code = (e as { code?: unknown }).code;
        return typeof code === 'string' ? `${e.message} (${code})` : e.message;
      }
      return typeof e === 'string' ? e : '';
    })
    .filter(Boolean)
    .join(': ');
}

function networkCode(err: unknown): string | undefined {
  for (const e of causes(err)) {
    const code = (e as { code?: unknown })?.code;
    if (typeof code === 'string' && (NETWORK_CODES.has(code) || TLS_PATTERN.test(code))) return code;
  }
  return undefined;
}

function statusOf(err: unknown): number | undefined {
  for (const e of causes(err)) {
    if (e instanceof APIStatusError) return e.statusCode > 0 ? e.statusCode : undefined;
    const status = (e as { status?: unknown; statusCode?: unknown })?.status ?? (e as { statusCode?: unknown })?.statusCode;
    if (typeof status === 'number' && status >= 100) return status;
  }
  return undefined;
}

function codeForStatus(status: number): LLMErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model_not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

/**
 * Classifies an LLM failure into a code the UI can explain. `recoverable` is true when retrying the same
 * request later may work (network blips, rate limits, server errors); configuration problems are not.
 */
export function classifyLLMError(err: unknown, cfg: SecretConfig = {}): LLMErrorInfo {
  const message = messageOf(err);
  const detail = redact(message || String(err), cfg);
  const status = statusOf(err);

  if (message.includes(ENTRA_MESSAGE)) return { code: 'entra_token', detail, recoverable: false };
  if (causes(err).some((e) => e instanceof APITimeoutError) || (/timed? ?out/i.test(message) && status === undefined)) {
    return { code: 'timeout', detail, recoverable: true };
  }
  if (status !== undefined) {
    const code = codeForStatus(status);
    return { code, status, detail, recoverable: ['rate_limited', 'server_error', 'timeout'].includes(code) };
  }
  if (message.includes('empty response') || message.includes('Empty response')) {
    return { code: 'empty_response', detail, recoverable: false };
  }
  // The OpenAI client reports refused / DNS / TLS failures as a connection error without an HTTP status;
  // the livekit plugin turns that into APIConnectionError or an APIStatusError with status -1.
  if (
    networkCode(err) ||
    causes(err).some((e) => e instanceof APIConnectionError || (e instanceof APIStatusError && e.statusCode <= 0)) ||
    /connection error|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)
  ) {
    return { code: 'unreachable', detail, recoverable: true };
  }
  return { code: 'unknown', detail, recoverable: err instanceof APIError ? err.retryable : false };
}

const HINTS: Record<LLMErrorCode, (e: EndpointInfo) => string> = {
  unreachable: (e) => e.provider === 'ollama'
    ? `Cannot reach Ollama at ${e.endpoint}. Start it (ollama serve) and check LLM_BASE_URL; a Docker agent needs host.docker.internal instead of localhost.`
    : `Cannot reach ${e.endpoint}. Check LLM_BASE_URL (including /v1), DNS/network access, and NODE_EXTRA_CA_CERTS for a private CA.`,
  timeout: () => 'The LLM did not answer in time. Increase LLM_TIMEOUT_S, or use a smaller/faster model.',
  auth: (e) => e.auth === 'entra'
    ? 'The gateway rejected the Entra token. Check ENTRA_SCOPE, tenant, and gateway/model permissions (401 = wrong tenant/scope, 403 = missing role).'
    : 'The API rejected the credentials. Check LLM_API_KEY.',
  entra_token: () => 'Could not get an Entra token. Run az login (cli mode) or check ENTRA_AUTH_MODE, ENTRA_SCOPE and AZURE_* credentials.',
  model_not_found: (e) => e.provider === 'ollama'
    ? `Model "${e.model}" not found. Run: ollama pull ${e.model}`
    : `Model or deployment "${e.model}" not found. Check LLM_MODEL and the /v1 path in LLM_BASE_URL.`,
  rate_limited: () => 'Rate limited or out of quota. Wait and retry, or check the plan/quota of the API account.',
  bad_request: () => 'The API rejected the request. Try LLM_TEMPERATURE=omit, unset LLM_REASONING_EFFORT, and use a model that supports streaming and tool calling.',
  server_error: () => 'The LLM server returned an error. Check the server logs or try again later.',
  empty_response: () => 'The model returned an empty response. Use a model that supports chat and tool calling.',
  unknown: () => 'Unexpected LLM error. Check the detail and the configuration.',
};

export function hintFor(code: LLMErrorCode, endpoint: EndpointInfo): string {
  return HINTS[code](endpoint);
}

/** Configuration combinations that are likely mistakes, logged as warnings at startup. */
export function configWarnings(
  cfg: Pick<Config, 'LLM_PROVIDER' | 'LLM_BASE_URL'>,
  env: { inDocker?: boolean } = {},
): string[] {
  const warnings: string[] = [];
  let host = '';
  try {
    host = new URL(cfg.LLM_BASE_URL).hostname;
  } catch {
    return warnings;
  }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  const provider = cfg.LLM_PROVIDER ?? 'ollama';
  if (provider === 'ollama' && !local && !['host.docker.internal', 'ollama'].includes(host)) {
    warnings.push(`LLM_PROVIDER is ollama but LLM_BASE_URL points at ${host}; set LLM_PROVIDER=openai-compatible for a hosted API.`);
  }
  if (env.inDocker && local) {
    warnings.push('The agent runs in Docker but LLM_BASE_URL uses localhost, which is the container itself. Use host.docker.internal or the ollama service.');
  }
  if (!cfg.LLM_BASE_URL.replace(/\/$/, '').endsWith('/v1') && provider === 'ollama') {
    warnings.push('LLM_BASE_URL for Ollama usually ends with /v1 (e.g. http://localhost:11434/v1).');
  }
  return warnings;
}

export type PreflightResult =
  | { ok: true; latencyMs: number }
  | { ok: false; latencyMs: number; error: LLMErrorInfo };

export type PreflightModel = Pick<llm.LLM, 'chat'> & Partial<Pick<llm.LLM, 'on' | 'off'>>;

/**
 * Sends a tiny chat request to check the endpoint, credentials and model. Never throws.
 * Use a model instance the session does not use: the stream swallows request errors and only emits them as
 * `error` events on the model, which a session would also count towards closing itself.
 */
export async function preflightLLM(
  model: PreflightModel,
  cfg: Pick<Config, 'LLM_TIMEOUT_S'> & SecretConfig,
): Promise<PreflightResult> {
  const started = Date.now();
  const chatCtx = llm.ChatContext.empty();
  chatCtx.addMessage({ role: 'user', content: 'Reply with OK.' });
  let failure: unknown;
  const onError = (ev: { error: unknown }) => {
    failure ??= ev.error;
  };
  model.on?.('error', onError);
  let stream: ReturnType<llm.LLM['chat']> | undefined;
  try {
    stream = model.chat({
      chatCtx,
      connOptions: { timeoutMs: cfg.LLM_TIMEOUT_S * 1000, maxRetry: 0, retryIntervalMs: 0 },
    });
    const response = await stream.collect();
    if (failure) throw failure;
    if (!response.text.trim()) throw new Error('LLM returned an empty response');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: classifyLLMError(err, cfg) };
  } finally {
    stream?.close();
    model.off?.('error', onError);
  }
}
