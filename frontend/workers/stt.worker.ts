import { type AutomaticSpeechRecognitionPipeline, ModelRegistry, env, pipeline } from '@huggingface/transformers';
import { cleanTranscript } from '@/lib/stt/audio';
import { MODEL_CACHE, fetchToCache } from '@/lib/stt/cache';
import type { SttRequest, SttResponse } from '@/lib/stt/client';
import type { LoadSpec } from '@/lib/stt/models';
import { FileProgress } from '@/lib/stt/progress';

const TASK = 'automatic-speech-recognition';
const ORT = new URL('/speech/ort/', self.location.origin).href;

env.allowLocalModels = false;
// Served by the frontend (scripts/copy-speech-assets.mjs) instead of the default CDN.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: `${ORT}ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${ORT}ort-wasm-simd-threaded.asyncify.wasm`,
};

function post(message: SttResponse) {
  self.postMessage(message);
}

function progress(id: number): (file: string, loaded: number, total: number) => void {
  const files = new FileProgress();
  return (file, loaded, total) => post({ type: 'progress', id, ...files.update(file, loaded, total) });
}

// transformers.js' progress_total and ModelRegistry look the encoder dtype up under the session key `model`,
// so without it they count the 2.5 GB fp32 encoder of Large v3 Turbo instead of the one that is loaded.
function registryOptions(spec: LoadSpec) {
  return { device: spec.device, dtype: { ...spec.dtype, model: spec.dtype.encoder_model } };
}

function open(spec: LoadSpec, id: number): Promise<AutomaticSpeechRecognitionPipeline> {
  const report = progress(id);
  return pipeline(TASK, spec.repo, {
    device: spec.device,
    dtype: spec.dtype,
    progress_callback: (info) => {
      if (info.status === 'progress') report(info.file, info.loaded, info.total);
    },
  });
}

/** Fills the cache without building the model, which for the large model takes long and a lot of memory. */
async function download(spec: LoadSpec, id: number): Promise<void> {
  const files = await ModelRegistry.get_pipeline_files(TASK, spec.repo, registryOptions(spec));
  const cache = await caches.open(MODEL_CACHE);
  const report = progress(id);
  const base = `${env.remoteHost}${spec.repo}/resolve/main/`;
  await Promise.all(files.map((file) => fetchToCache(cache, base + file, (loaded, total) => report(file, loaded, total))));
}

let current: { key: string; asr: Promise<AutomaticSpeechRecognitionPipeline> } | undefined;

async function load(spec: LoadSpec, id: number): Promise<void> {
  const key = JSON.stringify(spec);
  if (current?.key !== key) {
    const previous = current;
    const asr = open(spec, id).then(async (loaded) => {
      // The first run compiles the WebGPU shaders; do it now rather than on the user's first question.
      await loaded(new Float32Array(16_000), { language: 'english', task: 'transcribe' });
      return loaded;
    });
    current = { key, asr };
    void previous?.asr.then((old) => old.dispose()).catch(() => {});
  }
  const loading = current;
  try {
    await loading.asr;
  } catch (err) {
    if (current === loading) current = undefined;
    throw err;
  }
}

async function handle(request: SttRequest): Promise<SttResponse> {
  const { id } = request;
  switch (request.type) {
    case 'load':
      await load(request.spec, id);
      return { type: 'done', id };
    case 'download':
      await download(request.spec, id);
      return { type: 'done', id };
    case 'check': {
      const entries = await Promise.all(
        Object.entries(request.specs).map(
          async ([key, spec]) => [key, await ModelRegistry.is_pipeline_cached(TASK, spec.repo, registryOptions(spec))] as const,
        ),
      );
      return { type: 'done', id, cached: Object.fromEntries(entries) };
    }
    case 'transcribe': {
      if (!current) throw new Error('no speech model loaded');
      const asr = await current.asr;
      const output = await asr(request.audio, {
        language: request.language,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = (Array.isArray(output) ? output : [output]).map((o) => o.text).join(' ');
      return { type: 'done', id, text: cleanTranscript(text) };
    }
  }
}

self.addEventListener('message', (event: MessageEvent<SttRequest>) => {
  handle(event.data)
    .then(post)
    .catch((err: unknown) => post({ type: 'error', id: event.data.id, message: err instanceof Error ? err.message : String(err) }));
});
