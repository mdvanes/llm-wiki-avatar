import { describe, expect, it } from 'vitest';
import { Vad, type VadEvent } from '@/lib/stt/vad';

const RATE = 16_000;
const FRAME = 160; // 10 ms

const frame = (level: number) => new Float32Array(FRAME).fill(level);

function feed(vad: Vad, level: number, ms: number): VadEvent[] {
  const events: VadEvent[] = [];
  for (let i = 0; i < ms / 10; i++) {
    const e = vad.push(frame(level));
    if (e) events.push(e);
  }
  return events;
}

describe('Vad', () => {
  it('ignores silence', () => {
    expect(feed(new Vad(RATE), 0.001, 2000)).toEqual([]);
  });

  it('emits an utterance with pre-roll after speech and silence', () => {
    const vad = new Vad(RATE);
    feed(vad, 0.001, 1000);
    const events = [...feed(vad, 0.2, 1000), ...feed(vad, 0.001, 1000)];
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);
    const end = events[1] as Extract<VadEvent, { type: 'end' }>;
    const ms = (end.samples.length / RATE) * 1000;
    // ~1000 ms speech + 300 ms pre-roll + ~900 ms trailing silence
    expect(ms).toBeGreaterThan(1900);
    expect(ms).toBeLessThan(2400);
  });

  it('discards blips shorter than the minimum', () => {
    const vad = new Vad(RATE);
    const events = [...feed(vad, 0.2, 200), ...feed(vad, 0.001, 1200)];
    expect(events.map((e) => e.type)).toEqual(['start', 'discard']);
  });

  it('cuts very long utterances', () => {
    // Still talking at the cut: the first utterance ends at 30 s and the rest starts the next one.
    const events = feed(new Vad(RATE), 0.2, 31_000);
    expect(events.map((e) => e.type)).toEqual(['start', 'end', 'start']);
  });

  it('raises the threshold in steady background noise', () => {
    const quiet = new Vad(RATE);
    feed(quiet, 0.012, 3000);
    expect(quiet.threshold).toBeGreaterThan(0.015);
    expect(feed(quiet, 0.03, 1000)).toEqual([]);
  });

  it('forgets the audio on reset', () => {
    const vad = new Vad(RATE);
    feed(vad, 0.2, 300);
    expect(vad.speaking).toBe(true);
    vad.reset();
    expect(vad.speaking).toBe(false);
  });
});
