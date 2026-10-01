import { describe, expect, it } from 'vitest';
import { LOOKS, browPath, facePath, lidPath } from '@/lib/cartoon/character';
import { FaceAnimator, NEUTRAL_FACE, faceTargets } from '@/lib/cartoon/face';
import { NEUTRAL_MOUTH, mouthGeometry, mouthPose } from '@/lib/cartoon/mouth';
import { REST, type VisemeShape } from '@/lib/wordLipsync';

const shape = (values: Partial<VisemeShape>): VisemeShape => ({ ...REST, ...values });
const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('mouthPose', () => {
  it('is relaxed and closed at rest', () => {
    expect(mouthPose(REST)).toEqual({ ...NEUTRAL_MOUTH, smile: 0 });
  });

  it('opens wide for aa, rounds for O and U, and presses the lips for PP', () => {
    expect(mouthPose(shape({ viseme_aa: 1 })).open).toBe(1);
    const o = mouthPose(shape({ viseme_O: 1 }));
    expect(o.round).toBe(1);
    expect(o.width).toBeLessThan(1);
    expect(mouthPose(shape({ viseme_U: 1 })).width).toBeLessThan(o.width);
    expect(mouthPose(shape({ viseme_PP: 1 }))).toMatchObject({ open: 0, press: 1 });
    expect(mouthPose(shape({ viseme_FF: 1 })).teeth).toBe(1);
  });

  it('scales with the viseme weight and shares it between overlapping visemes', () => {
    expect(mouthPose(shape({ viseme_aa: 0.5 })).open).toBeCloseTo(0.5);
    const blend = mouthPose(shape({ viseme_aa: 1, viseme_O: 1 }));
    expect(blend.open).toBeCloseTo((1 + 0.7) / 2);
    expect(blend.round).toBeCloseTo(0.5);
  });

  it('adds the jaw and keeps every value in range', () => {
    expect(mouthPose(shape({ jawOpen: 0.2 })).open).toBeCloseTo(0.1);
    expect(mouthPose(shape({ viseme_aa: 1, jawOpen: 1 })).open).toBe(1);
  });

  it('smiles less with the mouth wide open', () => {
    expect(mouthPose(REST, 0.5).smile).toBe(0.5);
    expect(mouthPose(shape({ viseme_aa: 1 }), 0.5).smile).toBeCloseTo(0.2);
  });
});

describe('mouthGeometry', () => {
  const size = LOOKS.female.mouth;

  it('draws valid paths for any pose', () => {
    for (const s of [REST, shape({ viseme_aa: 1 }), shape({ viseme_U: 1 }), shape({ viseme_PP: 1, jawOpen: 0.2 })]) {
      const g = mouthGeometry(mouthPose(s, 0.4), size);
      for (const d of [g.lips, g.cavity, g.line]) {
        expect(d).toMatch(/^M /);
        expect(numbers(d).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('opens the cavity and drops the jaw as the mouth opens', () => {
    const closed = mouthGeometry(mouthPose(REST), size);
    const open = mouthGeometry(mouthPose(shape({ viseme_aa: 1 })), size);
    const height = (d: string) => {
      const ys = numbers(d).filter((_, i) => i % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(height(closed.cavity)).toBeCloseTo(0);
    expect(height(open.cavity)).toBeGreaterThan(size.maxGap * 0.7);
    expect(closed.jawDrop).toBe(0);
    expect(open.jawDrop).toBeGreaterThan(5);
  });

  it('lifts the corners when smiling', () => {
    const corner = (smile: number) => numbers(mouthGeometry(mouthPose(REST, smile), size).line)[1]!;
    expect(corner(0.8)).toBeLessThan(corner(0));
    expect(corner(-0.8)).toBeGreaterThan(corner(0));
  });
});

describe('character geometry', () => {
  it('moves the chin down with the jaw', () => {
    const chin = (d: string) => Math.max(...numbers(d).filter((_, i) => i % 2 === 1));
    expect(chin(facePath(LOOKS.male, 6)) - chin(facePath(LOOKS.male, 0))).toBeCloseTo(6);
  });

  it('closes the lid over the eye', () => {
    const lidY = (c: number) => numbers(lidPath('L', c).edge)[1]!;
    expect(lidY(1)).toBeGreaterThan(lidY(0) + 14);
  });

  it('raises the brows', () => {
    const innerY = (inner: number) => numbers(browPath('R', { inner, outer: 0 }))[1]!;
    expect(innerY(3)).toBe(innerY(0) - 3);
  });
});

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
