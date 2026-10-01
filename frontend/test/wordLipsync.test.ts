import { LipsyncEn } from '@met4citizen/talkinghead/modules/lipsync-en.mjs';
import { describe, expect, it } from 'vitest';
import type { WordSegment } from '@/lib/protocol';
import { REST, VISEME_KEYS, type VisemeShape, WordLipSync, shapeAt, wordEvents } from '@/lib/wordLipsync';

const rules = new LipsyncEn();
const toVisemes = (w: string) => rules.wordsToVisemes(rules.preProcessText(w));

const hello: WordSegment = { id: 'a', words: [{ w: 'Hello', s: 50, e: 400 }], final: false };
const helloEvents = wordEvents(hello.words[0]!, toVisemes);
const LAG = 20;

/** Near-instant smoothing, so update() returns the envelope shape at (t + 1 ms). */
function sync(): WordLipSync {
  return new WordLipSync(toVisemes, { smoothingMs: 1 });
}

function strongest(shape: VisemeShape | null): string | undefined {
  if (!shape) return undefined;
  const [key, value] = VISEME_KEYS.map((k) => [k, shape[k]] as const).sort((a, b) => b[1] - a[1])[0]!;
  return value > 0.05 ? key : undefined;
}

describe('wordEvents', () => {
  it('spreads the visemes of a word over its time with overlapping envelopes', () => {
    expect(helloEvents.map((e) => e.key)).toEqual(['viseme_I', 'viseme_E', 'viseme_nn', 'viseme_O']);
    for (const e of helloEvents) {
      expect(e.start).toBeGreaterThanOrEqual(50 - 60);
      expect(e.end).toBeLessThanOrEqual(400 + 60);
      expect(e.start).toBeLessThan(e.peak);
      expect(e.peak).toBeLessThan(e.end);
    }
    for (let i = 1; i < helloEvents.length; i++) expect(helloEvents[i]!.start).toBeLessThan(helloEvents[i - 1]!.end);
  });

  it('closes the lips firmly for P, B and M', () => {
    const [p] = wordEvents({ w: 'pop', s: 0, e: 300 }, toVisemes);
    expect(p).toMatchObject({ key: 'viseme_PP', level: 0.9 });
  });

  it('ignores words without visemes', () => {
    expect(wordEvents({ w: '', s: 0, e: 100 }, () => undefined)).toEqual([]);
  });
});

describe('shapeAt', () => {
  it('is at rest outside words and keeps the jaw small', () => {
    expect(shapeAt(helloEvents, -100)).toEqual(REST);
    expect(shapeAt(helloEvents, 1000)).toEqual(REST);
    for (let t = 0; t < 500; t += 5) {
      const s = shapeAt(helloEvents, t);
      expect(s.jawOpen).toBeLessThanOrEqual(0.2);
      for (const k of VISEME_KEYS) expect(s[k]).toBeLessThanOrEqual(1);
    }
    expect(strongest(shapeAt(helloEvents, 360))).toBe('viseme_O');
  });

  it('changes smoothly', () => {
    let prev = shapeAt(helloEvents, 0);
    for (let t = 1; t < 500; t++) {
      const s = shapeAt(helloEvents, t);
      for (const k of VISEME_KEYS) expect(Math.abs(s[k] - prev[k])).toBeLessThan(0.1);
      prev = s;
    }
  });
});

describe('WordLipSync', () => {
  it('waits for the audio, then follows the words from where it started', () => {
    const w = sync();
    w.add(hello, 0);
    expect(w.update(500, 0, 16)).toBeNull();
    w.update(1000, 0.05, 16);
    // Anchored at 1000 - 50 (first word) - lag.
    const anchor = 1000 - 50 - LAG;
    const shape = w.update(anchor + 360, 0.05, 16);
    expect(strongest(shape)).toBe(strongest(shapeAt(helloEvents, 361)));
    expect(shape!.viseme_O).toBeCloseTo(shapeAt(helloEvents, 361).viseme_O, 1);
  });

  it('anchors words that arrive just after their audio started', () => {
    const w = sync();
    w.update(1000, 0.05, 16);
    w.add(hello, 1100);
    const anchor = 1000 - 50 - LAG;
    expect(w.update(anchor + 360, 0.05, 16)!.viseme_O).toBeCloseTo(shapeAt(helloEvents, 361).viseme_O, 1);
  });

  it('chains segments when the audio runs on without a pause', () => {
    const w = sync();
    w.add({ ...hello, final: true, durationMs: 500 }, 0);
    const next: WordSegment = { id: 'b', words: [{ w: 'Hello', s: 50, e: 400 }], final: true, durationMs: 500 };
    w.add(next, 0);
    w.update(1000, 0.05, 16);
    const anchor = 1000 - 50 - LAG;
    for (let t = 1016; t < anchor + 500 + 90; t += 16) w.update(t, 0.05, 16);
    // The second segment starts where the first ended.
    const shape = w.update(anchor + 500 + 360, 0.05, 16);
    expect(shape!.viseme_O).toBeCloseTo(shapeAt(helloEvents, 361).viseme_O, 1);
    expect(w.pending).toBe(1);
  });

  it('re-anchors the next segment after a gap in the audio', () => {
    const w = sync();
    w.add({ ...hello, final: true, durationMs: 500 }, 0);
    w.add({ id: 'b', words: [{ w: 'Hello', s: 50, e: 400 }], final: true, durationMs: 500 }, 0);
    w.update(1000, 0.05, 16);
    const anchor = 1000 - 50 - LAG;
    for (let t = 1016; t < anchor + 500; t += 16) w.update(t, 0.05, 16);
    // The TTS fell behind: silence, then the next sentence starts late.
    for (let t = anchor + 500; t < 2000; t += 16) {
      const rest = w.update(t, 0, 16);
      expect(Math.max(...Object.values(rest!))).toBeLessThan(1e-3);
    }
    w.update(2000, 0.05, 16);
    const shape = w.update(2000 - 50 - LAG + 360, 0.05, 16);
    expect(shape!.viseme_O).toBeCloseTo(shapeAt(helloEvents, 361).viseme_O, 1);
  });

  it('skips segments without words and hands back to loudness lip-sync when idle', () => {
    const w = sync();
    w.add({ id: 'x', words: [], final: true, durationMs: 100 }, 0);
    expect(w.pending).toBe(1);
    expect(w.update(10, 0.05, 16)).toBeNull();
    expect(w.pending).toBe(0);
  });

  it('forgets everything on clear', () => {
    const w = sync();
    w.add(hello, 0);
    w.update(1000, 0.05, 16);
    w.clear();
    expect(w.pending).toBe(0);
    expect(w.update(1100, 0.05, 16)).toBeNull();
  });

  it('drops segments whose audio never came', () => {
    const w = new WordLipSync(toVisemes, { staleMs: 1000 });
    w.add(hello, 0);
    w.update(2000, 0, 16);
    expect(w.pending).toBe(0);
  });

  it('merges pieces of the same segment', () => {
    const w = sync();
    w.add({ id: 'a', words: [{ w: 'Hello', s: 50, e: 400 }], final: false }, 0);
    w.add({ id: 'a', words: [{ w: 'there', s: 400, e: 700 }], final: false }, 0);
    w.add({ id: 'a', words: [], final: true, durationMs: 800 }, 0);
    expect(w.pending).toBe(1);
    w.update(1000, 0.05, 16);
    expect(strongest(w.update(1000 - 50 - LAG + 550, 0.05, 16))).toBeDefined();
    w.update(1000 - 50 - LAG + 801, 0.05, 16);
    expect(w.pending).toBe(0);
  });
});
