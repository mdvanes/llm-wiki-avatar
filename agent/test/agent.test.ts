import { APIConnectionError, APIStatusError, initializeLogger, llm, voice } from '@livekit/agents';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { probeLLM } from './helpers.ts';
import { REPO_ROOT, loadConfig } from '../src/config.ts';
import { LANGUAGE_PROFILES } from '../src/language.ts';
import { createLLM } from '../src/main.ts';
import { buildInstructions, buildWikiContext, wikiOverview } from '../src/prompts.ts';
import { RecordingPublisher, TOPICS } from '../src/publisher.ts';
import { SourceTracker, createWikiTools, listRecentChanges, readPage, searchWiki, showOnScreen, truncate } from '../src/tools.ts';
import { WikiAgent, containsCode } from '../src/wikiAgent.ts';
import { Wiki } from '../src/wiki/wiki.ts';

initializeLogger({ pretty: false, level: 'warn' });

// Defaults only, so a WIKI_SOURCES in .env does not replace the sample wiki.
const cfg = loadConfig({});
let wiki: Wiki;
beforeAll(async () => {
  wiki = await Wiki.open(cfg.WIKI_SOURCES);
});

function deps() {
  const publisher = new RecordingPublisher();
  return { wiki, cfg, publisher, sources: new SourceTracker(publisher) };
}

