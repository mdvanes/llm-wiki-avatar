import { describe, expect, it } from "vitest";
import { NEUTRAL_FACE } from "@/lib/cartoon/face";
import { mouthPose } from "@/lib/cartoon/mouth";
import { FEMALE_PHOTO } from "@/lib/photo/female";
import { MALE_PHOTO } from "@/lib/photo/male";
import {
  CONTROLS,
  type PhotoMesh,
  deform,
  headMotion,
  lidClosure,
  mouthStrip,
  photoControls,
} from "@/lib/photo/mesh";
import { REST } from "@/lib/wordLipsync";

const still = { tilt: 0, x: 0, y: 0, breath: 0 };
const at = (pos: Float32Array, i: number) => [pos[2 * i], pos[2 * i + 1]];

describe.each([
  ["male", MALE_PHOTO],
  ["female", FEMALE_PHOTO],
] as [string, PhotoMesh][])("photo mesh (%s)", (_, mesh) => {
  const run = (controls: ReturnType<typeof photoControls>, head = still) =>
    deform(mesh, controls, head, new Float32Array(mesh.vertices.length));

  it("is consistent", () => {
    const n = mesh.vertices.length / 2;
    expect(mesh.head).toHaveLength(n);
    expect(mesh.breath).toHaveLength(n);
    expect(Math.max(...mesh.triangles)).toBeLessThan(n);
    expect(mesh.triangles.length % 3).toBe(0);
    for (const c of CONTROLS) expect(mesh.fields[c].length).toBeGreaterThan(0);
    const [w, h] = mesh.size;
    expect(mesh.focus[0]).toBeGreaterThan(0);
    expect(mesh.focus[0]).toBeLessThan(w);
    expect(mesh.focus[1]).toBeGreaterThan(0);
    expect(mesh.focus[1]).toBeLessThan(h);
    expect(mesh.mouth.upper).toHaveLength(mesh.mouth.lower.length);
  });

  it("leaves the photo untouched in the neutral pose", () => {
    const controls = photoControls(
      NEUTRAL_FACE,
      mouthPose(REST, NEUTRAL_FACE.smile),
    );
    for (const c of CONTROLS) expect(controls[c]).toBeCloseTo(0);
    expect(Array.from(run(controls))).toEqual(
      Array.from(Float32Array.from(mesh.vertices)),
    );
  });

  it("opens the mouth by dropping the lower lip", () => {
    const controls = photoControls(
      NEUTRAL_FACE,
      mouthPose({ ...REST, viseme_aa: 1 }, NEUTRAL_FACE.smile),
      mesh.mouthWidth,
    );
    const pos = run(controls);
    const mid = Math.floor(mesh.mouth.upper.length / 2);
    const gap =
      at(pos, mesh.mouth.lower[mid])[1] - at(pos, mesh.mouth.upper[mid])[1];
    expect(gap).toBeGreaterThan(0.2 * mesh.mouthWidth);
  });

  it("closes the eyes on a blink", () => {
    const controls = photoControls(
      { ...NEUTRAL_FACE, lid: 1 },
      mouthPose(REST),
    );
    expect(lidClosure(1)).toBe(1);
    expect(controls.blinkL).toBe(1);
    const pos = run(controls);
    // Upper lid 159 meets lower lid 145 on the viewer's left eye.
    expect(at(pos, 159)[1]).toBeCloseTo(at(pos, 145)[1], 0);
  });

  it("turns the head about the pivot but keeps the bottom edge still", () => {
    const head = headMotion({ ...NEUTRAL_FACE, tilt: 10, breath: 1 });
    const pos = run(
      photoControls(NEUTRAL_FACE, mouthPose(REST, NEUTRAL_FACE.smile)),
      head,
    );
    const top = mesh.head.indexOf(Math.max(...mesh.head));
    expect(at(pos, top)).not.toEqual([
      mesh.vertices[2 * top],
      mesh.vertices[2 * top + 1],
    ]);
    const [, h] = mesh.size;
    for (let i = 0; i < mesh.head.length; i++) {
      if (mesh.vertices[2 * i + 1] === h) expect(pos[2 * i + 1]).toBeCloseTo(h);
    }
  });

  it("spans the mouth opening with a strip between the lips", () => {
    const { indices, side } = mouthStrip(mesh);
    expect(indices).toHaveLength(6 * (mesh.mouth.upper.length - 1));
    expect(side.get(mesh.mouth.upper[3])).toBe(0);
    expect(side.get(mesh.mouth.lower[3])).toBe(1);
  });
});
