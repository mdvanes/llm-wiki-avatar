import { describe, expect, it } from 'vitest';
import { CLOSED, LipSync, brightness, rms } from '@/lib/lipsync';

function sine(freq: number, amp: number, n = 1024, rate = 48000): Float32Array {
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));
}

describe('rms', () => {
  it('is 0 for silence and amp/√2 for a sine', () => {
    expect(rms(new Float32Array(512))).toBe(0);
    expect(rms(sine(440, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });
});

describe('brightness', () => {
  const bins = 512;
  const rate = 48000;
  const binHz = rate / 2 / bins;
  const spectrum = (hz: number) => {
    const f = new Uint8Array(bins);
    f[Math.round(hz / binHz)] = 200;
    return f;
  };
  it('is 0.5 without energy, low for dark vowels and high for bright ones', () => {
    expect(brightness(new Uint8Array(bins), rate)).toBe(0.5);
    expect(brightness(spectrum(500), rate)).toBeLessThan(0.2);
    expect(brightness(spectrum(2500), rate)).toBeGreaterThan(0.8);
  });
});

describe('LipSync', () => {
  it('stays closed below the noise floor', () => {
    const lips = new LipSync();
    for (let i = 0; i < 10; i++) expect(lips.update(0.004, 0.5, 16)).toEqual(CLOSED);
  });

  it('opens quickly on speech and closes after it', () => {
    const lips = new LipSync();
    let shape = CLOSED;
    for (let i = 0; i < 6; i++) shape = lips.update(0.12, 0.5, 16);
    expect(shape.jawOpen).toBeGreaterThan(0.2);
    expect(shape.viseme_aa).toBeGreaterThan(0.3);
    for (let i = 0; i < 40; i++) shape = lips.update(0, 0.5, 16);
    expect(shape).toEqual(CLOSED);
  });

  it('rounds the mouth for dark sounds and spreads it for bright ones', () => {
    const dark = new LipSync();
    const bright = new LipSync();
    let d = CLOSED;
    let b = CLOSED;
    for (let i = 0; i < 30; i++) {
      d = dark.update(0.12, 0.1, 16);
      b = bright.update(0.12, 0.9, 16);
    }
    expect(d.viseme_O).toBeGreaterThan(d.viseme_E);
    expect(b.viseme_E).toBeGreaterThan(b.viseme_O);
  });

  it('never exceeds 1 and resets', () => {
    const lips = new LipSync();
    let shape = CLOSED;
    for (let i = 0; i < 20; i++) shape = lips.update(10, 0.5, 100);
    for (const v of Object.values(shape)) expect(v).toBeLessThanOrEqual(1);
    lips.reset();
    expect(lips.shape()).toEqual(CLOSED);
  });
});
