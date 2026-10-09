import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import { AutoTokenizer, type PreTrainedTokenizer, StyleTextToSpeech2Model, Tensor, env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import { MODEL_CACHE, fetchToCache } from '@/lib/stt/cache';
import { FileProgress } from '@/lib/stt/progress';
import type { Speech, TtsRequest, TtsResponse } from '@/lib/tts/client';
import {
  KOKORO_MAX_PHONEMES,
  KOKORO_SAMPLE_RATE,
  kokoroPhonemes,
  kokoroWordTimings,
  normalizeEnglish,
} from '@/lib/tts/kokoro';
import { type VoiceSpec, voiceFiles } from '@/lib/tts/voices';
import { withBase } from '@/lib/basePath';

const ORT = new URL(withBase('/speech/ort/'), self.location.origin).href;
const PIPER = new URL(withBase('/speech/piper/'), self.location.origin).href;

env.allowLocalModels = false;
// Also used by the Piper sessions: transformers.js and this worker share one onnxruntime-web.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: `${ORT}ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${ORT}ort-wasm-simd-threaded.asyncify.wasm`,
};

function post(message: TtsResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

async function cachedResponse(url: string): Promise<Response> {
  const cache = await caches.open(MODEL_CACHE);
  let response = await cache.match(url);
  if (!response) {
    await fetchToCache(cache, url, () => {});
    response = await cache.match(url);
  }
  if (!response) throw new Error(`could not cache ${url}`);
  return response;
}

async function download(spec: VoiceSpec, id: number): Promise<void> {
  const cache = await caches.open(MODEL_CACHE);
  const files = new FileProgress();
  await Promise.all(
    voiceFiles(spec).map((url) =>
      fetchToCache(cache, url, (loaded, total) => post({ type: 'progress', id, ...files.update(url, loaded, total) })),
    ),
  );
}

// --- eSpeak phonemes, via Piper's phonemizer (also used for Kokoro) ---

interface PhonemizedLine {
  phoneme_ids: number[];
  phonemes: string[];
}

type Phonemize = (text: string, voice: string) => PhonemizedLine[];

let phonemizer: Promise<Phonemize> | undefined;

async function asset(file: string): Promise<ArrayBuffer> {
  const response = await fetch(PIPER + file);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${file}`);
  return response.arrayBuffer();
}

function getPhonemizer(): Promise<Phonemize> {
  phonemizer ??= (async () => {
    const [wasm, data] = await Promise.all([asset('piper_phonemize.wasm'), asset('piper_phonemize.data')]);
    let lines: string[] = [];
    const module = await createPiperPhonemize({
      wasmBinary: wasm,
      getPreloadedPackage: () => data,
      print: (line) => lines.push(line),
      printErr: () => {},
    });
    return (text: string, voice: string) => {
      lines = [];
      module.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
      return lines.map((line) => JSON.parse(line) as PhonemizedLine);
    };
  })();
  phonemizer.catch(() => (phonemizer = undefined));
  return phonemizer;
}

// --- Kokoro (English) ---

type KokoroSpec = Extract<VoiceSpec, { engine: 'kokoro' }>;
type KokoroModel = [StyleTextToSpeech2Model, PreTrainedTokenizer];

const STYLE_DIM = 256;
let kokoro: { key: string; model: Promise<KokoroModel> } | undefined;
const kokoroVoices = new Map<string, Promise<Float32Array>>();

function loadKokoro(spec: KokoroSpec): Promise<KokoroModel> {
  const key = `${spec.repo}|${spec.device}|${spec.dtype}`;
  if (kokoro?.key !== key) {
    const previous = kokoro;
    const model = Promise.all([
      StyleTextToSpeech2Model.from_pretrained(spec.repo, { device: spec.device, dtype: spec.dtype }),
      AutoTokenizer.from_pretrained(spec.repo),
    ]);
    kokoro = { key, model };
    model.catch(() => {
      if (kokoro?.model === model) kokoro = undefined;
    });
    void previous?.model.then(([old]) => old.dispose()).catch(() => {});
  }
  return kokoro.model;
}

function kokoroVoice(spec: KokoroSpec): Promise<Float32Array> {
  const url = voiceFiles(spec).at(-1)!;
  let voice = kokoroVoices.get(url);
  if (!voice) {
    voice = cachedResponse(url).then(async (r) => new Float32Array(await r.arrayBuffer()));
    voice.catch(() => kokoroVoices.delete(url));
    kokoroVoices.set(url, voice);
  }
  return voice;
}

async function synthesizeKokoro(spec: KokoroSpec, text: string, speed: number): Promise<Speech> {
  const [[model, tokenizer], voice, phonemize] = await Promise.all([
    loadKokoro(spec),
    kokoroVoice(spec),
    getPhonemizer(),
  ]);
  const espeak = phonemize(normalizeEnglish(text), 'en-us')
    .map((line) => line.phonemes.join(''))
    .join(' ');
  const phonemes = [...kokoroPhonemes(espeak)].slice(0, KOKORO_MAX_PHONEMES).join('');
  const { input_ids } = tokenizer(phonemes, { truncation: true }) as { input_ids: Tensor };
  const tokens = input_ids.dims.at(-1)!;
  const n = Math.min(Math.max(tokens - 2, 0), KOKORO_MAX_PHONEMES - 1);
  const style = new Tensor('float32', voice.slice(n * STYLE_DIM, (n + 1) * STYLE_DIM), [1, STYLE_DIM]);
  const output = (await model({ input_ids, style, speed: new Tensor('float32', [speed], [1]) })) as {
    waveform: Tensor;
    durations: Tensor;
  };
  const audio = new Float32Array(output.waveform.data as Float32Array);
  // Unknown characters are dropped by the tokenizer, which would shift the durations.
  const aligned = tokens === [...phonemes].length + 2;
  const words = aligned ? kokoroWordTimings(phonemes, output.durations.data as Float32Array) : undefined;
  return { audio, sampleRate: KOKORO_SAMPLE_RATE, words };
}

// --- Piper (Dutch) ---

type PiperSpec = Extract<VoiceSpec, { engine: 'piper' }>;

interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers?: number;
}

interface PiperVoice {
  session: ort.InferenceSession;
  config: PiperConfig;
}

const piperVoices = new Map<string, Promise<PiperVoice>>();

function loadPiper(spec: PiperSpec): Promise<PiperVoice> {
  let voice = piperVoices.get(spec.path);
  if (!voice) {
    const [modelUrl, configUrl] = voiceFiles(spec) as [string, string];
    voice = (async () => {
      const [model, config] = await Promise.all([
        cachedResponse(modelUrl).then((r) => r.arrayBuffer()),
        cachedResponse(configUrl).then((r) => r.json() as Promise<PiperConfig>),
      ]);
      const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
      return { session, config };
    })();
    voice.catch(() => piperVoices.delete(spec.path));
    piperVoices.set(spec.path, voice);
  }
  return voice;
}

async function synthesizePiper(spec: PiperSpec, text: string, speed: number): Promise<Speech> {
  const [{ session, config }, phonemize] = await Promise.all([loadPiper(spec), getPhonemizer()]);
  const ids = phonemize(text, config.espeak.voice).flatMap((line) => line.phoneme_ids);
  if (ids.length === 0) return { audio: new Float32Array(0), sampleRate: config.audio.sample_rate };
  const { noise_scale, length_scale, noise_w } = config.inference;
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([noise_scale, length_scale / speed, noise_w]), [3]),
  };
  if ((config.num_speakers ?? 1) > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const { output } = await session.run(feeds);
  return { audio: new Float32Array(output!.data as Float32Array), sampleRate: config.audio.sample_rate };
}

// --- Requests ---

function synthesize(spec: VoiceSpec, text: string, speed: number): Promise<Speech> {
  return spec.engine === 'kokoro' ? synthesizeKokoro(spec, text, speed) : synthesizePiper(spec, text, speed);
}

async function handle(request: TtsRequest): Promise<void> {
  const { id } = request;
  switch (request.type) {
    case 'download':
      await download(request.spec, id);
      post({ type: 'done', id });
      return;
    case 'load':
      // The first run compiles the WebGPU shaders; do it now rather than on the first reply.
      await synthesize(request.spec, 'Hi.', 1);
      post({ type: 'done', id });
      return;
    case 'synthesize': {
      const speech = await synthesize(request.spec, request.text, request.speed);
      post({ type: 'done', id, speech }, [speech.audio.buffer]);
      return;
    }
  }
}

self.addEventListener('message', (event: MessageEvent<TtsRequest>) => {
  handle(event.data).catch((err: unknown) =>
    post({ type: 'error', id: event.data.id, message: err instanceof Error ? err.message : String(err) }),
  );
});
