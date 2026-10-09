import { describe, expect, it } from 'vitest';
import { isAgentError, parseJson } from '@/lib/protocol';

const valid = {
  code: 'auth',
  provider: 'openai-compatible',
  model: 'gpt-x',
  endpoint: 'https://api.example.com/v1',
  status: 401,
  detail: 'Incorrect API key',
  recoverable: false,
  timestamp: 1_700_000_000_000,
};

describe('isAgentError', () => {
  it('accepts the payload the agent publishes', () => {
    expect(isAgentError(valid)).toBe(true);
    expect(isAgentError(parseJson(JSON.stringify(valid)))).toBe(true);
    const { status: _status, detail: _detail, ...minimal } = valid;
    expect(isAgentError(minimal)).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(isAgentError(undefined)).toBe(false);
    expect(isAgentError('auth')).toBe(false);
    expect(isAgentError({ ...valid, code: 'nope' })).toBe(false);
    expect(isAgentError({ ...valid, provider: 'other' })).toBe(false);
    expect(isAgentError({ ...valid, recoverable: 'no' })).toBe(false);
    expect(isAgentError({ ...valid, status: '401' })).toBe(false);
    const { timestamp: _timestamp, ...noTimestamp } = valid;
    expect(isAgentError(noTimestamp)).toBe(false);
  });
});
