import { ReadableStream } from 'node:stream/web';
import { describe, expect, it } from 'vitest';
import { type Mood, MoodFilter, extractMood, normalizeMood } from '../src/mood.ts';
import { type StreamingTextFilter, filterText, filterTextStream } from '../src/textStream.ts';

/** Feeds text to a filter in every possible 2-way split and in single characters. */
function allSplits(text: string, make: () => StreamingTextFilter): string[] {
  const results = new Set<string>();
  for (let i = 0; i <= text.length; i++) {
    const f = make();
    results.add(f.push(text.slice(0, i)) + f.push(text.slice(i)) + f.flush());
  }
  const f = make();
  let out = '';
  for (const ch of text) out += f.push(ch);
  results.add(out + f.flush());
  return [...results];
}

describe('MoodFilter', () => {
  it('strips the mood tag and reports the mood', () => {
    expect(extractMood('[mood:happy] Hello there!')).toEqual({ text: 'Hello there!', mood: 'happy' });
    expect(extractMood('[ Mood : Confused ]  Not sure.')).toEqual({ text: 'Not sure.', mood: 'confused' });
  });

  it('maps synonyms and unknown moods', () => {
    expect(normalizeMood('sorry')).toBe('sad');
    expect(normalizeMood('ecstatic')).toBe('neutral');
  });

  it('is robust to any chunking', () => {
    const text = '[mood:sad] Sorry, [the] wiki has no [[Page]] about that [mood:happy]but ok.';
    for (const moods of [[] as Mood[]]) {
      const results = allSplits(text, () => new MoodFilter((m) => moods.push(m)));
      expect(results).toEqual(['Sorry, [the] wiki has no [[Page]] about that but ok.']);
      expect(new Set(moods)).toEqual(new Set(['sad', 'happy']));
    }
  });

  it('drops a truncated tag at the end but keeps other brackets', () => {
    expect(filterText('Done [mood:ha', new MoodFilter())).toBe('Done ');
    expect(filterText('Array [0', new MoodFilter())).toBe('Array [0');
  });
});

describe('filterTextStream', () => {
  it('applies a filter to a stream and passes non-strings through', async () => {
    const input = ReadableStream.from<string | { text: string }>(['[mood:', 'happy] Hi', { text: 'timed' }, ' there']);
    const out: unknown[] = [];
    for await (const chunk of filterTextStream(input, new MoodFilter())) out.push(chunk);
    expect(out).toEqual(['Hi', { text: 'timed' }, ' there']);
  });
});
