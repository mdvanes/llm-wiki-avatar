import { describe, expect, it } from 'vitest';
import { NEUTRAL_FACE, type FacePose } from '@/lib/face';
import { ARM_REST, MORPHS, boneRotations, gaze, morphWeights } from '@/lib/vrm/rig';
import { REST } from '@/lib/wordLipsync';

const face = (over: Partial<FacePose> = {}): FacePose => ({ ...structuredClone(NEUTRAL_FACE), ...over });

describe('VRM rig', () => {
  it('sets every morph, all closed at rest apart from the resting smile', () => {
    const w = morphWeights(face(), REST);
    expect(Object.keys(w).sort()).toEqual([...MORPHS].sort());
    for (const name of ['aa', 'ih', 'oh', 'ou', 'PP', 'jawOpen', 'eyeBlinkLeft', 'mouthFrownLeft', 'browDownLeft'] as const) {
      expect(w[name]).toBe(0);
    }
    expect(w.mouthSmileLeft).toBeGreaterThan(0);
    expect(w.mouthSmileLeft).toBeLessThan(0.2);
  });

  it('maps visemes to the model morph names, clamped to 0..1', () => {
    const w = morphWeights(face(), { ...REST, viseme_I: 0.7, viseme_O: 0.5, viseme_U: 0.3, viseme_aa: 1.4, jawOpen: -1 });
    expect(w).toMatchObject({ ih: 0.7, oh: 0.5, ou: 0.3, aa: 1, jawOpen: 0 });
    expect(w.E).toBe(0);
  });

  it('blinks with the eyelid; open at the resting lid', () => {
    expect(morphWeights(face({ lid: 1 }), REST).eyeBlinkLeft).toBe(1);
    expect(morphWeights(face({ lid: 1 }), REST).eyeBlinkRight).toBe(1);
    expect(morphWeights(face({ lid: 0.1 }), REST).eyeBlinkLeft).toBe(0);
  });

  it('smiles when happy and frowns when sad', () => {
    const happy = morphWeights(face({ smile: 0.7 }), REST);
    expect(happy.mouthSmileRight).toBeCloseTo(0.56);
    expect(happy.cheekSquintLeft).toBeGreaterThan(0);
    expect(happy.mouthFrownLeft).toBe(0);
    const sad = morphWeights(face({ smile: -0.45 }), REST);
    expect(sad.mouthSmileLeft).toBe(0);
    expect(sad.mouthFrownRight).toBeCloseTo(0.45);
  });

  it("moves the avatar's own brows: the viewer's left brow is the avatar's right", () => {
    const w = morphWeights(face({ browL: { inner: 3.5, outer: 5 }, browR: { inner: -1.5, outer: 0 } }), REST);
    expect(w.browOuterUpRight).toBe(1);
    expect(w.browOuterUpLeft).toBe(0);
    expect(w.browDownLeft).toBeCloseTo(0.5);
    expect(w.browDownRight).toBe(0);
    expect(w.browInnerUp).toBeCloseTo(0.25);
  });

  it('turns the gaze into -1..1, up positive', () => {
    const centre = gaze(face({ gazeX: 0, gazeY: 0 }));
    expect([Math.abs(centre.x), Math.abs(centre.y)]).toEqual([0, 0]);
    expect(gaze(face({ gazeX: 2.5, gazeY: -2.5 }))).toEqual({ x: 2.5 / 3.5, y: 2.5 / 3.5 });
    expect(gaze(face({ gazeX: -10, gazeY: 10 }))).toEqual({ x: -1, y: -1 });
  });

  it('splits head motion over neck and head, keeps the arms down and the angles small', () => {
    const r = boneRotations(face({ tilt: 5, headX: 1.5, headY: 3, breath: 1.2 }));
    expect(r.neck[2]).toBeLessThan(0);
    expect(r.neck[2] + r.head[2]).toBeCloseTo((-5 * 0.6 * Math.PI) / 180);
    expect(r.head[1]).toBeGreaterThan(0);
    expect(r.head[0]).toBeGreaterThan(0);
    expect(r.leftShoulder[2]).toBeCloseTo(-r.rightShoulder[2]);
    expect(r.leftUpperArm).toEqual(ARM_REST.leftUpperArm);
    for (const [bone, angles] of Object.entries(r)) {
      if (bone.endsWith('Arm')) continue;
      for (const a of angles) expect(Math.abs(a)).toBeLessThan((6 * Math.PI) / 180);
    }
    expect(boneRotations(face()).head.map(Math.abs)).toEqual([0, 0, 0]);
  });
});
