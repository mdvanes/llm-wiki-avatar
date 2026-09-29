import { describe, expect, it } from 'vitest';
import {
  CALM_HEAD,
  CALM_POSE,
  calmAvatar,
  eyeLevelCameraY,
  eyePitchToCamera,
  headPitchCorrection,
  type TalkingHeadInternals,
} from '@/lib/avatar-calm';

function fakeHead() {
  const eyes = { name: 'eyes', idle: { alt: [{ p: 0.2 }] }, speaking: { alt: [{ p: 0.5 }] } };
  const moods = {
    neutral: { anims: [{ name: 'breathing' }, { name: 'pose' }, { name: 'head' }, eyes] },
    happy: { anims: [{ name: 'pose' }, { name: 'head' }, eyes] },
    sleep: { anims: [{ name: 'head' }] },
  };
  const calls: string[] = [];
  const head: TalkingHeadInternals = {
    animMoods: moods,
    animTemplateEyes: eyes,
    moodName: 'happy',
    poseTemplates: { straight: { name: 'straight' } },
    setPoseFromTemplate: (t) => calls.push(`pose:${(t as { name: string }).name}`),
    setMood: (m) => calls.push(`mood:${m}`),
  };
  return { head, moods, eyes, calls };
}

describe('calmAvatar', () => {
  it('replaces head, pose and eye animations and keeps the rest', () => {
    const { head, moods, eyes, calls } = fakeHead();
    calmAvatar(head);
    expect(moods.neutral.anims.map((a) => a.name)).toEqual(['breathing', 'pose', 'head', 'eyes']);
    expect(moods.neutral.anims[1]).toBe(CALM_POSE);
    expect(moods.happy.anims[1]).toBe(CALM_HEAD);
    expect(moods.sleep.anims[0]).not.toBe(CALM_HEAD);
    expect(eyes.idle.alt).toHaveLength(1);
    expect(JSON.stringify(eyes.speaking)).toContain('"eyeContact":[1]');
    expect(calls).toEqual(['pose:straight', 'mood:happy']);
  });
});

describe('eyeLevelCameraY', () => {
  it('inverts the head view camera height', () => {
    const opts = { view: 'head' as const, avatarHeight: 1.8, fovDeg: 30, cameraDistance: 0 };
    const eyeY = 1.7;
    const cameraY = eyeLevelCameraY({ ...opts, eyeY });
    const y = (1 - cameraY) * Math.tan((30 * Math.PI) / 360) * 2 + (4 / 5) * 1.8;
    expect(y).toBeCloseTo(eyeY, 6);
  });
});

describe('headPitchCorrection', () => {
  it('leaves upright heads alone', () => {
    expect(headPitchCorrection({ y: 1, z: 0.05 })).toBe(0);
    expect(headPitchCorrection({ y: 1, z: -0.2 })).toBe(0);
  });
  it('tilts a forward-leaning head back by half the excess angle', () => {
    expect(headPitchCorrection({ y: Math.cos(0.17), z: Math.sin(0.17) })).toBeCloseTo(-0.055, 3);
  });
});

describe('eyePitchToCamera', () => {
  it('looks straight when the face points at the camera', () => {
    expect(eyePitchToCamera(0.1, 0.1)).toEqual({ down: 0, up: 0 });
  });
  it('looks up when the face points below the camera, and down otherwise', () => {
    expect(eyePitchToCamera(0.1, 0)).toEqual({ down: 0, up: expect.closeTo(0.2, 6) });
    expect(eyePitchToCamera(0, 0.1).down).toBeCloseTo(0.2, 6);
    expect(eyePitchToCamera(0, 2).down).toBe(0.9);
  });
});
