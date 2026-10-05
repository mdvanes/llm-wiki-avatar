import { describe, expect, it } from 'vitest';
import { kokoroPhonemes, kokoroWordTimings, normalizeEnglish } from '@/lib/tts/kokoro';
import { MAX_SENTENCE, SentenceSplitter, limitLength, splitSentences } from '@/lib/tts/sentences';
import { speakable, speechSegments } from '@/lib/tts/speechText';
import { ipaToVisemes } from '@/lib/tts/visemes';
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

  it('does not take numbered list items for sentences', () => {
    expect(splitSentences('1. Open the page. Then click.')).toEqual(['1. Open the page.', 'Then click.']);
  });

  it('cuts overly long sentences at a comma or space', () => {
    const long = `${'word '.repeat(40).trim()}, ${'more '.repeat(40).trim()}`;
    const parts = limitLength(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_SENTENCE);
    expect(parts.join(' ')).toBe(long);
  });
});

describe('speech text', () => {
  it('makes markdown speakable', () => {
    expect(speakable('**Note:** see [[Billing Service|billing]] and `getUserByID`! 🎉')).toBe(
      'Note: see billing and get User By ID!',
    );
    expect(speakable('## Retry policy')).toBe('Retry policy');
    expect(speakable('- Read [the docs](https://example.com/docs).')).toBe('Read the docs.');
    expect(speakable('Docs: https://www.example.com/a/b.')).toBe('Docs: example.com.');
    expect(speakable('`a = b()`')).toBe('');
  });

  it('leaves code blocks out but keeps their place in the reply', () => {
    const reply = 'Here is how.\n```ts\nconst a = 1.5;\n```\nThat is all.';
    const segments = speechSegments(reply, true);
    expect(segments.map((s) => s.text)).toEqual(['Here is how.', 'That is all.']);
    expect(segments[1]!.end).toBe(reply.length);
    expect(reply.slice(0, segments[0]!.end)).toBe('Here is how.\n');
  });

  it('holds back unfinished sentences and code blocks until the reply is final', () => {
    expect(speechSegments('One. Two', false).map((s) => s.text)).toEqual(['One.']);
    expect(speechSegments('One. Two', true).map((s) => s.text)).toEqual(['One.', 'Two']);
    expect(speechSegments('Look:\n```\ncode. more', false).map((s) => s.text)).toEqual(['Look:']);
  });

  it('keeps the sentences it already gave as the reply grows', () => {
    const before = speechSegments('First one. Second', false);
    const after = speechSegments('First one. Second one. Third', false);
    expect(after.slice(0, before.length)).toEqual(before);
  });
});

describe('visemes from phonemes', () => {
  it('maps IPA to mouth shapes and merges repeats', () => {
    expect(ipaToVisemes('həlˈoʊ')?.visemes).toEqual(['kk', 'E', 'nn', 'O', 'U']);
    expect(ipaToVisemes('mˈæp')?.visemes).toEqual(['PP', 'aa', 'PP']);
    expect(ipaToVisemes('ˈː')).toBeUndefined();
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
