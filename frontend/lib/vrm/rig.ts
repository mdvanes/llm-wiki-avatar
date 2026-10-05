/**
 * Maps the shared face pose and mouth shape onto a VRM avatar: ARKit and Oculus viseme morph targets for the face,
 * eye look-at, and humanoid bone rotations for the head, breathing and arms. No three.js here, so it can be tested.
 */
import type { FacePose } from '../face';
import { VISEMES, type Viseme, type VisemeShape } from '../wordLipsync';

/** Morph target names on the model for each viseme; the rest share the Oculus names. */
const VISEME_MORPH: Partial<Record<Viseme, string>> = { I: 'ih', O: 'oh', U: 'ou' };

export const MORPHS = [
  ...VISEMES.map((v) => VISEME_MORPH[v] ?? v),
  'jawOpen',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'cheekSquintLeft',
  'cheekSquintRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'browDownLeft',
  'browDownRight',
] as const;
export type MorphName = (typeof MORPHS)[number];

/** Brow raise in cartoon px that maps to a full morph. */
const BROW_UP = 4;
const BROW_DOWN = 3;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The FacePose `lid` rests at 0.1 with the eyes fully open; this maps it to 0 open .. 1 closed. */
export const lidClosure = (lid: number) => clamp01((lid - 0.1) / 0.9);

/**
 * Morph weights for one frame. Left and right are the avatar's own sides (ARKit), so the brow on the viewer's left
 * (`browL`) drives the avatar's right brow.
 */
export function morphWeights(pose: FacePose, shape: VisemeShape): Record<MorphName, number> {
  const w = Object.fromEntries(MORPHS.map((m) => [m, 0])) as Record<MorphName, number>;
  for (const v of VISEMES) w[(VISEME_MORPH[v] ?? v) as MorphName] = clamp01(shape[`viseme_${v}`]);
  w.jawOpen = clamp01(shape.jawOpen);

  const blink = lidClosure(pose.lid);
  w.eyeBlinkLeft = blink;
  w.eyeBlinkRight = blink;

  const smile = clamp01(pose.smile);
  const frown = clamp01(-pose.smile);
  w.mouthSmileLeft = w.mouthSmileRight = 0.8 * smile;
  w.cheekSquintLeft = w.cheekSquintRight = 0.6 * smile;
  w.eyeSquintLeft = w.eyeSquintRight = 0.3 * smile;
  w.mouthFrownLeft = w.mouthFrownRight = frown;

  w.browInnerUp = clamp01((pose.browL.inner + pose.browR.inner) / 2 / BROW_UP);
  w.browOuterUpRight = clamp01(pose.browL.outer / BROW_UP);
  w.browOuterUpLeft = clamp01(pose.browR.outer / BROW_UP);
  w.browDownRight = clamp01(-Math.min(pose.browL.inner, pose.browL.outer) / BROW_DOWN);
  w.browDownLeft = clamp01(-Math.min(pose.browR.inner, pose.browR.outer) / BROW_DOWN);
  return w;
}

/** Gaze in cartoon px that maps to the full look-at range. */
const GAZE_FULL = 3.5;

/** Eye direction, -1..1: positive x towards the viewer's right, positive y up. */
export function gaze(pose: FacePose): { x: number; y: number } {
  const c = (v: number) => Math.min(1, Math.max(-1, v));
  return { x: c(pose.gazeX / GAZE_FULL), y: c(-pose.gazeY / GAZE_FULL) };
}

export type RigBone =
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftUpperArm'
  | 'rightUpperArm'
  | 'leftLowerArm'
  | 'rightLowerArm';

/** Euler angles in radians, for normalized humanoid bones of a model that faces the viewer (+Z). */
export type Rotation = [x: number, y: number, z: number];

const DEG = Math.PI / 180;

/** Arms down from the T-pose, elbows slightly bent. */
export const ARM_REST: Partial<Record<RigBone, Rotation>> = {
  leftUpperArm: [0, 0, -72 * DEG],
  rightUpperArm: [0, 0, 72 * DEG],
  leftLowerArm: [0, -12 * DEG, 0],
  rightLowerArm: [0, 12 * DEG, 0],
};

/** Degrees per cartoon unit. */
const ROLL = 0.6;
const TURN = 2.5;
const NOD = 1.6;
const BREATH = 0.8;
/** Share of the head motion done by the neck; the head does the rest. */
const NECK = 0.4;

/**
 * Bone rotations for one frame. The cartoon tilt is clockwise on screen, which is a negative roll about +Z; the head
 * offset turns the face towards it, and a downward offset is a nod.
 */
export function boneRotations(pose: FacePose): Record<RigBone, Rotation> {
  const roll = -pose.tilt * ROLL * DEG;
  const turn = pose.headX * TURN * DEG;
  const nod = pose.headY * NOD * DEG;
  const breath = pose.breath * BREATH * DEG;
  const split = (share: number): Rotation => [nod * share, turn * share, roll * share];
  return {
    spine: [0, 0, 0],
    chest: [-0.5 * breath, 0, 0],
    neck: split(NECK),
    head: split(1 - NECK),
    leftShoulder: [0, 0, breath],
    rightShoulder: [0, 0, -breath],
    leftUpperArm: ARM_REST.leftUpperArm!,
    rightUpperArm: ARM_REST.rightUpperArm!,
    leftLowerArm: ARM_REST.leftLowerArm!,
    rightLowerArm: ARM_REST.rightLowerArm!,
  };
}
