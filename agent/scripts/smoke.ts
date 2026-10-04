/**
 * Checks that every service the agent needs is reachable and working:
 * wiki folder, LiveKit, LLM, and TTS per language and voice.
 *
 *   npm run smoke
 */
import { loadConfig } from '../src/config.ts';
import { languageProfiles } from '../src/language.ts';
import { WikiStore } from '../src/wiki/store.ts';

const cfg = loadConfig();
let failed = 0;

async function check(name: string, fn: () => Promise<string>) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`✔ ${name} (${Date.now() - started} ms) ${detail}`);
  } catch (err) {
    failed++;
    console.log(`✘ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function ok(res: Response): Promise<Response> {
  if (res.ok) return res;
  const body = (await res.text()).slice(0, 200);
  const hint = /not installed/.test(body) ? ' → run: docker compose up speaches-models' : '';
  throw new Error(`HTTP ${res.status} ${body}${hint}`);
}

const PHRASES = {
  en: 'The deployment pipeline runs every night.',
  nl: 'De uitrol draait elke nacht automatisch.',
} as const;

await check('wiki', async () => {
  const store = new WikiStore(cfg.WIKI_SOURCES);
  await store.load();
  if (store.size === 0) throw new Error(`no markdown pages in ${cfg.WIKI_SOURCES.map((source) => source.path).join(', ')}`);
  return `${store.size} pages across ${store.sources.length} wiki source(s)`;
});

await check('livekit', async () => {
  const url = cfg.LIVEKIT_URL.replace(/^ws/, 'http');
  await ok(await fetch(url, { signal: AbortSignal.timeout(5000) }));
  return url;
});

await check('llm', async () => {
  const res = await ok(
    await fetch(`${cfg.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.LLM_API_KEY}` },
      body: JSON.stringify({
        model: cfg.LLM_MODEL,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 20,
        ...(cfg.LLM_REASONING_EFFORT ? { reasoning_effort: cfg.LLM_REASONING_EFFORT } : {}),
      }),
      signal: AbortSignal.timeout(cfg.LLM_TIMEOUT_S * 1000),
    }),
  );
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return `${cfg.LLM_MODEL} → ${JSON.stringify(body.choices?.[0]?.message?.content?.trim() ?? '')}`;
});

for (const profile of Object.values(languageProfiles(cfg))) {
  for (const [gender, tts] of Object.entries(profile.voices)) {
    await check(`tts ${profile.code} ${gender}`, async () => {
      const res = await ok(
        await fetch(`${tts.baseURL}/audio/speech`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.SPEACHES_API_KEY}` },
          body: JSON.stringify({
            model: tts.model,
            voice: tts.voice,
            input: PHRASES[profile.code],
            response_format: 'wav',
          }),
          signal: AbortSignal.timeout(cfg.SPEECH_TIMEOUT_S * 1000 * 4),
        }),
      );
      const audio = await res.blob();
      return `${tts.model} / ${tts.voice}, ${audio.size} bytes`;
    });
  }
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
