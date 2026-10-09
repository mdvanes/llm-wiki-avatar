import type { Language } from '@/lib/language';
import type { DeviceCaps } from '@/lib/stt/models';

export type VoiceGender = 'female' | 'male';
export type TtsDevice = 'webgpu' | 'wasm';

const HF = 'https://huggingface.co/';
export const KOKORO_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped';
const PIPER_REPO = 'rhasspy/piper-voices';

/** What the worker needs to synthesize with a voice. */
export type VoiceSpec =
  | { engine: 'kokoro'; repo: string; device: TtsDevice; dtype: 'fp32' | 'q8'; voice: string }
  | { engine: 'piper'; repo: string; path: string };

export interface TtsVoice {
  id: string;
  language: Language;
  /** BCP 47 locale of the voice, e.g. nl-BE. */
  locale: string;
  gender: VoiceGender;
  label: string;
  engine: VoiceSpec['engine'];
  /** Kokoro voice name, or the Piper voice path in its repo (without `.onnx`). */
  name: string;
  /** Hugging Face repo of a Piper voice, when it is not in the Piper voices repo. */
  repo?: string;
  /** Approximate download size in MB per device. */
  sizeMb: Record<TtsDevice, number>;
}

/** The first voice of a language and gender is the default for that presentation choice. */
export const TTS_VOICES: readonly TtsVoice[] = [
  {
    id: 'kokoro-af_heart',
    language: 'en',
    locale: 'en-US',
    gender: 'female',
    label: 'Heart (Kokoro)',
    engine: 'kokoro',
    name: 'af_heart',
    sizeMb: { webgpu: 327, wasm: 93 },
  },
  {
    id: 'kokoro-am_michael',
    language: 'en',
    locale: 'en-US',
    gender: 'male',
    label: 'Michael (Kokoro)',
    engine: 'kokoro',
    name: 'am_michael',
    sizeMb: { webgpu: 327, wasm: 93 },
  },
  {
    id: 'piper-nl_BE-nathalie',
    language: 'nl',
    locale: 'nl-BE',
    gender: 'female',
    label: 'Nathalie (Piper)',
    engine: 'piper',
    name: 'nl/nl_BE/nathalie/medium/nl_BE-nathalie-medium',
    sizeMb: { webgpu: 63, wasm: 63 },
  },
  {
    id: 'piper-nl_BE-rdh',
    language: 'nl',
    locale: 'nl-BE',
    gender: 'male',
    label: 'Rdh (Piper)',
    engine: 'piper',
    name: 'nl/nl_BE/rdh/medium/nl_BE-rdh-medium',
    sizeMb: { webgpu: 63, wasm: 63 },
  },
  {
    id: 'piper-nl_NL-alex',
    language: 'nl',
    locale: 'nl-NL',
    gender: 'male',
    label: 'Alex (Piper)',
    engine: 'piper',
    name: 'nl/nl_NL/alex/medium/nl_NL-alex-medium',
    sizeMb: { webgpu: 64, wasm: 64 },
  },
  {
    id: 'piper-nl_NL-dii',
    language: 'nl',
    locale: 'nl-NL',
    gender: 'female',
    label: 'Dii (Piper)',
    engine: 'piper',
    name: 'nl_NL-dii-high',
    repo: 'csukuangfj/vits-piper-nl_NL-dii-high',
    sizeMb: { webgpu: 64, wasm: 64 },
  },
];

export function findVoice(id: string | null | undefined): TtsVoice | undefined {
  return TTS_VOICES.find((v) => v.id === id);
}

/** The voices to choose from for a language and gender. */
export function voicesFor(language: Language, gender: VoiceGender): TtsVoice[] {
  return TTS_VOICES.filter((v) => v.language === language && v.gender === gender);
}

/** The voice picked in the settings (`chosenId`), or else the first one for the language and gender. */
export function voiceFor(language: Language, gender: VoiceGender, chosenId?: string | null): TtsVoice {
  const options = voicesFor(language, gender);
  return options.find((v) => v.id === chosenId) ?? options[0]!;
}

const choiceKey = (language: Language, gender: VoiceGender) => `llm-wiki-avatar.ttsVoice.${language}.${gender}`;

export function loadVoiceChoice(language: Language, gender: VoiceGender): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(choiceKey(language, gender));
}

export function saveVoiceChoice(language: Language, gender: VoiceGender, id: string): void {
  window.localStorage.setItem(choiceKey(language, gender), id);
}

/** Kokoro uses the graphics card when it can; Piper voices are small enough for WASM. */
export function ttsDevice(voice: TtsVoice, caps: DeviceCaps): TtsDevice {
  return voice.engine === 'kokoro' && caps.webgpu ? 'webgpu' : 'wasm';
}

export function voiceSpec(voice: TtsVoice, caps: DeviceCaps): VoiceSpec {
  if (voice.engine === 'piper') return { engine: 'piper', repo: voice.repo ?? PIPER_REPO, path: voice.name };
  const device = ttsDevice(voice, caps);
  // Kokoro is unreliable in 16 bits on WebGPU; 8 bits is the best size/quality trade-off on WASM.
  return { engine: 'kokoro', repo: KOKORO_REPO, device, dtype: device === 'webgpu' ? 'fp32' : 'q8', voice: voice.name };
}

/** Kokoro's files that every voice needs, per dtype. */
function kokoroModelFiles(dtype: 'fp32' | 'q8'): string[] {
  const model = dtype === 'fp32' ? 'onnx/model.onnx' : 'onnx/model_quantized.onnx';
  return ['config.json', 'tokenizer.json', 'tokenizer_config.json', model];
}

/** URLs of the files a voice needs, as they are keyed in the model cache. */
export function voiceFiles(spec: VoiceSpec): string[] {
  const base = `${HF}${spec.repo}/resolve/main/`;
  const files =
    spec.engine === 'kokoro'
      ? [...kokoroModelFiles(spec.dtype), `voices/${spec.voice}.bin`]
      : [`${spec.path}.onnx`, `${spec.path}.onnx.json`];
  return files.map((file) => base + file);
}

/** Files of `spec` that none of the `others` (other voices still in the cache) needs. */
export function filesToRemove(spec: VoiceSpec, others: readonly VoiceSpec[]): string[] {
  const kept = new Set(others.flatMap(voiceFiles));
  return voiceFiles(spec).filter((url) => !kept.has(url));
}

/** Text for trying a voice out. */
export const SAMPLE_TEXT: Record<Language, string> = {
  en: 'Hi! I am the voice of your team wiki. The billing service retries failed Stripe webhooks up to 5 times, with exponential back-off. Want to know more?',
  nl: 'Hoi! Ik ben de stem van de teamwiki. De facturatiedienst probeert mislukte Stripe-webhooks tot 5 keer opnieuw, met een steeds langere wachttijd. Wil je meer weten?',
};