describe('config', () => {
  const api = {
    LLM_PROVIDER: 'openai-compatible',
    LLM_BASE_URL: 'https://api.example.com/v1',
    LLM_MODEL: 'tool-capable-model',
    LLM_API_KEY: 'test-key',
  };

  it('accepts explicit API configuration and legacy custom endpoints', () => {
    expect(loadConfig(api)).toMatchObject(api);
    expect(loadConfig({ ...api, LLM_PROVIDER: '' })).toMatchObject({
      LLM_BASE_URL: api.LLM_BASE_URL,
      LLM_MODEL: api.LLM_MODEL,
      LLM_API_KEY: api.LLM_API_KEY,
    });
  });

  const entra = {
    ...api,
    LLM_API_KEY: '',
    LLM_AUTH: 'entra',
    ENTRA_SCOPE: 'api://api.staging.example.com/.default',
  };

  it('accepts Entra CLI, managed identity and local auto mode without an API key', () => {
    for (const mode of ['cli', 'managed-identity', 'auto']) {
      expect(loadConfig({ ...entra, ENTRA_AUTH_MODE: mode })).toMatchObject({
        LLM_AUTH: 'entra', ENTRA_AUTH_MODE: mode, ENTRA_SCOPE: entra.ENTRA_SCOPE,
      });
    }
    expect(loadConfig(entra).ENTRA_AUTH_MODE).toBe('cli');
    expect(loadConfig({}).LLM_AUTH).toBe('api-key');
  });

  it('validates Entra scope and provider without exposing credentials', () => {
    expect(() => loadConfig({ ...entra, ENTRA_SCOPE: '' })).toThrow('ENTRA_SCOPE is required');
    expect(() => loadConfig({ ...entra, ENTRA_SCOPE: 'invalid' })).toThrow('must end with /.default');
    expect(() => loadConfig({ ...entra, LLM_PROVIDER: 'ollama' })).toThrow('requires LLM_PROVIDER=openai-compatible');
    expect(() => loadConfig({ ...entra, ENTRA_AUTH_MODE: 'unsupported' })).toThrow();
    expect(() => loadConfig({ ...entra, LLM_AUTH: 'unsupported' })).toThrow();
  });

  it('requires complete service-principal credentials for sp and auto modes', () => {
    const servicePrincipal = { AZURE_TENANT_ID: 'test-tenant', AZURE_CLIENT_ID: 'test-client', AZURE_CLIENT_SECRET: 'secret-value' };
    expect(loadConfig({ ...entra, ...servicePrincipal, ENTRA_AUTH_MODE: 'sp' }).AZURE_CLIENT_ID).toBe('test-client');
    for (const mode of ['sp', 'auto']) {
      for (const name of Object.keys(servicePrincipal)) {
        expect(() => loadConfig({ ...entra, ...servicePrincipal, ENTRA_AUTH_MODE: mode, [name]: '' })).toThrow(`${name} is required`);
      }
    }
  });

  it.each(['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY'])('requires an explicit API %s', (name) => {
    for (const value of [undefined, '', ' ']) {
      expect(() => loadConfig({ ...api, [name]: value })).toThrow(`${name} is required`);
    }
  });

  it.each(['ollama', 'YOUR_API_KEY'])('rejects the placeholder key %s for API mode', (key) => {
    expect(() => loadConfig({ ...api, LLM_API_KEY: key })).toThrow('LLM_API_KEY must be a real API key');
  });

  it.each(['not-a-url', 'file:///secret', 'https://user:secret@example.com/v1'])('rejects invalid endpoint %s', (url) => {
    expect(() => loadConfig({ ...api, LLM_BASE_URL: url })).toThrow('LLM_BASE_URL must be an HTTP(S) URL');
  });

  it('supports an Ollama Docker default without masking missing API configuration', () => {
    const docker = { LLM_OLLAMA_BASE_URL: 'http://host.docker.internal:11434/v1' };
    expect(loadConfig({ ...docker, LLM_PROVIDER: 'ollama' })).toMatchObject({
      LLM_BASE_URL: docker.LLM_OLLAMA_BASE_URL,
      LLM_API_KEY: 'ollama',
      LLM_MODEL: 'qwen3:4b-instruct',
    });
    expect(loadConfig({ ...docker, LLM_BASE_URL: api.LLM_BASE_URL }).LLM_BASE_URL).toBe(api.LLM_BASE_URL);
    expect(() => loadConfig({ ...api, ...docker, LLM_BASE_URL: '' })).toThrow('LLM_BASE_URL is required');
    expect(() => loadConfig({ LLM_PROVIDER: 'unsupported' })).toThrow();
  });

  it('has sensible defaults and ignores empty values', () => {
    const c = loadConfig({ LLM_MODEL: '', DEFAULT_LANGUAGE: 'nl' });
    expect(c.LLM_MODEL).toBe('qwen3:4b-instruct');
    expect(c.DEFAULT_LANGUAGE).toBe('nl');
  });

  it('can omit temperature for models that do not support it', () => {
    expect(loadConfig({ LLM_TEMPERATURE: 'omit' }).LLM_TEMPERATURE).toBeUndefined();
    expect(loadConfig({}).LLM_TEMPERATURE).toBe(0.3);
    expect(() => loadConfig({ LLM_TEMPERATURE: 'invalid' })).toThrow();
  });

  it('parses one or more ordered wiki sources relative to the repo root', () => {
    const single = loadConfig({});
    expect(single.WIKI_SOURCES).toEqual([{ id: 'wiki', name: 'Wiki', path: resolve(REPO_ROOT, 'sample-wiki') }]);
    const multiple = loadConfig({
      WIKI_SOURCES: '[{"id":"team-a","name":"Team A","path":"wikis/team-a"},{"id":"team-b","name":"Team B","path":"wikis/team-b"}]',
    });
    expect(multiple.WIKI_SOURCES?.map(({ id, path }) => ({ id, path }))).toEqual([
      { id: 'team-a', path: resolve(REPO_ROOT, 'wikis/team-a') },
      { id: 'team-b', path: resolve(REPO_ROOT, 'wikis/team-b') },
    ]);
    expect(() => loadConfig({ WIKI_SOURCES: 'not-json' })).toThrow(/WIKI_SOURCES/);
  });

  it('rejects unsupported languages', () => {
    expect(() => loadConfig({ DEFAULT_LANGUAGE: 'fr' })).toThrow();
  });
});

