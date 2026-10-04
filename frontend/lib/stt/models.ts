import type { Language } from '@/lib/language';

export type SttDevice = 'webgpu' | 'wasm';
export type SttDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
type Dtypes = Record<'encoder_model' | 'decoder_model_merged', SttDtype>;

/** What the worker needs to load a model; the dtypes decide which files are downloaded. */
export interface LoadSpec {
  repo: string;
  device: SttDevice;
  dtype: Dtypes;
}

export interface SttModel {
  id: string;
  repo: string;
  label: string;
  note: Record<Language, string>;
  /** Approximate download size in MB per device; a device without an entry cannot run the model. */
  sizeMb: Partial<Record<SttDevice, number>>;
  dtype: Partial<Record<SttDevice, Dtypes>>;
  /** The WebGPU variant needs the `shader-f16` feature. */
  needsF16?: boolean;
}

/** Multilingual Whisper models, so Dutch works too. */
export const STT_MODELS: readonly SttModel[] = [
  {
    id: 'whisper-base',
    repo: 'onnx-community/whisper-base',
    label: 'Whisper Base',
    note: {
      en: 'Small and fast. Fine for clear English, weaker on Dutch and technical terms.',
      nl: 'Klein en snel. Prima voor duidelijk Engels, zwakker in het Nederlands en met vaktermen.',
    },
    sizeMb: { webgpu: 210, wasm: 80 },
    dtype: {
      webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    },
  },
  {
    id: 'whisper-small',
    repo: 'onnx-community/whisper-small',
    label: 'Whisper Small',
    note: {
      en: 'Good balance of quality and speed.',
      nl: 'Goede balans tussen kwaliteit en snelheid.',
    },
    sizeMb: { webgpu: 590, wasm: 250 },
    dtype: {
      webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    },
  },
  {
    id: 'whisper-large-v3-turbo',
    repo: 'onnx-community/whisper-large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
    note: {
      en: 'Best quality, also for Dutch. Needs a graphics card (WebGPU).',
      nl: 'Beste kwaliteit, ook voor Nederlands. Vereist een grafische kaart (WebGPU).',
    },
    sizeMb: { webgpu: 570 },
    dtype: { webgpu: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' } },
    needsF16: true,
  },
];

export function findModel(id: string | null | undefined): SttModel | undefined {
  return STT_MODELS.find((m) => m.id === id);
}

export interface DeviceCaps {
  webgpu: boolean;
  f16: boolean;
}

interface GpuNavigator {
  gpu?: { requestAdapter(): Promise<{ features: ReadonlySet<string> } | null> };
}

export async function detectCaps(): Promise<DeviceCaps> {
  try {
    const adapter = await (navigator as GpuNavigator).gpu?.requestAdapter();
    if (!adapter) return { webgpu: false, f16: false };
    return { webgpu: true, f16: adapter.features.has('shader-f16') };
  } catch {
    return { webgpu: false, f16: false };
  }
}

/** The device the model runs on in this browser, or undefined when it cannot run here. */
export function deviceFor(model: SttModel, caps: DeviceCaps): SttDevice | undefined {
  if (caps.webgpu && model.dtype.webgpu && (!model.needsF16 || caps.f16)) return 'webgpu';
  return model.dtype.wasm ? 'wasm' : undefined;
}

export function loadSpec(model: SttModel, device: SttDevice): LoadSpec {
  const dtype = model.dtype[device];
  if (!dtype) throw new Error(`${model.label} cannot run on ${device}`);
  return { repo: model.repo, device, dtype };
}

export function recommendedModel(caps: DeviceCaps): SttModel {
  const id = caps.webgpu ? (caps.f16 ? 'whisper-large-v3-turbo' : 'whisper-small') : 'whisper-base';
  return findModel(id)!;
}

/** Whisper's name for the conversation language. */
export function whisperLanguage(language: Language): string {
  return language === 'nl' ? 'dutch' : 'english';
}

export const STT_MODEL_KEY = 'llm-wiki-avatar.sttModel';

export function loadSttModel(): SttModel | undefined {
  if (typeof window === 'undefined') return undefined;
  return findModel(window.localStorage.getItem(STT_MODEL_KEY));
}

export function saveSttModel(model: SttModel | undefined): void {
  if (model) window.localStorage.setItem(STT_MODEL_KEY, model.id);
  else window.localStorage.removeItem(STT_MODEL_KEY);
}
