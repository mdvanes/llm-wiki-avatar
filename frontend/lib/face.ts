/**
 * Everything on the avatar's face apart from the mouth: brows, eyelids, gaze, head sway and breathing. Mood tags and
 * the agent's state set targets that the face eases toward, and blinks and small eye movements keep it alive.
 * Distances are in px of a 2D face about 150 px wide; `lib/vrm/rig.ts` maps them onto the 3D model.
 */
import type { Mood } from './protocol';

export interface Brow {
  /** Raise of the end near the nose, in px (positive is up). */
  inner: number;
  /** Raise of the end near the ear. */
  outer: number;
}

export interface FacePose {
  /** The brow on the viewer's left and right. */
  browL: Brow;
  browR: Brow;
  /** Upper eyelid: 0 wide open .. 1 closed. */
  lid: number;
  /** Mouth corners, -1..1. */
  smile: number;
  /** Eye direction in px. */
  gazeX: number;
  gazeY: number;
  /** Head roll in degrees and offset in px. */
  tilt: number;
  headX: number;
  headY: number;
  /** Rise of the shoulders while breathing, in px. */
  breath: number;
}

interface Targets {
  browL: Brow;
  browR: Brow;
  lid: number;
  smile: number;
  gazeX: number;
  gazeY: number;
  tilt: number;
}

const MOODS: Record<Mood, Targets> = {
  neutral: { browL: { inner: 0, outer: 0 }, browR: { inner: 0, outer: 0 }, lid: 0.1, smile: 0.15, gazeX: 0, gazeY: 0, tilt: 0 },
  happy: { browL: { inner: 1.5, outer: 2 }, browR: { inner: 1.5, outer: 2 }, lid: 0.25, smile: 0.7, gazeX: 0, gazeY: 0, tilt: 1.5 },
  sad: { browL: { inner: 4, outer: -1.5 }, browR: { inner: 4, outer: -1.5 }, lid: 0.28, smile: -0.45, gazeX: 0, gazeY: 1, tilt: -1 },
  confused: {
    browL: { inner: 3.5, outer: 5 },
    browR: { inner: -1.5, outer: 0 },
    lid: 0.12,
    smile: -0.1,
    gazeX: 0,
    gazeY: 0,
    tilt: -5,
  },
};

/** Mood and agent state combined into the face to ease toward. */
export function faceTargets(mood: Mood, state: string): Targets {
  const t = structuredClone(MOODS[mood]);
  const raise = (by: number) => {
    for (const b of [t.browL, t.browR]) {
      b.inner += by;
      b.outer += by;
    }
  };
  if (state === 'listening') {
    raise(1);
    t.tilt += 2.5;
  } else if (state === 'thinking') {
    t.browL.inner -= 1.5;
    t.browR.inner -= 1.5;
    t.gazeX = 2.5;
    t.gazeY = -2.5;
    t.tilt -= 2;
    t.smile -= 0.1;
  }
  return t;
}

export interface FaceInput {
  /** The LiveKit agent state: `listening`, `thinking`, `speaking`, … */
  state: string;
  /** Loudness of the voice, 0..1; drives nods and brow emphasis while speaking. */
  level: number;
}

export interface FaceAnimatorOptions {
  random?: () => number;
  /** Scales the idle sway; lower it for `prefers-reduced-motion`. */
  motion?: number;
}

const BLINK_MS = 150;
/** A mood tag lasts this long after the agent stops speaking, then the face relaxes to neutral. */
const MOOD_HOLD_MS = 6000;

const ease = (current: number, target: number, dtMs: number, tauMs: number) =>
  current + (target - current) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs));

export class FaceAnimator {
  #random: () => number;
  #motion: number;
  #pose: Targets = structuredClone(MOODS.neutral);
  #nod = 0;
  #emphasis = 0;
  #nextBlink = -1;
  #blinkStart = -Infinity;
  #doubleBlink = false;
  #nextGlance = -1;
  #glance = { x: 0, y: 0 };
  #mood: Mood = 'neutral';
  #moodUntil = 0;

