import { describe, expect, it, vi } from 'vitest';

vi.mock('@livekit/components-react', () => ({}));

const { ringSize, SPEECH_LEVEL } = await import('@/components/MicButton');

describe('ringSize', () => {
  it('stays hidden for silence and room noise', () => {
    expect(ringSize(0)).toBe(0);
    expect(ringSize(SPEECH_LEVEL)).toBe(0);
    expect(ringSize(Number.NaN)).toBe(0);
  });

  it('grows with the level and is capped', () => {
    const quiet = ringSize(SPEECH_LEVEL + 0.02);
    const loud = ringSize(0.2);
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(ringSize(1)).toBe(12);
  });
});
