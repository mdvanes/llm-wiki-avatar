import { initializeLogger } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { languageProfiles } from '../src/language.ts';
import { RecordingPublisher, TOPICS } from '../src/publisher.ts';
import { SpeachesTTS, captionedSpeechURL, toWordTimings } from '../src/speachesTts.ts';
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
    if (req.url === '/dev/captioned_speech') {
      // Kokoro-FastAPI: newline-delimited JSON, base64 PCM (0.1 s + 0.15 s) and cumulative word timestamps.
      const chunk = (seconds: number, timestamps: unknown[]) =>
        `${JSON.stringify({ audio: Buffer.alloc(24000 * 2 * seconds).toString('base64'), audio_format: 'pcm', timestamps })}\n`;
      const all =
        chunk(0.1, [
          { word: 'Hello', start_time: 0.0125, end_time: 0.05 },
          { word: ',', start_time: 0.05, end_time: 0.06 },
        ]) + chunk(0.15, [{ word: 'there', start_time: 0.1, end_time: 0.2 }]);
      res.writeHead(200, { 'content-type': 'application/json' });
      // Split mid-line to exercise line buffering.
      res.write(all.slice(0, 50));
      res.end(all.slice(50));
      return;
    }
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

describe('SpeachesTTS with word timings', () => {
  it('builds the captioned speech URL with or without /v1', () => {
    expect(captionedSpeechURL('http://kokoro:8880/v1/')).toBe('http://kokoro:8880/dev/captioned_speech');
    expect(captionedSpeechURL('http://kokoro:8880')).toBe('http://kokoro:8880/dev/captioned_speech');
  });

  it('drops punctuation and converts to ms', () => {
    expect(
      toWordTimings([
        { word: 'Hi', start_time: 0.0224, end_time: 0.3726 },
        { word: '.', start_time: 0.37, end_time: 0.4 },
        { word: "it's", start_time: 0.4, end_time: 0.5 },
      ]),
    ).toEqual([
      { w: 'Hi', s: 22, e: 373 },
      { w: "it's", s: 400, e: 500 },
    ]);
    expect(toWordTimings(null)).toEqual([]);
  });

  it('streams audio and word timings from Kokoro-FastAPI', async () => {
    const segments: unknown[] = [];
    const tts = new SpeachesTTS({
      baseURL: `${baseURL}`,
      model: 'kokoro',
      voice: 'af_heart',
      wordTimings: true,
      onWords: (s) => segments.push(s),
    });
    const frames = [];
    for await (const ev of tts.synthesize('Hello, there')) frames.push(ev);
    expect(requests.at(-1)).toMatchObject({
      url: '/dev/captioned_speech',
      body: { model: 'kokoro', voice: 'af_heart', input: 'Hello, there', response_format: 'pcm', stream: true, return_timestamps: true },
    });
    expect(frames.reduce((n, ev) => n + ev.frame.samplesPerChannel, 0)).toBe(6000);
    expect(frames.at(-1)?.final).toBe(true);
    const id = frames[0]!.segmentId;
    expect(segments).toEqual([
      { id, words: [{ w: 'Hello', s: 13, e: 50 }], final: false },
      { id, words: [{ w: 'there', s: 100, e: 200 }], final: false },
      { id, words: [], final: true, durationMs: 250 },
    ]);
  });

  it('falls back to the regular voice when Kokoro-FastAPI is unreachable', async () => {
    const segments: unknown[] = [];
    const tts = new SpeachesTTS({
      baseURL: 'http://127.0.0.1:9/v1',
      model: 'kokoro',
      voice: 'af_heart',
      wordTimings: true,
      fallback: { baseURL, model: 'speaches-kokoro', voice: 'af_heart' },
      onWords: (s) => segments.push(s),
    });
    const frames = [];
    for await (const ev of tts.synthesize('Hello')) frames.push(ev);
    expect(requests.at(-1)).toMatchObject({ url: '/v1/audio/speech', body: { model: 'speaches-kokoro' } });
    expect(frames.reduce((n, ev) => n + ev.frame.samplesPerChannel, 0)).toBe(6000);
    expect(segments).toEqual([]);
  });
});

