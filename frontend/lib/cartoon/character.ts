/**
 * The two cartoon characters: professionals of about forty. She wears a blazer; he wears an open-collar shirt and
 * light stubble. Coordinates are in a 400×400
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
  /** Grey strands (female) or highlights (male). */
  hairGrey: string;
  brow: string;
  iris: string;
  jacket: string;
  jacketShade: string;
  shirt: string;
  /** Necklace and earrings. */
  accent: string;
  /** Beard stubble colour, if any. */
  stubble?: string;
  /** `chinHalfWidth` sets how square the chin is. */
  face: { halfWidth: number; jawHalfWidth: number; chinHalfWidth: number; chinY: number };
  browWidth: number;
  /** Half the width of the nose at the nostrils. */
  nose: number;
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
    face: { halfWidth: 56, jawHalfWidth: 28, chinHalfWidth: 13, chinY: 246 },
    browWidth: 3.6,
    nose: 9,
    neckHalfWidth: 18,
    mouth: { halfWidth: 16, maxGap: 18, upperLip: 3.6, lowerLip: 5 },
  },
  male: {
    skin: '#f3c9b1',
    skinShade: '#d9a088',
    lips: '#c07f74',
    hair: '#8b6747',
    hairGrey: '#b08a62',
    brow: '#7a5a40',
    iris: '#6b4f33',
    jacket: '#b9c7de',
    jacketShade: '#9daecb',
    shirt: '#c9d5e8',
    accent: '#eef2f8',
    stubble: '#9a7656',
    face: { halfWidth: 61, jawHalfWidth: 45, chinHalfWidth: 24, chinY: 254 },
    browWidth: 4.6,
    nose: 11,
    neckHalfWidth: 26,
    mouth: { halfWidth: 17, maxGap: 18, upperLip: 2.4, lowerLip: 4.4 },
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

/** Mixes two `#rrggbb` colours; `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const ch = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0'))
    .join('')}`;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Outline of the face; the chin and jaw follow `jawDrop`. */
export function facePath(look: Look, jawDrop: number): string {
  const { halfWidth: w, jawHalfWidth: j, chinHalfWidth: c, chinY } = look.face;
  const d = jawDrop;
  const top = 92;
  const cheek = 162;
  const jawY = 230 + d * 0.7;
  const chin = chinY + d;
  return [
    `M ${CX} ${top}`,
    `C ${f(CX + w * 0.68)} ${top} ${CX + w} 122 ${CX + w} ${cheek}`,
    `C ${CX + w} ${f(196 + d * 0.3)} ${CX + j + 14} ${f(220 + d * 0.6)} ${CX + j} ${f(jawY)}`,
    `C ${CX + j - 12} ${f(chin - 4)} ${CX + c} ${f(chin)} ${CX} ${f(chin)}`,
    `C ${CX - c} ${f(chin)} ${CX - j + 12} ${f(chin - 4)} ${CX - j} ${f(jawY)}`,
    `C ${CX - j - 14} ${f(220 + d * 0.6)} ${CX - w} ${f(196 + d * 0.3)} ${CX - w} ${cheek}`,
    `C ${CX - w} 122 ${f(CX - w * 0.68)} ${top} ${CX} ${top}`,
    'Z',
  ].join(' ');
}

/** Stubble on the chin and jaw, following `jawDrop`; the lips are drawn on top of it. */
export function stubblePath(look: Look, jawDrop: number): string {
  const { jawHalfWidth: j, chinHalfWidth: c, chinY } = look.face;
  const d = jawDrop;
  const jawY = 230 + d * 0.7;
  const chin = chinY + d;
  const lip = MOUTH_Y + 7 + d * 1.5;
  return [
    `M ${CX + j} ${f(jawY - 8)}`,
    `L ${CX + j} ${f(jawY)}`,
    `C ${CX + j - 12} ${f(chin - 4)} ${CX + c} ${f(chin)} ${CX} ${f(chin)}`,
    `C ${CX - c} ${f(chin)} ${CX - j + 12} ${f(chin - 4)} ${CX - j} ${f(jawY)}`,
    `L ${CX - j} ${f(jawY - 8)}`,
    `C ${CX - j + 10} ${f(jawY + 2)} ${CX - 22} ${f(lip + 10)} ${CX - 14} ${f(lip)}`,
    `Q ${CX} ${f(lip - 3)} ${CX + 14} ${f(lip)}`,
    `C ${CX + 22} ${f(lip + 10)} ${CX + j - 10} ${f(jawY + 2)} ${CX + j} ${f(jawY - 8)}`,
    'Z',
  ].join(' ');
}

/** A shadow of moustache above the upper lip. */
export function moustachePath(): string {
  const y = MOUTH_Y - 3;
  return `M ${CX - 19} ${y + 2} C ${CX - 14} ${y - 9} ${CX + 14} ${y - 9} ${CX + 19} ${y + 2} Q ${CX} ${y - 3} ${CX - 19} ${y + 2} Z`;
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

/** A brow as a filled shape, thick at the inner end and tapering outwards, along the curve of `browPath`. */
export function browShape(side: 'L' | 'R', brow: Brow, width: number): string {
  const [x0, y0, cx, cy, x1, y1] = (browPath(side, brow).match(/-?\d+(\.\d+)?/g) ?? []).map(Number) as [
    number, number, number, number, number, number,
  ];
  const a = width * 0.62;
  const b = width * 0.5;
  const e = width * 0.16;
  return (
    `M ${f(x0)} ${f(y0 - a)} Q ${f(cx)} ${f(cy - b)} ${f(x1)} ${f(y1 - e)} ` +
    `Q ${f(x1 + (x1 > x0 ? 1 : -1) * e)} ${f(y1)} ${f(x1)} ${f(y1 + e)} ` +
    `Q ${f(cx)} ${f(cy + b)} ${f(x0)} ${f(y0 + a)} Q ${f(x0 - (x1 > x0 ? 1 : -1) * a)} ${f(y0)} ${f(x0)} ${f(y0 - a)} Z`
  );
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
