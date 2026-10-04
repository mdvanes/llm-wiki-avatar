import { initializeLogger, type llm, voice } from '@livekit/agents';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT, isVoice, loadConfig } from '../src/config.ts';
import { languageProfiles } from '../src/language.ts';
import { buildInstructions, buildWikiContext, wikiOverview } from '../src/prompts.ts';
import { RecordingPublisher, TOPICS } from '../src/publisher.ts';
import { SourceTracker, listRecentChanges, readPage, searchWiki, showOnScreen, truncate } from '../src/tools.ts';
import { WikiAgent, containsCode } from '../src/wikiAgent.ts';
import { Wiki } from '../src/wiki/wiki.ts';

initializeLogger({ pretty: false, level: 'warn' });

const cfg = loadConfig();
let wiki: Wiki;
beforeAll(async () => {
  wiki = await Wiki.open(cfg.WIKI_SOURCES);
});

function deps() {
  const publisher = new RecordingPublisher();
  return { wiki, cfg, publisher, sources: new SourceTracker(publisher) };
}

describe('config and language profiles', () => {
  it('has sensible defaults and ignores empty values', () => {
    const c = loadConfig({ LLM_MODEL: '', DEFAULT_LANGUAGE: 'nl', STT_FUZZY_CORRECTION: 'false' });
    expect(c.LLM_MODEL).toBe('qwen3:4b-instruct');
    expect(c.DEFAULT_LANGUAGE).toBe('nl');
    expect(c.STT_FUZZY_CORRECTION).toBe(false);
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

  it('routes Dutch to the Piper voice and English to Kokoro', () => {
    const profiles = languageProfiles(loadConfig({ TTS_NL_BASE_URL: 'http://piper:8000/v1' }));
    expect(profiles.en.voices.female).toMatchObject({ model: expect.stringContaining('Kokoro'), voice: 'af_heart' });
    expect(profiles.nl.voices.female).toEqual({
      baseURL: 'http://piper:8000/v1',
      model: 'speaches-ai/piper-nl_BE-nathalie-medium',
      voice: 'nathalie',
    });
    expect(profiles.nl.whisperLanguage).toBe('nl');
  });

  it('has male voices per language, with their own server override', () => {
    const profiles = languageProfiles(
      loadConfig({ SPEACHES_URL: 'http://speaches/v1', TTS_EN_MALE_BASE_URL: 'http://kokoro/v1' }),
    );
    expect(profiles.en.voices.male).toEqual({
      baseURL: 'http://kokoro/v1',
      model: 'speaches-ai/Kokoro-82M-v1.0-ONNX',
      voice: 'am_michael',
    });
    expect(profiles.nl.voices.male).toEqual({
      baseURL: 'http://speaches/v1',
      model: 'speaches-ai/piper-nl_BE-rdh-medium',
      voice: 'rdh',
    });
  });

  it('parses the default voice', () => {
    expect(loadConfig({}).DEFAULT_VOICE).toBe('female');
    expect(loadConfig({ DEFAULT_VOICE: 'off' }).DEFAULT_VOICE).toBe('off');
    expect(() => loadConfig({ DEFAULT_VOICE: 'robot' })).toThrow();
    expect(isVoice('male')).toBe(true);
    expect(isVoice('Male')).toBe(false);
    expect(isVoice(undefined)).toBe(false);
  });
});

describe('prompts', () => {
  it('injects the wiki index and the reply language', () => {
    const text = buildInstructions({
      language: languageProfiles(cfg).nl,
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
    const agent = new WikiAgent({ wiki, cfg, publisher, profiles: languageProfiles(cfg), language: 'en' });
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

describe('llm tool definitions', () => {
  it('exposes the four wiki tools', async () => {
    const publisher = new RecordingPublisher();
    const agent = new WikiAgent({ wiki, cfg, publisher, profiles: languageProfiles(cfg), language: 'en' });
    expect(Object.keys(agent.toolCtx.functionTools ?? {}).sort()).toEqual(
      ['listRecentChanges', 'readPage', 'searchWiki', 'showOnScreen'],
    );
  });
});
