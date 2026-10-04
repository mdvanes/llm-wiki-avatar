import { describe, expect, it } from 'vitest';
import { kokoroPhonemes, kokoroWordTimings, normalizeEnglish } from '@/lib/tts/kokoro';
import { MAX_SENTENCE, SentenceSplitter, limitLength, splitSentences } from '@/lib/tts/sentences';
import { KOKORO_REPO, TTS_VOICES, filesToRemove, findVoice, voiceFiles, voiceFor, voiceSpec } from '@/lib/tts/voices';

const gpu = { webgpu: true, f16: true };
const cpu = { webgpu: false, f16: false };

describe('voices', () => {
  it('has one voice per language and gender', () => {
    for (const language of ['en', 'nl'] as const) {
      for (const gender of ['female', 'male'] as const) {
        expect(voiceFor(language, gender).language).toBe(language);
      }
    }
    expect(new Set(TTS_VOICES.map((v) => v.id)).size).toBe(TTS_VOICES.length);
  });

  it('runs Kokoro on WebGPU in full precision when it can, else 8-bit on WASM', () => {
    const heart = findVoice('kokoro-af_heart')!;
    expect(voiceSpec(heart, gpu)).toMatchObject({ device: 'webgpu', dtype: 'fp32' });
    expect(voiceSpec(heart, cpu)).toMatchObject({ device: 'wasm', dtype: 'q8' });
    expect(voiceFiles(voiceSpec(heart, cpu))).toContain(
      `https://huggingface.co/${KOKORO_REPO}/resolve/main/onnx/model_quantized.onnx`,
    );
  });

  it('lists the Piper model and its config', () => {
    const files = voiceFiles(voiceSpec(findVoice('piper-nl_BE-rdh')!, gpu));
    expect(files).toEqual([
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/nl/nl_BE/rdh/medium/nl_BE-rdh-medium.onnx',
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/nl/nl_BE/rdh/medium/nl_BE-rdh-medium.onnx.json',
    ]);
  });

  it('keeps the shared Kokoro model while another English voice uses it', () => {
    const heart = voiceSpec(findVoice('kokoro-af_heart')!, cpu);
    const michael = voiceSpec(findVoice('kokoro-am_michael')!, cpu);
    expect(filesToRemove(heart, [michael]).map((url) => url.split('/main/')[1])).toEqual(['voices/af_heart.bin']);
    expect(filesToRemove(heart, [])).toEqual(voiceFiles(heart));
  });
});

describe('sentences', () => {
  it('splits streamed text at sentence ends once the next sentence starts', () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push('Hello there. How')).toEqual(['Hello there.']);
    expect(splitter.push(' are you?')).toEqual([]);
    expect(splitter.push(' Fine')).toEqual(['How are you?']);
    expect(splitter.flush()).toEqual(['Fine']);
  });

  it('does not split at decimals or common abbreviations', () => {
    expect(splitSentences('Version 3.5 is out, e.g. on staging. Try it!')).toEqual([
      'Version 3.5 is out, e.g. on staging.',
      'Try it!',
    ]);
  });

  it('splits at line breaks', () => {
    expect(splitSentences('First item\nSecond item')).toEqual(['First item', 'Second item']);
  });

  it('cuts overly long sentences at a comma or space', () => {
    const long = `${'word '.repeat(40).trim()}, ${'more '.repeat(40).trim()}`;
    const parts = limitLength(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_SENTENCE);
    expect(parts.join(' ')).toBe(long);
  });
});

describe('kokoro', () => {
  it('spells out times, money and decimals', () => {
    expect(normalizeEnglish('Meet at 3:30 for $5.50, version 2.5.')).toBe(
      'Meet at 3 30 for 5 dollars and 50 cents, version 2 point 5.',
    );
  });

  it('adapts eSpeak phonemes to Kokoro', () => {
    expect(kokoroPhonemes('ðə kˈæt.ɪt ɹæn')).toBe('ðə kˈæt. ɪt ɹæn');
    expect(kokoroPhonemes('rˈɛd')).toBe('ɹˈɛd');
  });

  it('turns per-phoneme durations into word timings', () => {
    // padding, h, a, i, space, ",", b, o, padding; 25 ms per frame
    const words = kokoroWordTimings('hai ,bo', [4, 1, 2, 1, 1, 8, 2, 2, 3]);
    expect(words).toEqual([
      { w: 'hai', s: 100, e: 200 },
      { w: 'bo', s: 425, e: 525 },
    ]);
  });

  it('gives no timings when durations are missing', () => {
    expect(kokoroWordTimings('hai', [1, 2])).toEqual([]);
  });
});
