// Calmer idle behaviour and eye-level framing for TalkingHead avatars. TalkingHead has no public options for these, so
// this adjusts its animation templates (see animMoods / animTemplateEyes in talkinghead.mjs).

export type AvatarView = 'head' | 'upper';

type Range = [number, number] | [number, number, number, number];
interface AnimTemplate {
  name?: string;
  [key: string]: unknown;
}
interface MoodTemplate {
  anims: AnimTemplate[];
}

/** The internals of a TalkingHead instance this module touches. */
export interface TalkingHeadInternals {
  animMoods: Record<string, MoodTemplate>;
  animTemplateEyes: AnimTemplate;
  moodName?: string;
  poseName?: string;
  poseTemplates?: Record<string, unknown>;
  setPoseFromTemplate?: (template: unknown) => void;
  setMood: (mood: string) => void;
}

// Look at the viewer continuously, without random glances.
const EYE_CONTACT = { delay: 0, dt: [[2000, 6000]], vs: { eyeContact: [1], headMove: [0] } };
export const CALM_EYES = { idle: { alt: [EYE_CONTACT] }, speaking: { alt: [EYE_CONTACT] } };

// Small head/body sway; TalkingHead's defaults turn the body up to ±0.3 rad while idle.
const sway = (x: Range, y: Range, z: Range) => ({ bodyRotateX: [x], bodyRotateY: [y], bodyRotateZ: [z] });
export const CALM_HEAD: AnimTemplate = {
  name: 'head',
  idle: { delay: [0, 1000], dt: [[2000, 6000]], vs: sway([-0.02, 0.04], [-0.05, 0.05], [-0.02, 0.02]) },
  speaking: { dt: [[0, 1000, 0]], vs: sway([-0.02, 0.06, 1, 2], [-0.04, 0.04], [-0.03, 0.03]) },
};

// Keep a straight stance; the defaults switch between side, hip and wide poses every 5–30 s.
export const CALM_POSE: AnimTemplate = { name: 'pose', delay: [60000, 120000], vs: { pose: ['straight'] } };

/** Replaces the head, pose and eye animations of every mood, and switches to the straight pose now. */
export function calmAvatar(head: TalkingHeadInternals): void {
  Object.assign(head.animTemplateEyes, CALM_EYES);
  for (const [name, mood] of Object.entries(head.animMoods)) {
    if (name === 'sleep') continue;
    mood.anims = mood.anims.map((anim) =>
      anim.name === 'head' ? CALM_HEAD : anim.name === 'pose' ? CALM_POSE : anim,
    );
  }
  const straight = head.poseTemplates?.straight;
  if (straight && head.setPoseFromTemplate) {
    head.poseName = 'straight';
    head.setPoseFromTemplate(straight);
  }
  head.setMood(head.moodName ?? 'neutral');
}

/** TalkingHead's camera height offset per view, as a fraction of the avatar height, and base distance. */
const VIEW_GEOMETRY: Record<AvatarView, { height: number; distance: number }> = {
  head: { height: 4 / 5, distance: 2 },
  upper: { height: 2 / 3, distance: 4.5 },
};

/**
 * The `cameraY` that puts a level camera at eye height, so an avatar looking straight ahead looks at the viewer.
 * Inverts TalkingHead's setView: y = (1 - cameraY) · tan(fov/2) · z + h · avatarHeight.
 */
export function eyeLevelCameraY(opts: {
  view: AvatarView;
  eyeY: number;
  avatarHeight: number;
  fovDeg: number;
  cameraDistance: number;
}): number {
  const { height, distance } = VIEW_GEOMETRY[opts.view];
  const z = distance + opts.cameraDistance;
  const t = Math.tan((opts.fovDeg * Math.PI) / 360);
  return 1 - (opts.eyeY - height * opts.avatarHeight) / (t * z);
}

/** Head pitch (radians, forward positive) that looks natural; e.g. the MPFB sample rests at about 0.06. */
const TARGET_HEAD_PITCH = 0.06;

/**
 * The `headRotateX` baseline that levels a head leaning forward in the model's rest pose (e.g. the AvatarSDK sample,
 * about 0.17 rad), so the avatar looks at the viewer instead of down. TalkingHead adds headRotateX to the head
 * quaternion's x component, which is about half the rotation angle.
 * @param headUp the head bone's world up (Y) axis
 */
export function headPitchCorrection(headUp: { y: number; z: number }): number {
  const pitch = Math.atan2(headUp.z, headUp.y);
  if (!Number.isFinite(pitch) || pitch <= TARGET_HEAD_PITCH) return 0;
  return -Math.min(pitch - TARGET_HEAD_PITCH, 0.4) / 2;
}

/** ARKit eyesLookDown/Up of 1 turns the eyes by roughly half a radian (TalkingHead maps 1 rad of head pitch to 2). */
const EYE_PITCH_PER_UNIT = 0.5;

/**
 * Vertical eye blend shapes that aim the eyes at the camera.
 * @param faceDown pitch of the face below horizontal (radians)
 * @param cameraDown angle of the camera below the eyes (radians)
 */
export function eyePitchToCamera(faceDown: number, cameraDown: number): { down: number; up: number } {
  const units = Math.max(-0.9, Math.min(0.9, (cameraDown - faceDown) / EYE_PITCH_PER_UNIT));
  return { down: Math.max(units, 0), up: Math.max(-units, 0) };
}