  constructor(opts: FaceAnimatorOptions = {}) {
    this.#random = opts.random ?? Math.random;
    this.#motion = opts.motion ?? 1;
  }

  /** A new mood tag; it shows while the agent speaks, and briefly after. */
  setMood(mood: Mood, now: number): void {
    this.#mood = mood;
    this.#moodUntil = now + MOOD_HOLD_MS;
  }

  update(now: number, dtMs: number, input: FaceInput): FacePose {
    const rand = (lo: number, hi: number) => lo + (hi - lo) * this.#random();
    if (input.state === 'speaking') this.#moodUntil = Math.max(this.#moodUntil, now + MOOD_HOLD_MS);
    const mood = now < this.#moodUntil ? this.#mood : 'neutral';
    const target = faceTargets(mood, input.state);

    // Eyes: blinks every few seconds, sometimes twice, and small glances unless the agent is thinking.
    if (this.#nextBlink < 0) this.#nextBlink = now + rand(1500, 4000);
    if (now >= this.#nextBlink) {
      this.#blinkStart = now;
      this.#doubleBlink = this.#random() < 0.15;
      this.#nextBlink = now + rand(2500, 6000);
    }
    const sinceBlink = now - this.#blinkStart;
    const blinkWindow = this.#doubleBlink ? 2.4 * BLINK_MS : BLINK_MS;
    let blink = 0;
    if (sinceBlink >= 0 && sinceBlink < blinkWindow) {
      const phase = (sinceBlink % (1.4 * BLINK_MS)) / BLINK_MS;
      blink = phase < 1 ? Math.sin(Math.PI * phase) : 0;
    }
    if (this.#nextGlance < 0 || now >= this.#nextGlance) {
      this.#glance = this.#random() < 0.5 ? { x: 0, y: 0 } : { x: rand(-1, 1), y: rand(-0.6, 0.6) };
      this.#nextGlance = now + rand(1200, 3500);
    }
    const glance = input.state === 'thinking' ? { x: 0, y: 0 } : this.#glance;

    const speaking = input.state === 'speaking';
    this.#nod = ease(this.#nod, speaking ? input.level : 0, dtMs, 120);
    this.#emphasis = ease(this.#emphasis, speaking ? Math.max(0, input.level - 0.35) : 0, dtMs, 220);

    const p = this.#pose;
    for (const [brow, to] of [
      [p.browL, target.browL],
      [p.browR, target.browR],
    ] as const) {
      brow.inner = ease(brow.inner, to.inner, dtMs, 180);
      brow.outer = ease(brow.outer, to.outer, dtMs, 180);
    }
    p.lid = ease(p.lid, target.lid, dtMs, 180);
    p.smile = ease(p.smile, target.smile, dtMs, 250);
    p.gazeX = ease(p.gazeX, target.gazeX + glance.x, dtMs, 90);
    p.gazeY = ease(p.gazeY, target.gazeY + glance.y, dtMs, 90);
    p.tilt = ease(p.tilt, target.tilt, dtMs, 450);

    const m = this.#motion;
    const breath = m * 1.2 * Math.sin((2 * Math.PI * now) / 4200);
    const lift = 3 * this.#emphasis;
    return {
      browL: { inner: p.browL.inner + lift, outer: p.browL.outer + lift },
      browR: { inner: p.browR.inner + lift, outer: p.browR.outer + lift },
      lid: Math.min(1, p.lid + (1 - p.lid) * blink),
      smile: p.smile,
      gazeX: p.gazeX,
      gazeY: p.gazeY,
      tilt: p.tilt + m * (1.2 * Math.sin(now * 0.00055) + 0.5 * Math.sin(now * 0.0013 + 1)),
      headX: m * 1.5 * Math.sin(now * 0.0004 + 2),
      headY: breath * 0.5 + 2.5 * this.#nod,
      breath,
    };
  }
}

export const NEUTRAL_FACE: FacePose = {
  ...structuredClone(MOODS.neutral),
  headX: 0,
  headY: 0,
  breath: 0,
};
