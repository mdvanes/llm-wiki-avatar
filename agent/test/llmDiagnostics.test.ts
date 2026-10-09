import { APIConnectionError, APIStatusError, APITimeoutError } from '@livekit/agents';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import {
  LLM_ERROR_CODES,
  classifyLLMError,
  configWarnings,
  describeEndpoint,
  hintFor,
  preflightLLM,
  redact,
} from '../src/llmDiagnostics.ts';
import { RecordingPublisher, TOPICS } from '../src/publisher.ts';

const cfg = loadConfig({});
const api = loadConfig({
  LLM_PROVIDER: 'openai-compatible',
  LLM_BASE_URL: 'https://api.example.com/v1?api-version=2024&api-key=leaky',
  LLM_MODEL: 'gpt-test',
  LLM_API_KEY: 'sk-supersecretvalue123',
});

const status = (statusCode: number, message = 'boom') => new APIStatusError({ message, options: { statusCode } });

describe('classifyLLMError', () => {
  it('maps HTTP statuses to codes', () => {
    expect(classifyLLMError(status(401))).toMatchObject({ code: 'auth', status: 401, recoverable: false });
    expect(classifyLLMError(status(403))).toMatchObject({ code: 'auth', status: 403 });
    expect(classifyLLMError(status(404))).toMatchObject({ code: 'model_not_found', status: 404 });
    expect(classifyLLMError(status(429))).toMatchObject({ code: 'rate_limited', recoverable: true });
    expect(classifyLLMError(status(400, 'temperature not supported'))).toMatchObject({ code: 'bad_request' });
    expect(classifyLLMError(status(503))).toMatchObject({ code: 'server_error', recoverable: true });
  });

  it('detects unreachable endpoints and timeouts', () => {
    expect(classifyLLMError(new APIConnectionError({ message: 'Connection error.' })).code).toBe('unreachable');
    // The OpenAI plugin reports a refused connection as a status error without an HTTP status.
    expect(classifyLLMError(new APIStatusError({ message: 'Connection error.' })).code).toBe('unreachable');
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
    expect(classifyLLMError(new Error('fetch failed', { cause: refused }))).toMatchObject({
      code: 'unreachable',
      recoverable: true,
    });
    const tls = Object.assign(new Error('self-signed certificate'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    expect(classifyLLMError(new Error('request failed', { cause: tls })).code).toBe('unreachable');
    expect(classifyLLMError(new APITimeoutError({})).code).toBe('timeout');
  });

  it('recognizes Entra token failures and unknown errors', () => {
    const entra = new APIConnectionError({
      message: "Failed to get token from 'apiKey' function: Entra token acquisition failed. Check ENTRA_AUTH_MODE.",
    });
    expect(classifyLLMError(entra).code).toBe('entra_token');
    expect(classifyLLMError(new Error('something odd')).code).toBe('unknown');
    expect(classifyLLMError('a string').code).toBe('unknown');
  });

  it('never leaks keys, tokens or query strings in the detail', () => {
    const err = status(401, `Incorrect API key provided: sk-supersecretvalue123. Bearer eyJabc.def.ghi at https://user:pw@api.example.com/v1?api-key=leaky`);
    const { detail } = classifyLLMError(err, api);
    expect(detail).not.toContain('supersecret');
    expect(detail).not.toContain('eyJabc');
    expect(detail).not.toContain('leaky');
    expect(detail).not.toContain('user:pw');
    expect(classifyLLMError(status(500, 'x'.repeat(1000))).detail.length).toBeLessThanOrEqual(300);
  });
});

describe('describeEndpoint', () => {
  it('reports provider, model and auth with origin plus path only', () => {
    expect(describeEndpoint(api)).toEqual({
      provider: 'openai-compatible',
      model: 'gpt-test',
      auth: 'api-key',
      endpoint: 'https://api.example.com/v1',
    });
    expect(describeEndpoint(cfg).provider).toBe('ollama');
  });

  it('has a hint for every code', () => {
    for (const code of LLM_ERROR_CODES) {
      expect(hintFor(code, describeEndpoint(cfg))).toBeTruthy();
      expect(hintFor(code, describeEndpoint(api))).not.toContain('supersecret');
    }
    expect(hintFor('model_not_found', describeEndpoint(cfg))).toContain('ollama pull qwen3:4b-instruct');
  });
});

describe('redact', () => {
  it('removes configured secrets but keeps the local placeholder', () => {
    expect(redact('key is abcd1234', { LLM_API_KEY: 'abcd1234' })).toBe('key is [redacted]');
    expect(redact('ollama is down', { LLM_API_KEY: 'ollama' })).toBe('ollama is down');
  });
});

describe('configWarnings', () => {
  it('warns about suspicious combinations', () => {
    expect(configWarnings({ LLM_PROVIDER: 'ollama', LLM_BASE_URL: 'https://api.openai.com/v1' })).toHaveLength(1);
    expect(configWarnings({ LLM_PROVIDER: undefined, LLM_BASE_URL: 'http://localhost:11434/v1' }, { inDocker: true }))
      .toEqual([expect.stringContaining('Docker')]);
    expect(configWarnings({ LLM_PROVIDER: 'ollama', LLM_BASE_URL: 'http://localhost:11434/v1' })).toEqual([]);
  });
});

describe('preflightLLM', () => {
  function modelWith(collect: () => Promise<{ text: string }>) {
    const close = vi.fn();
    return { model: { chat: vi.fn().mockReturnValue({ collect, close }) }, close };
  }

  it('reports success with latency', async () => {
    const { model, close } = modelWith(async () => ({ text: 'OK' }));
    const result = await preflightLLM(model, cfg);
    expect(result).toMatchObject({ ok: true });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(close).toHaveBeenCalledOnce();
  });

  it('classifies connection failures, 401s and timeouts without throwing', async () => {
    const cases: Array<[Error, string]> = [
      [new APIConnectionError({ message: 'Connection error.' }), 'unreachable'],
      [status(401, 'invalid key sk-supersecretvalue123'), 'auth'],
      [new APITimeoutError({}), 'timeout'],
    ];
    for (const [error, code] of cases) {
      const { model, close } = modelWith(async () => { throw error; });
      const result = await preflightLLM(model, api);
      expect(result).toMatchObject({ ok: false, error: { code } });
      if (!result.ok) expect(result.error.detail).not.toContain('supersecret');
      expect(close).toHaveBeenCalledOnce();
    }
  });

  it('treats an empty reply as a failure', async () => {
    const { model } = modelWith(async () => ({ text: ' ' }));
    expect(await preflightLLM(model, cfg)).toMatchObject({ ok: false, error: { code: 'empty_response' } });
  });
});

describe('RecordingPublisher', () => {
  it('records wiki.error payloads', () => {
    const publisher = new RecordingPublisher();
    const payload = {
      code: 'auth' as const,
      ...describeEndpoint(api),
      status: 401,
      recoverable: false,
      timestamp: 1,
    };
    publisher.error(payload);
    expect(TOPICS.error).toBe('wiki.error');
    expect(publisher.events).toEqual([{ topic: 'wiki.error', payload }]);
  });
});
