/**
 * The cartoon mouth: Oculus visemes (from the loudness or word-timed lip-sync) are blended into a handful of mouth
 * parameters, which are drawn as smooth curves. Blending parameters rather than switching drawings keeps every
 * transition fluid, and a flat cartoon mouth hides small timing errors.
 */
import { VISEMES, type Viseme, type VisemeShape } from '../wordLipsync';

export interface MouthPose {
  /** 0 closed .. 1 wide open. */
  open: number;
  /** Width relative to the relaxed mouth: below 1 is puckered, above 1 is stretched. */
  width: number;
  /** 0 flat .. 1 rounded (o, u). */
  round: number;
  /** How much of the upper teeth shows. */
  teeth: number;
  /** How far the tongue is raised toward the teeth. */
  tongue: number;
  /** Lips pressed together (p, b, m). */
  press: number;
  /** Corners up (positive) or down (negative), -1..1. */
  smile: number;
}

type Shape = Omit<MouthPose, 'smile'>;

export const NEUTRAL_MOUTH: Shape = { open: 0, width: 1, round: 0, teeth: 0, tongue: 0, press: 0 };

const POSES: Record<Viseme, Partial<Shape>> = {
  PP: { width: 0.94, press: 1 },
  FF: { open: 0.12, teeth: 1 },
  TH: { open: 0.2, teeth: 0.8, tongue: 1 },
  DD: { open: 0.25, teeth: 0.9, tongue: 0.6 },
  kk: { open: 0.35, teeth: 0.7, tongue: 0.3 },
  CH: { open: 0.25, width: 0.82, round: 0.5, teeth: 1 },
  SS: { open: 0.12, width: 1.05, teeth: 1 },
  nn: { open: 0.22, teeth: 0.6, tongue: 0.7 },
  RR: { open: 0.25, width: 0.85, round: 0.55, teeth: 0.4 },
  aa: { open: 1, width: 1.05, teeth: 0.5, tongue: 0.2 },
  E: { open: 0.55, width: 1.12, teeth: 0.7 },
  I: { open: 0.35, width: 1.15, teeth: 0.8 },
  O: { open: 0.7, width: 0.72, round: 1, teeth: 0.2 },
  U: { open: 0.35, width: 0.6, round: 1 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Blends the viseme weights into one mouth pose; overlapping visemes share the weight instead of adding up. */
export function mouthPose(shape: VisemeShape, smile = 0): MouthPose {
  let total = 0;
  for (const v of VISEMES) total += Math.max(0, shape[`viseme_${v}`]);
  const scale = total > 1 ? 1 / total : 1;
  const pose: Shape = { ...NEUTRAL_MOUTH };
  for (const v of VISEMES) {
    const w = Math.max(0, shape[`viseme_${v}`]) * scale;
    if (w === 0) continue;
    for (const [key, value] of Object.entries(POSES[v]) as [keyof Shape, number][]) {
      pose[key] += w * (value - NEUTRAL_MOUTH[key]);
    }
  }
  const open = clamp(pose.open + 0.5 * Math.max(0, shape.jawOpen), 0, 1);
  // A wide-open mouth cannot smile much.
  return { ...pose, open, smile: clamp(smile, -1, 1) * (1 - 0.6 * open) };
}

export interface MouthSize {
  /** Half the width of the relaxed mouth. */
  halfWidth: number;
  /** Opening at `open: 1`. */
  maxGap: number;
  upperLip: number;
  lowerLip: number;
}

export interface MouthGeometry {
  /** Both lips, as one filled outline. */
  lips: string;
  /** The opening between the lips; also the clip path for teeth and tongue. */
  cavity: string;
  /** The line where the lips meet; it is what remains when the mouth is closed. */
  line: string;
  teeth: { y: number; height: number; halfWidth: number };
  tongue: { cy: number; rx: number; ry: number };
  /** How far the chin drops. */
  jawDrop: number;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const pt = (x: number, y: number) => `${f(x)} ${f(y)}`;

/** Control y of a symmetric cubic from (±x, y0) whose middle reaches `mid`. */
const bulge = (y0: number, mid: number) => (4 * mid - y0) / 3;

/** The mouth outline for a pose, centred on (0, 0) where the lips meet. */
export function mouthGeometry(pose: MouthPose, size: MouthSize): MouthGeometry {
  const width = clamp(pose.width, 0.4, 1.4);
  const round = clamp(pose.round, 0, 1);
  const open = clamp(pose.open, 0, 1);
  const hw = size.halfWidth * width;
  const inner = hw * 0.9;
  const gap = open * size.maxGap;
  const corner = -pose.smile * size.halfWidth * 0.22;
  // The upper lip barely moves; the jaw carries the lower one.
  const top = -gap * 0.3;
  const bottom = gap * 0.7;
  const k = 0.5 + 0.45 * round;
  const thin = 1 - 0.35 * clamp(pose.press, 0, 1);
  const upperLip = size.upperLip * thin * (1 + 0.2 * round);
  const lowerLip = size.lowerLip * thin * (1 + 0.15 * round);

  const upperInner = `C ${pt(-inner * k, bulge(corner, top))} ${pt(inner * k, bulge(corner, top))} ${pt(inner, corner)}`;
  const lowerInner = `C ${pt(inner * k, bulge(corner, bottom))} ${pt(-inner * k, bulge(corner, bottom))} ${pt(-inner, corner)}`;

  const lipTop = top - upperLip;
  const lipBottom = bottom + lowerLip;
  const bow = upperLip * 0.35;
  const lips = [
    `M ${pt(-hw, corner)}`,
    `C ${pt(-hw * 0.7, bulge(corner, lipTop))} ${pt(-hw * 0.35, lipTop - bow)} ${pt(-hw * 0.15, lipTop - bow)}`,
    `Q ${pt(0, lipTop - bow)} ${pt(0, lipTop + bow * 0.6)}`,
    `Q ${pt(0, lipTop - bow)} ${pt(hw * 0.15, lipTop - bow)}`,
    `C ${pt(hw * 0.35, lipTop - bow)} ${pt(hw * 0.7, bulge(corner, lipTop))} ${pt(hw, corner)}`,
    `C ${pt(hw * (k + 0.1), bulge(corner, lipBottom))} ${pt(-hw * (k + 0.1), bulge(corner, lipBottom))} ${pt(-hw, corner)}`,
    'Z',
  ].join(' ');

  const tongueRaise = clamp(pose.tongue, 0, 1) * gap * 0.45;
  return {
    lips,
    cavity: `M ${pt(-inner, corner)} ${upperInner} ${lowerInner} Z`,
    line: `M ${pt(-inner, corner)} ${upperInner}`,
    teeth: {
      y: top - 2,
      height: 3.5 + clamp(pose.teeth, 0, 1) * Math.min(size.maxGap * 0.3, gap * 0.55),
      halfWidth: inner,
    },
    tongue: { cy: bottom + 2 - gap * 0.15 - tongueRaise, rx: inner * 0.62, ry: Math.max(3, size.maxGap * 0.28) },
    jawDrop: gap * 0.45,
  };
}
