/**
 * The photo avatar: a photo on a triangle mesh (MediaPipe face landmarks plus a grid around the face), bent per frame
 * by blending displacement fields — jaw, mouth width, smile, blinks, gaze and brows — then turned and swayed with the
 * head. The fields come from `frontend/scripts/photo-avatar/mesh.py`; this module only blends them.
 */
import type { FacePose } from "../cartoon/face";
import type { MouthPose } from "../cartoon/mouth";

export const CONTROLS = [
  "open",
  "width",
  "smile",
  "blinkL",
  "blinkR",
  "gazeXL",
  "gazeYL",
  "gazeXR",
  "gazeYR",
  "browInnerL",
  "browOuterL",
  "browInnerR",
  "browOuterR",
] as const;
export type Control = (typeof CONTROLS)[number];
export type Controls = Record<Control, number>;

export interface PhotoMesh {
  /** Photo size in px; all coordinates are photo px. */
  size: [number, number];
  /** x, y per vertex. */
  vertices: number[];
  /** Three vertex indices per triangle; the mouth opening is left out. */
  triangles: number[];
  /** Inner lip contours, corner to corner; the mouth opening between them is drawn behind the mesh. */
  mouth: { upper: number[]; lower: number[] };
  /** How much each vertex follows the head (1) rather than the shoulders (0). */
  head: number[];
  /** How much each vertex rises when breathing in. */
  breath: number[];
  /** Head rotation centre. */
  pivot: [number, number];
  mouthWidth: number;
  /** The point to keep in view when the photo is cropped to fit (the middle of the face). */
  focus: [number, number];
  /** Per control: vertex index and its displacement at a control value of 1. */
  fields: Record<Control, [number, number, number][]>;
}

/**
 * The cartoon face poses are in cartoon units; these convert them to photo px (or degrees for the tilt) for a face
 * whose mouth is REF_MOUTH px wide, and scale with the mouth width otherwise.
 */
const REF_MOUTH = 146;
const GAZE_PX = 1.6;
const BROW_PX = 1.4;
const HEAD_PX = 2;
const TILT = 0.5;
/** The photo already smiles about as much as the neutral face. */
const REST_SMILE = 0.15;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** The FacePose `lid` rests at 0.1 with the eyes fully open; this maps it to 0 open .. 1 closed. */
export const lidClosure = (lid: number) => clamp((lid - 0.1) / 0.9, 0, 1);

export function photoControls(
  pose: FacePose,
  mouth: MouthPose,
  mouthWidth = REF_MOUTH,
): Controls {
  const k = mouthWidth / REF_MOUTH;
  const blink = lidClosure(pose.lid);
  return {
    open: clamp(mouth.open, 0, 1),
    width: clamp(mouth.width - 1, -0.45, 0.2),
    smile: clamp(mouth.smile - REST_SMILE * (1 - 0.6 * mouth.open), -1, 1),
    blinkL: blink,
    blinkR: blink,
    gazeXL: pose.gazeX * GAZE_PX * k,
    gazeXR: pose.gazeX * GAZE_PX * k,
    gazeYL: pose.gazeY * GAZE_PX * 0.6 * k,
    gazeYR: pose.gazeY * GAZE_PX * 0.6 * k,
    browInnerL: pose.browL.inner * BROW_PX * k,
    browOuterL: pose.browL.outer * BROW_PX * k,
    browInnerR: pose.browR.inner * BROW_PX * k,
    browOuterR: pose.browR.outer * BROW_PX * k,
  };
}

export interface HeadMotion {
  /** Degrees. */
  tilt: number;
  x: number;
  y: number;
  breath: number;
}

export const headMotion = (
  pose: FacePose,
  mouthWidth = REF_MOUTH,
): HeadMotion => {
  const k = mouthWidth / REF_MOUTH;
  return {
    tilt: pose.tilt * TILT,
    x: pose.headX * HEAD_PX * k,
    y: pose.headY * HEAD_PX * k,
    breath: pose.breath * HEAD_PX * k,
  };
};

/** Writes the bent vertex positions into `out` (x, y per vertex). */
export function deform<T extends Float32Array>(
  mesh: PhotoMesh,
  controls: Controls,
  head: HeadMotion,
  out: T,
): T {
  out.set(mesh.vertices);
  for (const name of CONTROLS) {
    const v = controls[name];
    if (v === 0) continue;
    for (const [i, dx, dy] of mesh.fields[name]) {
      out[2 * i] += v * dx;
      out[2 * i + 1] += v * dy;
    }
  }
  const [px, py] = mesh.pivot;
  const a = (head.tilt * Math.PI) / 180;
  for (let i = 0; i < mesh.head.length; i++) {
    const w = mesh.head[i];
    let x = out[2 * i];
    let y = out[2 * i + 1];
    if (w > 0) {
      // Each vertex turns by its share of the angle, so the neck bends rather than tears.
      const c = Math.cos(a * w);
      const s = Math.sin(a * w);
      const rx = x - px;
      const ry = y - py;
      x = px + rx * c - ry * s + w * head.x;
      y = py + rx * s + ry * c + w * head.y;
    }
    out[2 * i] = x;
    out[2 * i + 1] = y - mesh.breath[i] * head.breath;
  }
  return out;
}

/** Strip of triangles across the mouth opening, and how far each vertex is from the upper lip (0) to the lower (1). */
export function mouthStrip(mesh: PhotoMesh): {
  indices: number[];
  side: Map<number, number>;
} {
  const { upper, lower } = mesh.mouth;
  const indices: number[] = [];
  for (let k = 0; k < upper.length - 1; k++) {
    indices.push(
      upper[k],
      lower[k],
      upper[k + 1],
      upper[k + 1],
      lower[k],
      lower[k + 1],
    );
  }
  const side = new Map<number, number>();
  for (const i of upper) side.set(i, 0);
  for (const i of lower) side.set(i, 1);
  side.set(upper[0], 0.5);
  side.set(upper[upper.length - 1], 0.5);
  return { indices, side };
}
