/**
 * Checks that every service the agent needs is reachable and working:
 * wiki folder, LiveKit, LLM, and TTS → STT round trips per language.
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
  const store = new WikiStore(cfg.WIKI_DIR);
  await store.load();
  if (store.size === 0) throw new Error(`no markdown pages in ${cfg.WIKI_DIR}`);
  return `${store.size} pages in ${cfg.WIKI_DIR}`;
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
  let audio: Blob | undefined;
  await check(`tts ${profile.code}`, async () => {
    const res = await ok(
      await fetch(`${profile.tts.baseURL}/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.SPEACHES_API_KEY}` },
        body: JSON.stringify({
          model: profile.tts.model,
          voice: profile.tts.voice,
          input: PHRASES[profile.code],
          response_format: 'wav',
        }),
        signal: AbortSignal.timeout(cfg.SPEECH_TIMEOUT_S * 1000 * 4),
      }),
    );
    audio = await res.blob();
    return `${profile.tts.model} / ${profile.tts.voice}, ${audio.size} bytes`;
  });
  if (!audio) continue;
  await check(`stt ${profile.code}`, async () => {
    const form = new FormData();
    form.append('file', audio!, 'smoke.wav');
    form.append('model', cfg.STT_MODEL);
    form.append('language', profile.whisperLanguage);
    const res = await ok(
      await fetch(`${cfg.SPEACHES_URL}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.SPEACHES_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(cfg.SPEECH_TIMEOUT_S * 1000 * 4),
      }),
    );
    const { text } = (await res.json()) as { text: string };
    return `${cfg.STT_MODEL} → ${JSON.stringify(text.trim())}`;
  });
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
