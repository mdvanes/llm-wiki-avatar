import { describe, expect, it } from 'vitest';
import { cleanTranscript, concat, isSilent, loudestRms } from '@/lib/stt/audio';
import { formatBytes, isRepoFile } from '@/lib/stt/cache';
import { STT_MODELS, deviceFor, findModel, loadSpec, recommendedModel, whisperLanguage } from '@/lib/stt/models';
import { FileProgress } from '@/lib/stt/progress';

const model = (id: string) => findModel(id)!;

describe('speech models', () => {
  it('runs on WebGPU when available, otherwise on WASM', () => {
    expect(deviceFor(model('whisper-small'), { webgpu: true, f16: false })).toBe('webgpu');
    expect(deviceFor(model('whisper-small'), { webgpu: false, f16: false })).toBe('wasm');
  });

  it('keeps the large model to WebGPU with 16-bit floats', () => {
    const large = model('whisper-large-v3-turbo');
    expect(deviceFor(large, { webgpu: true, f16: true })).toBe('webgpu');
    expect(deviceFor(large, { webgpu: true, f16: false })).toBeUndefined();
    expect(deviceFor(large, { webgpu: false, f16: false })).toBeUndefined();
  });

  it('recommends a model the browser can run', () => {
    for (const caps of [
      { webgpu: true, f16: true },
      { webgpu: true, f16: false },
      { webgpu: false, f16: false },
    ]) {
      expect(deviceFor(recommendedModel(caps), caps)).toBeDefined();
    }
  });

  it('has a dtype for every device it lists a size for', () => {
    for (const m of STT_MODELS) {
      for (const device of ['webgpu', 'wasm'] as const) {
        expect(!!m.sizeMb[device]).toBe(!!m.dtype[device]);
      }
    }
    expect(() => loadSpec(model('whisper-large-v3-turbo'), 'wasm')).toThrow();
  });

  it('names the language the way Whisper expects', () => {
    expect(whisperLanguage('nl')).toBe('dutch');
    expect(whisperLanguage('en')).toBe('english');
  });
});

describe('model cache', () => {
  it('matches files of one repo only', () => {
    const url = 'https://huggingface.co/onnx-community/whisper-base/resolve/main/onnx/encoder_model.onnx';
    expect(isRepoFile(url, 'onnx-community/whisper-base')).toBe(true);
    expect(isRepoFile(url, 'onnx-community/whisper-base.en')).toBe(false);
    expect(isRepoFile('https://huggingface.co/onnx-community/whisper-base-x/resolve/main/a', 'onnx-community/whisper-base')).toBe(false);
    expect(isRepoFile('not a url', 'onnx-community/whisper-base')).toBe(false);
  });

  it('formats sizes', () => {
    expect(formatBytes(80e6)).toBe('80 MB');
    expect(formatBytes(1.6e9)).toBe('1.6 GB');
  });
});

describe('audio', () => {
  const rate = 16_000;

  it('treats near silence as silent and speech-level audio as not', () => {
    const quiet = new Float32Array(rate).map(() => (Math.random() - 0.5) * 0.002);
    const tone = new Float32Array(rate).map((_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / rate));
    expect(isSilent(quiet, rate)).toBe(true);
    expect(isSilent(tone, rate)).toBe(false);
    expect(loudestRms(tone, rate)).toBeCloseTo(0.2 / Math.SQRT2, 2);
  });

  it('notices a short loud part in a long quiet recording', () => {
    const samples = new Float32Array(rate * 5);
    samples.fill(0.3, rate * 2, rate * 2 + 1600);
    expect(isSilent(samples, rate)).toBe(false);
  });

  it('concatenates chunks', () => {
    expect([...concat([new Float32Array([1, 2]), new Float32Array([3])])]).toEqual([1, 2, 3]);
  });
});

describe('model download progress', () => {
  it('sums the files that have reported so far', () => {
    const progress = new FileProgress();
    expect(progress.update('encoder', 100, 400)).toEqual({ loaded: 100, total: 400 });
    expect(progress.update('decoder', 50, 200)).toEqual({ loaded: 150, total: 600 });
    expect(progress.update('encoder', 400, 400)).toEqual({ loaded: 450, total: 600 });
  });

  it('copes with files of unknown size', () => {
    expect(new FileProgress().update('tokenizer.json', 30, 0)).toEqual({ loaded: 30, total: 30 });
  });
});

describe('cleanTranscript', () => {
  it('drops non-speech annotations', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] ')).toBe('');
    expect(cleanTranscript('(music)')).toBe('');
    expect(cleanTranscript('...')).toBe('');
    expect(cleanTranscript('*coughs* How does deployment work?')).toBe('How does deployment work?');
  });

  it('keeps ordinary text, tidying whitespace', () => {
    expect(cleanTranscript('  Hoe werkt  de uitrol? ')).toBe('Hoe werkt de uitrol?');
  });
});