describe('WikiAgent.setLipsync', () => {
  async function setup(env: Record<string, string> = { KOKORO_URL: 'http://kokoro:8880' }) {
    const cfg = loadConfig({ WIKI_DIR: SAMPLE_WIKI, SPEACHES_URL: baseURL, ...env });
    const wiki = await Wiki.open(SAMPLE_WIKI);
    const profiles = languageProfiles(cfg);
    const tts = new SpeachesTTS(profiles.en.voices.female);
    const agent = new WikiAgent({ wiki, cfg, publisher: new RecordingPublisher(), profiles, language: 'en', tts });
    return { agent, tts, profiles };
  }

  it('uses Kokoro-FastAPI for the English female voice only', async () => {
    const { agent, tts, profiles } = await setup();
    agent.setLipsync('words');
    expect(tts.voice).toEqual({
      baseURL: 'http://kokoro:8880',
      model: 'kokoro',
      voice: 'af_heart',
      wordTimings: true,
      fallback: profiles.en.voices.female,
    });
    agent.setVoice('male');
    expect(tts.voice).toEqual(profiles.en.voices.male);
    agent.setVoice('female');
    await agent.setLanguage('nl', { announce: false });
    expect(tts.voice).toEqual(profiles.nl.voices.female);
    await agent.setLanguage('en', { announce: false });
    expect(tts.voice.wordTimings).toBe(true);
    agent.setLipsync('audio');
    expect(tts.voice).toEqual(profiles.en.voices.female);
  });

  it('keeps the regular voice without KOKORO_URL', async () => {
    const { agent, tts, profiles } = await setup({});
    agent.setLipsync('words');
    expect(tts.voice).toEqual(profiles.en.voices.female);
  });
});

describe('WikiAgent.setLanguage', () => {
  it('switches STT language, TTS voice, instructions and notifies the UI', async () => {
    const cfg = loadConfig({ WIKI_DIR: SAMPLE_WIKI, SPEACHES_URL: baseURL });
    const wiki = await Wiki.open(SAMPLE_WIKI);
    const profiles = languageProfiles(cfg);
    const stt = new openai.STT({ baseURL, apiKey: 'x', model: 'whisper', useRealtime: false, language: 'en' });
    const tts = new SpeachesTTS(profiles.en.voices.female);
    const sttUpdate = vi.spyOn(stt, 'updateOptions');
    const publisher = new RecordingPublisher();
    const agent = new WikiAgent({ wiki, cfg, publisher, profiles, language: 'en', stt, tts, sttPrompt: 'Glossary: X.' });

    expect(agent.instructions).toContain('Always reply in English');
    await agent.setLanguage('nl', { announce: false });
    expect(agent.language).toBe('nl');
    expect(sttUpdate).toHaveBeenLastCalledWith({ language: 'nl', prompt: 'Glossary: X.' });
    expect(tts.model).toBe(profiles.nl.voices.female.model);
    expect(tts.voice).toMatchObject({ model: profiles.nl.voices.female.model, voice: 'nathalie' });
    expect(agent.instructions).toContain('Always reply in Dutch');
    expect(publisher.events).toEqual([{ topic: TOPICS.language, payload: 'nl' }]);

    await agent.setLanguage('nl', { announce: false });
    expect(publisher.events).toHaveLength(1);
  });
});

describe('WikiAgent.setVoice', () => {
  async function setup(voice?: 'off' | 'female' | 'male') {
    const cfg = loadConfig({ WIKI_DIR: SAMPLE_WIKI, SPEACHES_URL: baseURL });
    const wiki = await Wiki.open(SAMPLE_WIKI);
    const profiles = languageProfiles(cfg);
    const tts = new SpeachesTTS(profiles.en.voices.female);
    const audio = {
      enabled: true,
      setAudioEnabled(enabled: boolean) {
        this.enabled = enabled;
      },
    };
    const publisher = new RecordingPublisher();
    const agent = new WikiAgent({ wiki, cfg, publisher, profiles, language: 'en', tts, audioOutput: audio, voice });
    return { agent, tts, audio };
  }

  it('starts with the requested voice', async () => {
    const { agent, tts, audio } = await setup('male');
    expect(agent.voice).toBe('male');
    expect(tts.voice.voice).toBe('am_michael');
    expect(audio.enabled).toBe(true);
    expect((await setup()).agent.voice).toBe('female');
  });

  it('turns speech off and back on', async () => {
    const { agent, tts, audio } = await setup();
    agent.setVoice('off');
    expect(agent.voice).toBe('off');
    expect(audio.enabled).toBe(false);
    agent.setVoice('male');
    expect(audio.enabled).toBe(true);
    expect(tts.voice.voice).toBe('am_michael');
    agent.setVoice('female');
    expect(tts.voice.voice).toBe('af_heart');
  });

  it('keeps the gender when the language changes', async () => {
    const { agent, tts, audio } = await setup('male');
    await agent.setLanguage('nl', { announce: false });
    expect(tts.voice).toMatchObject({ model: 'speaches-ai/piper-nl_BE-rdh-medium', voice: 'rdh' });
    agent.setVoice('off');
    await agent.setLanguage('en', { announce: false });
    expect(audio.enabled).toBe(false);
  });
});
