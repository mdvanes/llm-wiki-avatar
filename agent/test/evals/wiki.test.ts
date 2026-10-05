/**
 * Behavioural evals against a real LLM (Ollama by default). Skipped when the LLM is unreachable.
 *
 *   npm run eval                          # uses LLM_* from .env / .env.local
 *   LLM_MODEL=qwen3.5:9b LLM_REASONING_EFFORT=none npm run eval
 *
 * They check the things that make a voice wiki pleasant: short spoken answers grounded in the wiki,
 * no code read aloud, details sent to the screen, and replies in the selected language.
 */
import { initializeLogger, voice } from '@livekit/agents';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Language, loadConfig } from '../../src/config.ts';
import { createLLM } from '../../src/main.ts';
import { type Mood, extractMood } from '../../src/mood.ts';
import { RecordingPublisher, TOPICS } from '../../src/publisher.ts';
import { WikiAgent } from '../../src/wikiAgent.ts';
import { Wiki } from '../../src/wiki/wiki.ts';
import { SAMPLE_WIKI } from '../helpers.ts';

initializeLogger({ pretty: false, level: 'warn' });

const cfg = loadConfig({ ...process.env });
const reachable = await fetch(`${cfg.LLM_BASE_URL.replace(/\/$/, '')}/models`, {
  headers: { authorization: `Bearer ${cfg.LLM_API_KEY}` },
  signal: AbortSignal.timeout(3000),
})
  .then((r) => r.ok)
  .catch(() => false);
if (!reachable) console.warn(`LLM at ${cfg.LLM_BASE_URL} is unreachable; skipping evals.`);

const model = createLLM(cfg);
let wiki: Wiki;
let session: voice.AgentSession | undefined;

beforeAll(async () => {
  wiki = await Wiki.open(SAMPLE_WIKI);
});
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function ask(question: string, language: Language = 'en') {
  const publisher = new RecordingPublisher();
  const agent = new WikiAgent({ wiki, cfg, publisher, language });
  session = new voice.AgentSession({ llm: model });
  await session.start({ agent });
  const result = await session.run({ userInput: question }).wait();
  const raw = result.events
    .flatMap((ev) => (ev.type === 'message' && ev.item.role === 'assistant' ? [ev.item.textContent ?? ''] : []))
    .join(' ');
  // The assistant message holds the transcript, from which WikiAgent already removed the mood tag.
  const { text } = extractMood(raw);
  const moods = publisher.events.filter((e) => e.topic === TOPICS.mood).map((e) => e.payload as Mood);
  return { result, spoken: text.trim(), mood: moods[0], publisher };
}

function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0).length;
}

describe.skipIf(!reachable)(`voice wiki evals (${cfg.LLM_MODEL})`, { timeout: 180_000 }, () => {
  it('gives a short, grounded spoken answer with a mood tag', async () => {
    const { spoken, mood, result } = await ask('How are failed Stripe webhooks handled?');
    expect(mood).toBeDefined();
    expect(spoken).not.toMatch(/\[mood:/);
    expect(spoken).not.toMatch(/```/);
    expect(sentenceCount(spoken)).toBeLessThanOrEqual(4);
    await result.expect
      .range()
      .containsMessage({ role: 'assistant' })
      .judge(model, {
        intent:
          'Says that failed Stripe webhook events are retried (five times, with exponential backoff) and then end up in a dead-letter queue.',
      });
  });

  it('finds answers that are further down a page', async () => {
    const { result } = await ask('How do I roll back a deploy?');
    await result.expect
      .range()
      .containsMessage({ role: 'assistant' })
      .judge(model, { intent: 'Explains that rollbacks use helm rollback or reverting the merge commit.' });
  });

  it('puts commands on screen instead of reading them aloud', async () => {
    const { spoken, publisher } = await ask('What is the exact command to roll back a deployment? Show it to me.');
    const answers = publisher.events.filter((e) => e.topic === TOPICS.answer);
    expect(answers.length).toBeGreaterThan(0);
    expect(JSON.stringify(answers[0]!.payload)).toMatch(/helm rollback/);
    // The transcript may show inline code; the prose around it must not spell out the command.
    const heard = spoken.replace(/`[^`]*`/g, '');
    expect(heard).not.toMatch(/```|<release>|helm rollback/);
  });

  it('answers in Dutch when Dutch is selected', async () => {
    const { result } = await ask('Welk cluster gebruiken we voor staging?', 'nl');
    await result.expect
      .range()
      .containsMessage({ role: 'assistant' })
      .judge(model, {
        intent: 'Answers in Dutch (not English) that staging runs on the k8s-staging-eu2 cluster.',
      });
  });

  it('admits when the wiki does not know', async () => {
    const { result, mood } = await ask('What is the company vacation policy?');
    expect(mood).not.toBe('happy');
    await result.expect
      .range()
      .containsMessage({ role: 'assistant' })
      .judge(model, {
        intent:
          'Says the wiki does not cover the vacation policy (or that it cannot find it) and does not invent a policy.',
      });
  });

  it('answers questions about recent changes', async () => {
    const { result } = await ask('What does the wiki log say changed most recently?');
    await result.expect
      .range()
      .containsMessage({ role: 'assistant' })
      .judge(model, { intent: 'Mentions the staging cluster move to k8s-staging-eu2 or the refreshToken rotation section.' });
  });
});
