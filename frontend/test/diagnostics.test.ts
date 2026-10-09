import { describe, expect, it } from 'vitest';
import {
  describeAgentAbsence,
  describeAgentError,
  describeConnectionError,
  describeDisconnect,
  fill,
  isUnexpectedDisconnect,
} from '@/lib/diagnostics';
import { LANGUAGES, STRINGS } from '@/lib/language';
import { AGENT_ERROR_CODES, type AgentError } from '@/lib/protocol';

const en = STRINGS.en;

function agentError(overrides: Partial<AgentError> = {}): AgentError {
  return {
    code: 'unreachable',
    provider: 'ollama',
    model: 'qwen3:4b-instruct',
    endpoint: 'http://localhost:11434/v1',
    recoverable: true,
    timestamp: 1,
    ...overrides,
  };
}

const commands = (steps: { command?: string }[]) => steps.flatMap((s) => (s.command ? [s.command] : []));

describe('describeAgentError', () => {
  it('gives Ollama-specific steps', () => {
    const problem = describeAgentError(agentError(), en);
    expect(problem.title).toBe(en.errLlmUnreachable);
    expect(problem.message).toContain('http://localhost:11434/v1');
    expect(commands(problem.steps)).toContain('ollama serve');
    expect(problem.steps.some((s) => s.text.includes('host.docker.internal'))).toBe(true);

    const missing = describeAgentError(agentError({ code: 'model_not_found', status: 404 }), en);
    expect(commands(missing.steps)).toContain('ollama pull qwen3:4b-instruct');
    expect(missing.message).toContain('HTTP 404');
  });

  it('gives different steps for openai-compatible APIs', () => {
    const api = agentError({ provider: 'openai-compatible', endpoint: 'https://api.example.com/v1', model: 'gpt-x' });
    const unreachable = describeAgentError(api, en);
    expect(commands(unreachable.steps)).not.toContain('ollama serve');
    expect(unreachable.steps.some((s) => s.text.includes('NODE_EXTRA_CA_CERTS'))).toBe(true);
    expect(describeAgentError({ ...api, code: 'auth' }, en).steps.some((s) => s.text.includes('LLM_API_KEY'))).toBe(true);
    expect(commands(describeAgentError({ ...api, code: 'entra_token' }, en).steps)).toContain('az login');
    expect(describeAgentError({ ...api, code: 'model_not_found' }, en).steps[0]!.text).toContain('gpt-x');
    expect(commands(describeAgentError({ ...api, code: 'bad_request' }, en).steps)).toContain('LLM_TEMPERATURE=omit');
  });

  it('has a title, steps and a log hint for every code in both languages', () => {
    for (const { code: language } of LANGUAGES) {
      const s = STRINGS[language];
      for (const code of AGENT_ERROR_CODES) {
        for (const provider of ['ollama', 'openai-compatible'] as const) {
          const problem = describeAgentError(agentError({ code, provider }), s);
          expect(problem.title, `${language}/${code}`).toBeTruthy();
          expect(problem.steps.length).toBeGreaterThan(1);
          expect(problem.steps.at(-1)!.command).toBe('docker compose logs -f agent');
          expect(JSON.stringify(problem)).not.toMatch(/\{(model|endpoint|provider|status)\}/);
        }
      }
    }
    expect(describeAgentError(agentError(), STRINGS.nl).title).toBe(STRINGS.nl.errLlmUnreachable);
  });
});

describe('describeConnectionError', () => {
  it('explains an unreachable LiveKit server with the URL', () => {
    const err = Object.assign(new Error('could not establish signal connection'), { reason: 1 });
    const problem = describeConnectionError(err, 'ws://localhost:7880', en);
    expect(problem.title).toBe(en.errLivekitUnreachableTitle);
    expect(problem.message).toContain('ws://localhost:7880');
    expect(commands(problem.steps)).toEqual(['livekit-server --dev', 'docker compose up -d livekit']);
    expect(problem.steps.some((s) => s.text.includes('7882'))).toBe(true);
  });

  it('explains token endpoint failures with the server reason', () => {
    const err = new Error('Error generating token from endpoint /api/token: received 500 / {"error":"WIKI_SOURCES must be a JSON array"}');
    const problem = describeConnectionError(err, undefined, en);
    expect(problem.title).toBe(en.errTokenTitle);
    expect(problem.message).toContain('WIKI_SOURCES must be a JSON array');
    expect(describeConnectionError(new TypeError('Failed to fetch'), undefined, en).title).toBe(en.errTokenTitle);
  });

  it('explains rejected LiveKit credentials', () => {
    const err = Object.assign(new Error('invalid API key'), { reason: 0, status: 401 });
    expect(describeConnectionError(err, 'ws://lk', en).title).toBe(en.errLivekitAuthTitle);
  });

  it('falls back to a generic message', () => {
    const problem = describeConnectionError(new Error('weird'), undefined, en);
    expect(problem.title).toBe(en.errConnectTitle);
    expect(problem.detail).toBe('weird');
  });
});

describe('disconnects and agent absence', () => {
  it('treats only a client-initiated disconnect as expected', () => {
    expect(isUnexpectedDisconnect(1)).toBe(false);
    expect(isUnexpectedDisconnect(3)).toBe(true);
    expect(isUnexpectedDisconnect(undefined)).toBe(true);
    expect(describeDisconnect(3, en).message).toContain('SERVER_SHUTDOWN');
  });

  it('maps the SDK failure reasons', () => {
    const absent = describeAgentAbsence(['Agent did not join the room.'], en);
    expect(absent.title).toBe(en.errAgentAbsentTitle);
    expect(commands(absent.steps)).toContain('npm run dev -w agent');
    expect(absent.steps.some((s) => s.text.includes('AGENT_NAME'))).toBe(true);
    expect(describeAgentAbsence(['Agent left the room unexpectedly.'], en).title).toBe(en.errAgentLeftTitle);
    expect(describeAgentAbsence(['Agent joined the room but did not complete initializing.'], en).title)
      .toBe(en.errAgentInitTitle);
  });
});

describe('strings', () => {
  it('has the same keys in every language', () => {
    expect(Object.keys(STRINGS.nl).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it('fills placeholders', () => {
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
});