describe('LLM API compatibility', () => {
  it.each([
    { provider: 'ollama', auth: 'api-key' },
    { provider: 'openai-compatible', auth: 'api-key' },
    { provider: 'openai-compatible', auth: 'entra' },
  ])('streams text and wiki tool calls using $provider/$auth configuration', async ({ provider, auth }) => {
    let requestBody: Record<string, unknown> | undefined;
    let authorization: string | undefined;
    let requestPath: string | undefined;
    const server = createServer(async (request, response) => {
      requestPath = request.url;
      authorization = request.headers.authorization;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requestBody = JSON.parse(Buffer.concat(chunks).toString());
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const delta of [
        { role: 'assistant', content: 'Found the wiki page.' },
        { tool_calls: [{ index: 0, id: 'call-search', type: 'function', function: { name: 'searchWiki', arguments: '{"query":"Stripe"}' } }] },
      ]) {
        response.write(`data: ${JSON.stringify({ id: 'test-response', object: 'chat.completion.chunk', choices: [{ index: 0, delta }] })}\n\n`);
      }
      response.write(`data: ${JSON.stringify({ id: 'test-response', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock API did not start');
    const getToken = vi.fn().mockResolvedValue({ token: 'test-entra-token', expiresOnTimestamp: Date.now() + 3_600_000 });
    const model = createLLM(loadConfig({
      LLM_PROVIDER: provider,
      LLM_AUTH: auth,
      ENTRA_SCOPE: 'api://api.staging.example.com/.default',
      LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      LLM_MODEL: 'test-tool-model',
      LLM_API_KEY: 'test-api-key',
      LLM_TEMPERATURE: auth === 'entra' ? 'omit' : '0.4',
    }), auth === 'entra' ? { getToken } : undefined);
    const chatCtx = llm.ChatContext.empty();
    chatCtx.addMessage({ role: 'user', content: 'Search for Stripe.' });
    const stream = model.chat({
      chatCtx,
      toolCtx: createWikiTools(deps()),
      connOptions: { timeoutMs: 5000, maxRetry: 0, retryIntervalMs: 0 },
    });
    try {
      const result = await stream.collect();
      expect(result.text).toBe('Found the wiki page.');
      expect(result.toolCalls).toMatchObject([{ name: 'searchWiki', args: '{"query":"Stripe"}' }]);
      expect(requestPath).toBe('/v1/chat/completions');
      expect(authorization).toBe(auth === 'entra' ? 'Bearer test-entra-token' : 'Bearer test-api-key');
      if (auth === 'entra') expect(getToken.mock.calls[0]?.[0]).toEqual(['api://api.staging.example.com/.default']);
      expect(requestBody).toMatchObject({
        model: 'test-tool-model',
        stream: true,
        tools: expect.arrayContaining([
          expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'searchWiki' }) }),
        ]),
      });
      if (auth === 'entra') expect(requestBody).not.toHaveProperty('temperature');
      else expect(requestBody).toHaveProperty('temperature', 0.4);
    } finally {
      stream.close();
      await model.aclose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe('LLM preflight', () => {
  function modelWith(collect: () => Promise<{ text: string }>) {
    const close = vi.fn();
    return { model: { chat: vi.fn().mockReturnValue({ collect, close }) }, close };
  }

  it('checks chat streaming with configured timeout, not model listings', async () => {
    const { model, close } = modelWith(async () => ({ text: 'OK' }));
    await expect(probeLLM(model, cfg)).resolves.toBe(true);
    expect(model.chat).toHaveBeenCalledWith(expect.objectContaining({
      connOptions: { timeoutMs: 90_000, maxRetry: 0, retryIntervalMs: 0 },
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('skips offline local models but fails for configured APIs', async () => {
    const { model, close } = modelWith(async () => { throw new APIConnectionError({ message: 'private-endpoint' }); });
    await expect(probeLLM(model, cfg)).resolves.toBe(false);
    await expect(probeLLM(model, { ...cfg, LLM_PROVIDER: 'openai-compatible' })).rejects.toThrow('LLM preflight failed');
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('reports HTTP errors without leaking provider messages', async () => {
    const { model } = modelWith(async () => {
      throw new APIStatusError({ message: 'secret-api-key', options: { statusCode: 401 } });
    });
    await expect(probeLLM(model, cfg)).rejects.toThrow('LLM preflight failed (HTTP 401)');
    await expect(probeLLM(model, cfg)).rejects.not.toThrow('secret-api-key');
  });

  it('rejects an empty response', async () => {
    const { model, close } = modelWith(async () => ({ text: '' }));
    await expect(probeLLM(model, cfg)).rejects.toThrow('LLM preflight failed');
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('prompts', () => {
  it('injects the wiki index and the reply language', () => {
    const text = buildInstructions({
      language: LANGUAGE_PROFILES.nl,
      overview: wikiOverview(wiki.store, 4000),
    });
    expect(text).toContain('Always reply in Dutch');
    expect(text).toContain('[[Billing Service]]');
    expect(text).toContain('showOnScreen');
  });

  it('truncates the overview', () => {
    expect(wikiOverview(wiki.store, 50)).toMatch(/^# Wiki \(wiki\)\n# Acme Platform Wiki[\s\S]{0,60}\[\.\.\. index truncated \.\.\.\]$/);
  });

  it('builds a bounded wiki context from search hits', () => {
    const hits = wiki.search.search('stripe webhook retries', 4);
    const context = buildWikiContext(hits, 600)!;
    expect(context).toContain('## Billing Service (Wiki: wiki:pages/billing-service.md)');
    expect(context.length).toBeLessThanOrEqual(600);
    expect(buildWikiContext([], 600)).toBeUndefined();
  });
});

describe('tools', () => {
  it('searchWiki lists hits and publishes sources', () => {
    const d = deps();
    const out = searchWiki(d, 'invoice scheduler');
    expect(out).toMatch(/^1\. Billing Service \(Wiki: wiki:pages\/billing-service\.md\)/);
    expect(d.publisher.events).toEqual([
      {
        topic: TOPICS.sources,
        payload: {
          turn: 0,
          sources: expect.arrayContaining([
            expect.objectContaining({ sourceId: 'wiki', path: 'pages/billing-service.md', title: 'Billing Service' }),
          ]),
        },
      },
    ]);
    expect(searchWiki(d, 'zzzqqq')).toContain('No wiki pages match');
  });

  it('readPage returns bounded content and suggestions', () => {
    const d = { ...deps(), cfg: { ...cfg, WIKI_PAGE_MAX_CHARS: 200 } };
    const out = readPage(d, 'auth service');
    expect(out).toMatch(/^Page: Auth Service \(Wiki: wiki:pages\/auth-service\.md\)/);
    expect(out).toContain('[... page truncated ...]');
    expect(readPage(d, 'Payments Gateway Service')).toMatch(/No page named/);
    expect(readPage(d, '../../package.json')).toMatch(/No page named/);
  });

  it('listRecentChanges reads log.md newest first', () => {
    const out = listRecentChanges(deps(), 1);
    expect(out).toContain('## 2026-09-20');
    expect(out).not.toContain('2026-09-12');
  });

  it('showOnScreen publishes markdown with resolved sources', () => {
    const d = deps();
    const out = showOnScreen(d, '```bash\nmake dev\n```', ['Local Development', 'nope']);
    expect(out).toMatch(/shown on screen/i);
    expect(d.publisher.events[0]).toEqual({
      topic: TOPICS.answer,
      payload: {
        markdown: '```bash\nmake dev\n```',
        sources: [{ sourceId: 'wiki', sourceName: 'Wiki', path: 'pages/local-development.md', title: 'Local Development' }],
      },
    });
  });

  it('SourceTracker only publishes new sources and resets per turn', () => {
    const publisher = new RecordingPublisher();
    const tracker = new SourceTracker(publisher);
    tracker.newTurn();
    tracker.add([{ sourceId: 'wiki', sourceName: 'Wiki', path: 'a.md', title: 'A' }]);
    tracker.add([{ sourceId: 'wiki', sourceName: 'Wiki', path: 'a.md', title: 'A' }]);
    tracker.newTurn();
    tracker.add([{ sourceId: 'wiki', sourceName: 'Wiki', path: 'b.md', title: 'B' }]);
    expect(publisher.events.map((e) => e.payload)).toEqual([
      { turn: 1, sources: [{ sourceId: 'wiki', sourceName: 'Wiki', path: 'a.md', title: 'A' }] },
      { turn: 2, sources: [{ sourceId: 'wiki', sourceName: 'Wiki', path: 'b.md', title: 'B' }] },
    ]);
  });

  it('truncate cuts at a line break', () => {
    expect(truncate('aaaa\nbbbb\ncccc', 11)).toBe('aaaa\nbbbb\n\n[... page truncated ...]');
    expect(truncate('short', 10)).toBe('short');
  });
});

/** FakeLLM that also records the chat context of every request. */
class RecordingLLM extends voice.testing.FakeLLM {
  readonly requests: llm.ChatContext[] = [];
  override chat(params: Parameters<voice.testing.FakeLLM['chat']>[0]) {
    this.requests.push(params.chatCtx.copy());
    return super.chat(params);
  }
}

describe('WikiAgent in a session', () => {
  async function start(responses: voice.testing.FakeLLMResponse[]) {
    const fake = new RecordingLLM(responses);
    const publisher = new RecordingPublisher();
    const agent = new WikiAgent({ wiki, cfg, publisher, language: 'en' });
    const session = new voice.AgentSession({ llm: fake });
    await session.start({ agent });
    return { fake, publisher, agent, session };
  }

  it('injects wiki excerpts for the question without keeping them in history', async () => {
    const { fake, session } = await start([
      { input: 'How are Stripe webhooks retried?', content: '[mood:neutral] With backoff, see Billing Service.' },
      { input: 'Thanks!', content: '[mood:happy] You are welcome.' },
    ]);
    try {
      await session.run({ userInput: 'How are Stripe webhooks retried?' }).wait();
      const first = fake.requests[0]!;
      const texts = first.items.flatMap((i) => (i.type === 'message' ? [`${i.role}:${i.textContent}`] : []));
      const contextIdx = texts.findIndex((t) => t.startsWith('system:Wiki context') && t.includes('Billing Service'));
      expect(contextIdx).toBeGreaterThan(0);
      expect(texts[contextIdx + 1]).toBe('user:How are Stripe webhooks retried?');

      await session.run({ userInput: 'Thanks!' }).wait();
      const history = session.history.items.flatMap((i) => (i.type === 'message' ? [i.textContent ?? ''] : []));
      expect(history.some((t) => t.startsWith('Wiki context'))).toBe(false);
      // The follow-up gets fresh excerpts for its own question only.
      const second = fake.requests.at(-1)!;
      const contexts = second.items.filter((i) => i.type === 'message' && i.textContent?.startsWith('Wiki context'));
      expect(contexts.length).toBeLessThanOrEqual(1);
    } finally {
      await session.close();
    }
  });

  it('runs wiki tools called by the LLM', async () => {
    const { publisher, session } = await start([
      {
        input: 'How do I start the stack?',
        toolCalls: [{ name: 'showOnScreen', args: { markdown: '`make dev`', sources: ['Local Development'] } }],
      },
      { input: JSON.stringify('Shown on screen. Now tell the user in one short sentence that the details are on their screen; do not repeat them.'), content: '[mood:happy] It is on your screen.' },
    ]);
    try {
      const result = await session.run({ userInput: 'How do I start the stack?' }).wait();
      result.expect.nextEvent().isFunctionCall({ name: 'showOnScreen' });
      result.expect.nextEvent().isFunctionCallOutput();
      result.expect.nextEvent().isMessage({ role: 'assistant' });
      expect(publisher.events.filter((e) => e.topic === TOPICS.answer)).toHaveLength(1);
    } finally {
      await session.close();
    }
  });

  it('puts replies with code on screen when the model skipped showOnScreen', async () => {
    const { publisher, session } = await start([
      { input: 'Which command rolls back?', content: '[mood:neutral] Use `helm rollback <release> <revision>`, see [[Deployment]].' },
      { input: 'Thanks!', content: '[mood:happy] You are welcome.' },
    ]);
    try {
      await session.run({ userInput: 'Which command rolls back?' }).wait();
      await session.run({ userInput: 'Thanks!' }).wait();
      const answers = publisher.events.filter((e) => e.topic === TOPICS.answer);
      expect(answers).toHaveLength(1);
      expect(answers[0]!.payload).toMatchObject({
        markdown: 'Use `helm rollback <release> <revision>`, see [[Deployment]].',
        sources: expect.arrayContaining([
          expect.objectContaining({ sourceId: 'wiki', path: 'pages/deployment.md', title: 'Deployment' }),
        ]),
      });
    } finally {
      await session.close();
    }
  });
});

describe('containsCode', () => {
  it.each([
    ['Run `make dev` first.', true],
    ['```bash\nmake dev\n```', true],
    ['Just prose, no code.', false],
    ['A lone ` backtick', false],
  ])('%j -> %s', (text, expected) => {
    expect(containsCode(text)).toBe(expected);
  });
});

describe('WikiAgent.setLanguage', () => {
  it('switches the instructions and notifies the UI', async () => {
    const publisher = new RecordingPublisher();
    const agent = new WikiAgent({ wiki, cfg, publisher, language: 'en' });
    expect(agent.instructions).toContain('Always reply in English');
    await agent.setLanguage('nl', { announce: false });
    expect(agent.language).toBe('nl');
    expect(agent.instructions).toContain('Always reply in Dutch');
    expect(publisher.events).toEqual([{ topic: TOPICS.language, payload: 'nl' }]);
    await agent.setLanguage('nl', { announce: false });
    expect(publisher.events).toHaveLength(1);
  });
});

describe('llm tool definitions', () => {
  it('exposes the four wiki tools', async () => {
    const publisher = new RecordingPublisher();
    const agent = new WikiAgent({ wiki, cfg, publisher, language: 'en' });
    expect(Object.keys(agent.toolCtx.functionTools ?? {}).sort()).toEqual(
      ['listRecentChanges', 'readPage', 'searchWiki', 'showOnScreen'],
    );
  });
});
