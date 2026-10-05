import { describe, expect, it } from 'vitest';
import { FaceAnimator, NEUTRAL_FACE, faceTargets } from '@/lib/face';

describe('faceTargets', () => {
  it('reflects the mood', () => {
    expect(faceTargets('happy', 'listening').smile).toBeGreaterThan(faceTargets('neutral', 'listening').smile);
    expect(faceTargets('sad', 'speaking').smile).toBeLessThan(0);
    const confused = faceTargets('confused', 'speaking');
    expect(confused.browL.outer).toBeGreaterThan(confused.browR.outer);
  });

  it('looks away while thinking', () => {
    const t = faceTargets('neutral', 'thinking');
    expect(t.gazeY).toBeLessThan(0);
    expect(t.browL.inner).toBeLessThan(0);
  });
});

describe('FaceAnimator', () => {
  const run = (animator: FaceAnimator, from: number, to: number, state = 'listening', level = 0) => {
    let pose = animator.update(from, 16, { state, level });
    for (let t = from + 16; t <= to; t += 16) pose = animator.update(t, 16, { state, level });
    return pose;
  };

  it('blinks every few seconds', () => {
    const animator = new FaceAnimator({ random: () => 0.5 });
    const lids: number[] = [];
    for (let t = 0; t < 12000; t += 16) lids.push(animator.update(t, 16, { state: 'listening', level: 0 }).lid);
    const blinks = lids.filter((l, i) => l > 0.9 && (lids[i - 1] ?? 0) <= 0.9).length;
    expect(blinks).toBeGreaterThanOrEqual(2);
    expect(blinks).toBeLessThanOrEqual(5);
    expect(Math.min(...lids)).toBeGreaterThanOrEqual(NEUTRAL_FACE.lid - 1e-6);
  });

  it('eases into a mood and relaxes after the agent stops speaking', () => {
    const animator = new FaceAnimator({ random: () => 0.5, motion: 0 });
    animator.setMood('happy', 0);
    expect(run(animator, 0, 2000, 'speaking').smile).toBeGreaterThan(0.6);
    expect(run(animator, 2016, 6000, 'listening').smile).toBeGreaterThan(0.6);
    expect(run(animator, 6016, 12000, 'listening').smile).toBeCloseTo(0.15, 1);
  });

  it('nods and raises the brows with the voice', () => {
    const quiet = run(new FaceAnimator({ random: () => 0.5, motion: 0 }), 0, 1000, 'speaking', 0);
    const loud = run(new FaceAnimator({ random: () => 0.5, motion: 0 }), 0, 1000, 'speaking', 0.9);
    expect(loud.headY).toBeGreaterThan(quiet.headY + 1.5);
    expect(loud.browL.inner).toBeGreaterThan(quiet.browL.inner + 1);
  });

  it('holds still without motion', () => {
    const pose = run(new FaceAnimator({ random: () => 0.5, motion: 0 }), 0, 3000);
    expect(pose.headX).toBeCloseTo(0);
    expect(pose.breath).toBeCloseTo(0);
  });
});
