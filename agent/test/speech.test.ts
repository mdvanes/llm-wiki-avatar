import { initializeLogger } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { languageProfiles } from '../src/language.ts';
import { RecordingPublisher, TOPICS } from '../src/publisher.ts';
import { SpeachesTTS } from '../src/speachesTts.ts';
import { WikiAgent } from '../src/wikiAgent.ts';
import { Wiki } from '../src/wiki/wiki.ts';
import { SAMPLE_WIKI } from './helpers.ts';

initializeLogger({ pretty: false, level: 'warn' });

const requests: Array<{ url: string; auth?: string; body: Record<string, unknown> }> = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw) as Record<string, unknown>;
    requests.push({ url: req.url ?? '', auth: req.headers.authorization, body });
    if (body.voice === 'broken') {
      res.writeHead(404).end('voice not found');
      return;
    }
    // 0.25 s of 24 kHz mono PCM, written in odd-sized chunks to exercise sample alignment.
    const pcm = Buffer.alloc(24000 * 2 * 0.25);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(i % 1000, i * 2);
    res.writeHead(200, { 'content-type': 'audio/pcm' });
    for (let off = 0; off < pcm.length; off += 999) res.write(pcm.subarray(off, off + 999));
    res.end();
  });
});
let baseURL = '';

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('SpeachesTTS', () => {
  it('requests 24 kHz PCM and yields complete audio frames', async () => {
    const tts = new SpeachesTTS({ baseURL, model: 'kokoro', voice: 'af_heart', apiKey: 'k', speed: 1.1 });
    const frames = [];
    for await (const ev of tts.synthesize('Hello there')) frames.push(ev);
    expect(requests.at(-1)).toEqual({
      url: '/v1/audio/speech',
      auth: 'Bearer k',
      body: { model: 'kokoro', voice: 'af_heart', input: 'Hello there', response_format: 'pcm', sample_rate: 24000, speed: 1.1 },
    });
    const samples = frames.reduce((n, ev) => n + ev.frame.samplesPerChannel, 0);
    expect(samples).toBe(6000);
    expect(frames.every((ev) => ev.frame.sampleRate === 24000)).toBe(true);
    expect(frames.at(-1)?.final).toBe(true);
    expect(frames.slice(0, -1).every((ev) => !ev.final)).toBe(true);
  });

  it('switches voice at runtime', async () => {
    const tts = new SpeachesTTS({ baseURL, model: 'kokoro', voice: 'af_heart' });
    tts.updateOptions({ model: 'piper-nl', voice: 'mls' });
    for await (const _ of tts.synthesize('Hallo')) void _;
    expect(requests.at(-1)?.body).toMatchObject({ model: 'piper-nl', voice: 'mls', input: 'Hallo' });
    expect(tts.model).toBe('piper-nl');
  });

  it('reports HTTP errors', async () => {
    const tts = new SpeachesTTS({ baseURL, model: 'kokoro', voice: 'broken' });
    const errors: Error[] = [];
    tts.on('error', (ev) => errors.push(ev.error));
    const stream = tts.synthesize('x', { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 5000 });
    const frames = [];
    for await (const ev of stream) frames.push(ev);
    expect(frames).toEqual([]);
    expect(errors.map((e) => e.message)).toEqual([expect.stringMatching(/404: voice not found/)]);
  });
});

describe('WikiAgent.setLanguage', () => {
  it('switches STT language, TTS voice, instructions and notifies the UI', async () => {
    const cfg = loadConfig({ WIKI_DIR: SAMPLE_WIKI, SPEACHES_URL: baseURL });
    const wiki = await Wiki.open(SAMPLE_WIKI);
    const profiles = languageProfiles(cfg);
    const stt = new openai.STT({ baseURL, apiKey: 'x', model: 'whisper', useRealtime: false, language: 'en' });
    const tts = new SpeachesTTS(profiles.en.tts);
    const sttUpdate = vi.spyOn(stt, 'updateOptions');
    const publisher = new RecordingPublisher();
    const agent = new WikiAgent({ wiki, cfg, publisher, profiles, language: 'en', stt, tts, sttPrompt: 'Glossary: X.' });

    expect(agent.instructions).toContain('Always reply in English');
    await agent.setLanguage('nl', { announce: false });
    expect(agent.language).toBe('nl');
    expect(sttUpdate).toHaveBeenLastCalledWith({ language: 'nl', prompt: 'Glossary: X.' });
    expect(tts.model).toBe(profiles.nl.tts.model);
    expect(tts.voice).toMatchObject({ model: profiles.nl.tts.model, voice: 'mls' });
    expect(agent.instructions).toContain('Always reply in Dutch');
    expect(publisher.events).toEqual([{ topic: TOPICS.language, payload: 'nl' }]);

    await agent.setLanguage('nl', { announce: false });
    expect(publisher.events).toHaveLength(1);
  });
});
