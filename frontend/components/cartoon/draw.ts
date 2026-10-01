import { type Look, NECK_PIVOT, browPath, facePath, lidPath } from '@/lib/cartoon/character';
import type { FacePose } from '@/lib/cartoon/face';
import { mouthGeometry, mouthPose } from '@/lib/cartoon/mouth';
import type { VisemeShape } from '@/lib/wordLipsync';

/** Sets attributes only when they change, so idle frames touch the DOM as little as possible. */
export class Parts {
  readonly #root: SVGSVGElement;
  readonly #cache = new Map<string, Element | null>();

  constructor(root: SVGSVGElement) {
    this.#root = root;
  }

  set(part: string, attrs: Record<string, string | number>): void {
    let el = this.#cache.get(part);
    if (el === undefined) {
      el = this.#root.querySelector(`[data-part="${part}"]`);
      this.#cache.set(part, el);
    }
    if (!el) return;
    for (const [name, value] of Object.entries(attrs)) {
      const v = typeof value === 'number' ? (Math.round(value * 100) / 100).toString() : value;
      if (el.getAttribute(name) !== v) el.setAttribute(name, v);
    }
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Moves the parts of a CartoonCharacter to a face pose and mouth shape. */
export function drawFrame(parts: Parts, look: Look, pose: FacePose, shape: VisemeShape): void {
  const mouth = mouthGeometry(mouthPose(shape, pose.smile), look.mouth);
  const head = `translate(${r2(pose.headX)} ${r2(pose.headY)}) rotate(${r2(pose.tilt)} ${NECK_PIVOT.x} ${NECK_PIVOT.y})`;
  parts.set('head', { transform: head });
  parts.set('head-back', { transform: head });
  parts.set('body', { transform: `translate(0 ${r2(-pose.breath)})` });
  parts.set('face', { d: facePath(look, mouth.jawDrop) });
  for (const side of ['L', 'R'] as const) {
    const lid = lidPath(side, pose.lid);
    parts.set(`lid-${side}`, { d: lid.lid });
    parts.set(`lid-edge-${side}`, { d: lid.edge });
    parts.set(`iris-${side}`, { transform: `translate(${r2(pose.gazeX)} ${r2(pose.gazeY)})` });
    parts.set(`brow-${side}`, { d: browPath(side, side === 'L' ? pose.browL : pose.browR) });
  }
  parts.set('lips', { d: mouth.lips });
  parts.set('cavity', { d: mouth.cavity });
  parts.set('cavity-clip', { d: mouth.cavity });
  parts.set('line', { d: mouth.line });
  parts.set('teeth', {
    x: -mouth.teeth.halfWidth,
    y: mouth.teeth.y,
    width: 2 * mouth.teeth.halfWidth,
    height: mouth.teeth.height,
  });
  parts.set('tongue', { cy: mouth.tongue.cy, rx: mouth.tongue.rx, ry: mouth.tongue.ry });
}
