/**
 * The two cartoon characters: professionals of about forty, in business clothes. Coordinates are in a 400×400
 * view box with the face centred on x = 200.
 */
import type { AvatarGender } from '../presentation';
import type { Brow } from './face';
import type { MouthSize } from './mouth';

export interface Look {
  skin: string;
  skinShade: string;
  lips: string;
  hair: string;
  /** Grey at the temples. */
  hairGrey: string;
  brow: string;
  iris: string;
  jacket: string;
  jacketShade: string;
  shirt: string;
  /** Tie or necklace. */
  accent: string;
  face: { halfWidth: number; jawHalfWidth: number; chinY: number };
  browWidth: number;
  neckHalfWidth: number;
  mouth: MouthSize;
}

export const LOOKS: Record<AvatarGender, Look> = {
  female: {
    skin: '#f1c6a6',
    skinShade: '#d89f7e',
    lips: '#b85a5e',
    hair: '#5a3726',
    hairGrey: '#7a5a48',
    brow: '#4a2d20',
    iris: '#5b7b4c',
    jacket: '#2e4a78',
    jacketShade: '#233a60',
    shirt: '#f4f0e8',
    accent: '#d9b25c',
    face: { halfWidth: 56, jawHalfWidth: 28, chinY: 246 },
    browWidth: 3.6,
    neckHalfWidth: 18,
    mouth: { halfWidth: 16, maxGap: 18, upperLip: 3.6, lowerLip: 5 },
  },
  male: {
    skin: '#deaa86',
    skinShade: '#c08864',
    lips: '#ad6e64',
    hair: '#3a2b22',
    hairGrey: '#9c968f',
    brow: '#33251d',
    iris: '#4a6a8a',
    jacket: '#3b3f47',
    jacketShade: '#2c2f35',
    shirt: '#dce8f6',
    accent: '#7a2e3a',
    face: { halfWidth: 59, jawHalfWidth: 36, chinY: 250 },
    browWidth: 4.6,
    neckHalfWidth: 22,
    mouth: { halfWidth: 17, maxGap: 18, upperLip: 2.6, lowerLip: 4 },
  },
};

export const CX = 200;
export const EYE_Y = 160;
export const EYE_DX = 23;
export const EYE_RX = 11;
export const EYE_RY = 7.5;
export const MOUTH_Y = 216;
/** Head rotation pivot: the base of the skull. */
export const NECK_PIVOT = { x: CX, y: 262 };

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Outline of the face; the chin and jaw follow `jawDrop`. */
export function facePath(look: Look, jawDrop: number): string {
  const { halfWidth: w, jawHalfWidth: j, chinY } = look.face;
  const d = jawDrop;
  const top = 92;
  const cheek = 162;
  const jawY = 230 + d * 0.7;
  const chin = chinY + d;
  return [
    `M ${CX} ${top}`,
    `C ${f(CX + w * 0.68)} ${top} ${CX + w} 122 ${CX + w} ${cheek}`,
    `C ${CX + w} ${f(196 + d * 0.3)} ${CX + j + 14} ${f(220 + d * 0.6)} ${CX + j} ${f(jawY)}`,
    `C ${CX + j - 12} ${f(chin - 4)} ${CX + 13} ${f(chin)} ${CX} ${f(chin)}`,
    `C ${CX - 13} ${f(chin)} ${CX - j + 12} ${f(chin - 4)} ${CX - j} ${f(jawY)}`,
    `C ${CX - j - 14} ${f(220 + d * 0.6)} ${CX - w} ${f(196 + d * 0.3)} ${CX - w} ${cheek}`,
    `C ${CX - w} 122 ${f(CX - w * 0.68)} ${top} ${CX} ${top}`,
    'Z',
  ].join(' ');
}

/** A brow above the eye on the viewer's `side`. */
export function browPath(side: 'L' | 'R', brow: Brow): string {
  const s = side === 'L' ? -1 : 1;
  const cx = CX + s * EYE_DX;
  const innerX = cx - s * 12;
  const outerX = cx + s * 14;
  const innerY = EYE_Y - 15 - brow.inner;
  const outerY = EYE_Y - 13 - brow.outer;
  const archY = Math.min(innerY, outerY) - 4 - Math.max(0, brow.outer - brow.inner) * 0.3;
  return `M ${f(innerX)} ${f(innerY)} Q ${f(cx + s * 2)} ${f(archY)} ${f(outerX)} ${f(outerY)}`;
}

/** Upper eyelid of the eye on the viewer's `side`, lowered by `closure` (0 open .. 1 closed). */
export function lidPath(side: 'L' | 'R', closure: number): { lid: string; edge: string } {
  const cx = CX + (side === 'L' ? -1 : 1) * EYE_DX;
  const c = Math.min(1, Math.max(0, closure));
  const y = EYE_Y - EYE_RY - 1 + c * (2 * EYE_RY + 2);
  const sag = 3 * (1 - c) + 1;
  const left = cx - EYE_RX - 2;
  const right = cx + EYE_RX + 2;
  return {
    lid: `M ${f(left)} ${EYE_Y - 14} L ${f(right)} ${EYE_Y - 14} L ${f(right)} ${f(y)} Q ${f(cx)} ${f(y + 2 * sag)} ${f(left)} ${f(y)} Z`,
    edge: `M ${f(left)} ${f(y)} Q ${f(cx)} ${f(y + 2 * sag)} ${f(right)} ${f(y)}`,
  };
}
