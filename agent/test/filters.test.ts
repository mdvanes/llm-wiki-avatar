import { ReadableStream } from 'node:stream/web';
import { describe, expect, it } from 'vitest';
import { type Mood, MoodFilter, extractMood, normalizeMood } from '../src/mood.ts';
import { SpeechFilter, speakableCode, speakableText } from '../src/speechFilter.ts';
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

describe('speakableCode / speakableText', () => {
  it.each([
    ['getUserByID', 'get User By ID'],
    ['InvoiceScheduler', 'Invoice Scheduler'],
    ['mw.go', 'mw dot go'],
    ['k8s-staging-eu2', 'k8s staging eu2'],
    ['services/auth', 'services auth'],
    ['foo(bar)', ''],
    ['x'.repeat(61), ''],
  ])('speakableCode(%s) = %s', (code, spoken) => {
    expect(speakableCode(code)).toBe(spoken);
  });

  it('simplifies wikilinks and URLs', () => {
    expect(speakableText('See [[Auth Service]] or [[Billing Service|billing]] at https://www.example.com/a/b.')).toBe(
      'See Auth Service or billing at example.com.',
    );
  });
});

describe('SpeechFilter', () => {
  it('drops code blocks and humanizes inline code for any chunking', () => {
    const text =
      'Call `getUserByID` first.\n```go\nfunc main() {\n  fmt.Println("hi")\n}\n```\nThen see [[Auth Service|auth]] docs.';
    const results = allSplits(text, () => new SpeechFilter()).map((r) => r.replace(/\s+/g, ' ').trim());
    expect(new Set(results)).toEqual(new Set(['Call get User By ID first. Then see auth docs.']));
  });

  it('drops unfinished code blocks', () => {
    expect(filterText('Here:\n```bash\nmake dev', new SpeechFilter()).trim()).toBe('Here:');
  });

  it('treats a stray backtick as text', () => {
    const out = filterText(`It's 5 o\`clock and ${'long text '.repeat(10)}`, new SpeechFilter());
    expect(out).toContain('clock');
  });

  it('handles double-backtick spans', () => {
    expect(filterText('Use ``refreshToken`` now.', new SpeechFilter())).toBe('Use refresh Token now.');
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
