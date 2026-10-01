import type { AvatarGender } from '@/lib/presentation';
import {
  CX,
  EYE_DX,
  EYE_RX,
  EYE_RY,
  EYE_Y,
  LOOKS,
  type Look,
  MOUTH_Y,
  browShape,
  facePath,
  lidPath,
  mix,
  moustachePath,
  stubblePath,
} from '@/lib/cartoon/character';
import { NEUTRAL_FACE } from '@/lib/cartoon/face';
import { mouthGeometry, mouthPose } from '@/lib/cartoon/mouth';
import { REST } from '@/lib/wordLipsync';

const INK = '#2a1d17';
const SIDES = ['L', 'R'] as const;

const FEMALE_FRINGE =
  'M 142 168 C 136 118 162 86 204 86 C 244 86 266 116 260 172 C 256 150 250 132 238 118 C 220 128 182 128 162 138 C 152 143 145 153 142 168 Z';
const MALE_HAIR =
  'M 140 158 C 134 128 138 100 156 86 C 172 72 196 66 216 68 C 246 70 266 90 266 122 C 266 138 264 150 260 160 L 256 162 C 255 150 253 140 250 132 C 244 118 232 110 216 108 C 198 106 182 108 170 114 C 158 120 150 132 147 146 C 145 151 144 156 144 161 Z';
const MALE_HAIRLINE = 'M 250 132 C 244 118 232 110 216 108 C 198 106 182 108 170 114 C 158 120 150 132 147 146';

/**
 * A flat-shaded vector character, lit from the upper left. The parts that move carry `data-part` and are updated
 * by the animation loop in CartoonAvatar; they are drawn here in their resting pose.
 */
export function CartoonCharacter({ gender, uid }: { gender: AvatarGender; uid: string }) {
  const look = LOOKS[gender];
  const face = NEUTRAL_FACE;
  const mouth = mouthGeometry(mouthPose(REST, face.smile), look.mouth);
  const url = (name: string) => `url(#${uid}-${name})`;
  const shade = look.skinShade;
  const deep = mix(look.skinShade, '#5a2a22', 0.35);

  return (
    <>
      <Defs look={look} uid={uid} mouthCavity={mouth.cavity} faceD={facePath(look, mouth.jawDrop)} />

      <g data-part="head-back">{gender === 'female' && <FemaleHairBack look={look} />}</g>

      <g data-part="body">
        <Body gender={gender} look={look} uid={uid} />
      </g>

      <g data-part="head">
        {gender === 'male' && (
          <path
            d="M 139 166 C 128 120 150 70 204 66 C 258 64 276 116 262 166 Z"
            fill={mix(look.hair, '#000000', 0.22)}
          />
        )}
        {SIDES.map((side) => {
          const s = side === 'L' ? -1 : 1;
          const ex = CX + s * (look.face.halfWidth + 1);
          return (
            <g key={side}>
              <ellipse cx={ex} cy={171} rx={8.5} ry={14} fill={mix(look.skin, shade, side === 'L' ? 0.25 : 0.5)} />
              <path
                d={`M ${ex - s * 1} 161 C ${ex + s * 5} 163 ${ex + s * 5} 177 ${ex - s * 1} 182`}
                fill="none"
                stroke={deep}
                strokeWidth={1.6}
                strokeLinecap="round"
                opacity={0.55}
              />
            </g>
          );
        })}
        <path data-part="face" d={facePath(look, mouth.jawDrop)} fill={look.skin} />

        {/* Shading, clipped to the face so the chin can move. */}
        <g clipPath={url('face')}>
          <rect x={120} y={80} width={160} height={200} fill={url('light')} />
          <ellipse cx={CX + 38} cy={208} rx={14} ry={24} fill={url('soft')} />
          <ellipse cx={CX - 38} cy={208} rx={11} ry={21} fill={url('soft')} opacity={0.6} />
          {SIDES.map((side) => (
            <ellipse key={side} cx={eyeX(side)} cy={EYE_Y - 4} rx={18} ry={11} fill={url('soft')} opacity={0.7} />
          ))}
          <g fill={shade}>
            <path d={gender === 'male' ? MALE_HAIR : FEMALE_FRINGE} transform="translate(0 3)" opacity={0.35} />
            <path d={gender === 'male' ? MALE_HAIR : FEMALE_FRINGE} transform="translate(1.5 7)" opacity={0.2} />
          </g>
          {look.stubble && (
            <g filter={url('stubble')}>
              <path data-part="stubble" d={stubblePath(look, mouth.jawDrop)} fill={look.stubble} />
              <path d={moustachePath()} fill={look.stubble} opacity={0.8} />
            </g>
          )}
        </g>
        <circle cx={CX - 31} cy={196} r={15} fill={url('blush')} />
        <circle cx={CX + 31} cy={196} r={15} fill={url('blush')} />

        <Nose look={look} uid={uid} />

        {/* Smile lines and a hint of tiredness under the eyes: a face that has seen a few years. */}
        <g fill="none" stroke={shade} strokeLinecap="round">
          <path d={`M ${CX - 15} 199 Q ${CX - 22} 208 ${CX - 20} 221`} strokeWidth={1.5} opacity={0.45} />
          <path d={`M ${CX + 15} 199 Q ${CX + 22} 208 ${CX + 20} 221`} strokeWidth={1.5} opacity={0.6} />
          <path d={`M ${eyeX('L') - 8} 172 Q ${eyeX('L')} 176 ${eyeX('L') + 8} 172`} strokeWidth={1} opacity={0.4} />
          <path d={`M ${eyeX('R') - 8} 172 Q ${eyeX('R')} 176 ${eyeX('R') + 8} 172`} strokeWidth={1} opacity={0.4} />
        </g>

        {SIDES.map((side) => {
          const x = eyeX(side);
          const s = side === 'L' ? -1 : 1;
          const lid = lidPath(side, face.lid);
          return (
            <g key={side}>
              <path
                d={`M ${x - 11} ${EYE_Y - 9} Q ${x + 1} ${EYE_Y - 14.5} ${x + 12} ${EYE_Y - 8.5}`}
                fill="none"
                stroke={shade}
                strokeWidth={1.3}
                strokeLinecap="round"
              />
              <g clipPath={url(`eye-${side}`)}>
                <ellipse cx={x} cy={EYE_Y} rx={EYE_RX} ry={EYE_RY} fill={url('sclera')} />
                <g data-part={`iris-${side}`}>
                  <circle cx={x} cy={EYE_Y} r={5.8} fill={url('iris')} />
                  <circle cx={x} cy={EYE_Y} r={2.6} fill="#120e0c" />
                  <circle cx={x + 1.9} cy={EYE_Y - 2} r={1.4} fill="#fff" />
                  <circle cx={x - 1.7} cy={EYE_Y + 1.9} r={0.6} fill="#fff" opacity={0.7} />
                </g>
                <path data-part={`lid-${side}`} d={lid.lid} fill={mix(look.skin, shade, 0.3)} />
                <path
                  data-part={`lid-shadow-${side}`}
                  d={lid.edge}
                  fill="none"
                  stroke="#000"
                  strokeWidth={3}
                  opacity={0.12}
                  transform="translate(0 1.8)"
                />
                <path data-part={`lid-edge-${side}`} d={lid.edge} fill="none" stroke={INK} strokeWidth={2.2} />
              </g>
              <ellipse cx={x} cy={EYE_Y} rx={EYE_RX} ry={EYE_RY} fill="none" stroke={INK} strokeWidth={0.7} opacity={0.3} />
              <path
                d={`M ${x - EYE_RX + 1.5} ${EYE_Y + 1.5} Q ${x} ${EYE_Y + EYE_RY + 2.5} ${x + EYE_RX - 1} ${EYE_Y + 1}`}
                fill="none"
                stroke={deep}
                strokeWidth={0.9}
                opacity={0.5}
              />
              {gender === 'female' && (
                <path
                  d={`M ${x + s * (EYE_RX - 0.5)} ${EYE_Y - 1.5} L ${x + s * (EYE_RX + 2)} ${EYE_Y - 3.5}`}
                  stroke={INK}
                  strokeWidth={1.3}
                  strokeLinecap="round"
                />
              )}
              <path
                data-part={`brow-${side}`}
                d={browShape(side, side === 'L' ? face.browL : face.browR, look.browWidth)}
                fill={look.brow}
              />
            </g>
          );
        })}

        <g transform={`translate(${CX} ${MOUTH_Y})`}>
          <path data-part="lips" d={mouth.lips} fill={url('lips')} />
          <path data-part="cavity" d={mouth.cavity} fill="#4a1a1f" />
          <g clipPath={url('mouth')}>
            <ellipse
              data-part="tongue"
              cx={0}
              cy={mouth.tongue.cy}
              rx={mouth.tongue.rx}
              ry={mouth.tongue.ry}
              fill="#c9666b"
            />
            <rect
              data-part="teeth"
              x={-mouth.teeth.halfWidth}
              y={mouth.teeth.y}
              width={2 * mouth.teeth.halfWidth}
              height={mouth.teeth.height}
              fill="#fbf8f2"
            />
          </g>
          <path data-part="line" d={mouth.line} fill="none" stroke="#5a2328" strokeWidth={1.4} strokeLinecap="round" />
        </g>

        {gender === 'female' ? <FemaleHairFront look={look} uid={uid} /> : <MaleHair look={look} uid={uid} />}
      </g>
    </>
  );
}

function Defs({ look, uid, mouthCavity, faceD }: { look: Look; uid: string; mouthCavity: string; faceD: string }) {
  const id = (name: string) => `${uid}-${name}`;
  const shade = look.skinShade;
  return (
    <defs>
      {SIDES.map((side) => (
        <clipPath key={side} id={id(`eye-${side}`)}>
          <ellipse cx={eyeX(side)} cy={EYE_Y} rx={EYE_RX} ry={EYE_RY} />
        </clipPath>
      ))}
      <clipPath id={id('face')}>
        <path data-part="face-clip" d={faceD} />
      </clipPath>
      <clipPath id={id('mouth')}>
        <path data-part="cavity-clip" d={mouthCavity} />
      </clipPath>
      {/* Light from the upper left: a soft highlight, darkening towards the far edges. */}
      <radialGradient id={id('light')} gradientUnits="userSpaceOnUse" cx={186} cy={150} r={96} fx={178} fy={140}>
        <stop offset="0%" stopColor="#ffffff" stopOpacity={0.22} />
        <stop offset="45%" stopColor="#ffffff" stopOpacity={0} />
        <stop offset="72%" stopColor={shade} stopOpacity={0} />
        <stop offset="100%" stopColor={shade} stopOpacity={0.85} />
      </radialGradient>
      <radialGradient id={id('soft')}>
        <stop offset="0%" stopColor={shade} stopOpacity={0.5} />
        <stop offset="100%" stopColor={shade} stopOpacity={0} />
      </radialGradient>
      <radialGradient id={id('blush')}>
        <stop offset="0%" stopColor="#e8846f" stopOpacity={0.26} />
        <stop offset="100%" stopColor="#e8846f" stopOpacity={0} />
      </radialGradient>
      <radialGradient id={id('sclera')}>
        <stop offset="0%" stopColor="#fdfcfa" />
        <stop offset="70%" stopColor="#f5f0eb" />
        <stop offset="100%" stopColor="#ddd0c5" />
      </radialGradient>
      <radialGradient id={id('iris')}>
        <stop offset="0%" stopColor={mix(look.iris, '#000000', 0.25)} />
        <stop offset="45%" stopColor={mix(look.iris, '#ffffff', 0.22)} />
        <stop offset="82%" stopColor={look.iris} />
        <stop offset="100%" stopColor={mix(look.iris, '#000000', 0.5)} />
      </radialGradient>
      <linearGradient id={id('lips')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={mix(look.lips, '#000000', 0.2)} />
        <stop offset="46%" stopColor={mix(look.lips, '#000000', 0.1)} />
        <stop offset="54%" stopColor={look.lips} />
        <stop offset="100%" stopColor={mix(look.lips, '#ffffff', 0.18)} />
      </linearGradient>
      <linearGradient id={id('hair')} x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stopColor={mix(look.hair, '#ffffff', 0.12)} />
        <stop offset="55%" stopColor={look.hair} />
        <stop offset="100%" stopColor={mix(look.hair, '#000000', 0.25)} />
      </linearGradient>
      <radialGradient id={id('sheen')}>
        <stop offset="0%" stopColor="#ffffff" stopOpacity={0.2} />
        <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
      </radialGradient>
      <linearGradient id={id('neck')} gradientUnits="userSpaceOnUse" x1="0" y1="232" x2="0" y2="300">
        <stop offset="0%" stopColor={mix(shade, '#000000', 0.08)} />
        <stop offset="35%" stopColor={shade} />
        <stop offset="60%" stopColor={look.skin} />
      </linearGradient>
      <linearGradient id={id('neck-side')} gradientUnits="userSpaceOnUse" x1={CX - look.neckHalfWidth} y1="0" x2={CX + look.neckHalfWidth} y2="0">
        <stop offset="60%" stopColor={shade} stopOpacity={0} />
        <stop offset="100%" stopColor={shade} stopOpacity={0.6} />
      </linearGradient>
      <linearGradient id={id('cloth')} gradientUnits="userSpaceOnUse" x1="60" y1="0" x2="340" y2="0">
        <stop offset="0%" stopColor={mix(look.jacket, '#ffffff', 0.12)} />
        <stop offset="50%" stopColor={look.jacket} />
        <stop offset="100%" stopColor={look.jacketShade} />
      </linearGradient>
      {look.stubble && (
        // Soft edges and a fine grain, so the stubble reads as hair rather than a patch.
        <filter id={id('stubble')} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={2.2} result="soft" />
          <feTurbulence type="fractalNoise" baseFrequency={1.3} numOctaves={1} seed={4} result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.6 0 0 0 -0.95" result="grain" />
          <feComposite in="soft" in2="grain" operator="in" result="grainy" />
          <feComposite in="soft" in2="grainy" operator="arithmetic" k1={0} k2={0.3} k3={0.75} k4={0} />
        </filter>
      )}
    </defs>
  );
}

function Nose({ look, uid }: { look: Look; uid: string }) {
  const w = look.nose;
  const shade = look.skinShade;
  const deep = mix(shade, '#5a2a22', 0.45);
  return (
    <g>
      <ellipse cx={CX + 7} cy={180} rx={4.5} ry={15} fill={`url(#${uid}-soft)`} />
      <ellipse cx={CX + 1} cy={197} rx={w + 1} ry={4.5} fill={`url(#${uid}-soft)`} />
      <g fill="none" stroke={shade} strokeLinecap="round" strokeWidth={1.7}>
        <path d={`M ${CX - w + 1} 186 C ${CX - w - 4} 190 ${CX - w - 3} 197 ${CX - w + 3} 198`} opacity={0.75} />
        <path d={`M ${CX + w - 1} 186 C ${CX + w + 4} 190 ${CX + w + 3} 197 ${CX + w - 3} 198`} />
      </g>
      <ellipse cx={CX - 5} cy={197} rx={2.7} ry={1.3} transform={`rotate(-14 ${CX - 5} 197)`} fill={deep} opacity={0.7} />
      <ellipse cx={CX + 5} cy={197} rx={2.7} ry={1.3} transform={`rotate(14 ${CX + 5} 197)`} fill={deep} opacity={0.7} />
      <path d={`M ${CX - 4} 199.5 Q ${CX} 201.5 ${CX + 4} 199.5`} fill="none" stroke={shade} strokeWidth={1.2} opacity={0.6} />
      <ellipse cx={CX - 1} cy={189} rx={3.6} ry={2.6} fill="#ffffff" opacity={0.3} />
      <path d={`M ${CX - 2} 165 L ${CX - 2.5} 183`} stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" opacity={0.18} />
    </g>
  );
}

function eyeX(side: 'L' | 'R'): number {
  return CX + (side === 'L' ? -1 : 1) * EYE_DX;
}

function Body({ gender, look, uid }: { gender: AvatarGender; look: Look; uid: string }) {
  const n = look.neckHalfWidth;
  const neck = `M ${CX - n} 230 L ${CX - n} 292 Q ${CX} 304 ${CX + n} 292 L ${CX + n} 230 Z`;
  return (
    <>
      <path d={neck} fill={`url(#${uid}-neck)`} />
      <path d={neck} fill={`url(#${uid}-neck-side)`} />
      {/* Clothes are drawn 16 px higher than their coordinates. */}
      <g transform="translate(0 -16)">
        <path d="M 50 416 C 56 338 104 312 160 302 L 240 302 C 296 312 344 338 350 416 Z" fill={`url(#${uid}-cloth)`} />
        {gender === 'female' ? (
          <>
            <path d={`M 170 302 Q ${CX} 346 230 302 Z`} fill={look.shirt} />
            <path d={`M 178 304 Q ${CX} 330 222 304`} fill="none" stroke={look.accent} strokeWidth={1.4} />
            <circle cx={CX} cy={318} r={3} fill={look.accent} />
            {/* Lapels, along the opening of the blazer. */}
            <path d="M 166 300 Q 182 330 199 352 L 186 352 L 162 336 L 150 310 Z" fill={look.jacketShade} />
            <path d="M 234 300 Q 218 330 201 352 L 214 352 L 238 336 L 250 310 Z" fill={look.jacketShade} />
          </>
        ) : (
          <MaleShirt look={look} />
        )}
      </g>
    </>
  );
}

const COLLAR_L = `M 176 290 C 168 300 162 316 158 336 L 184 330 L ${CX - 1} 348 L 178 298 Z`;
const COLLAR_R = `M 224 290 C 232 300 238 316 242 336 L 216 330 L ${CX + 1} 348 L 222 298 Z`;

/** An open-collar shirt: the torso is `look.jacket`, the collar `look.shirt`. */
function MaleShirt({ look }: { look: Look }) {
  const fold = look.jacketShade;
  return (
    <>
      <path d={`M 174 298 L ${CX} 346 L 226 298 Z`} fill={look.skin} />
      {/* Folds and seams. */}
      <g fill={fold} opacity={0.7}>
        <path d="M 92 356 C 106 374 114 394 118 416 L 111 416 C 108 396 100 376 88 362 Z" />
        <path d="M 308 356 C 294 374 286 394 282 416 L 289 416 C 292 396 300 376 312 362 Z" />
        <path d="M 150 360 C 158 378 162 396 162 416 L 158 416 C 156 398 152 380 146 366 Z" opacity={0.5} />
        <path d="M 252 362 C 244 380 240 398 240 416 L 245 416 C 246 398 250 380 256 366 Z" opacity={0.7} />
      </g>
      <g fill="none" stroke={fold} strokeLinecap="round">
        <path d={`M ${CX} 346 L ${CX} 416`} strokeWidth={1.4} />
        <path d={`M ${CX + 7} 352 L ${CX + 7} 416`} strokeWidth={1} opacity={0.7} />
        <path d="M 112 330 C 104 340 96 350 90 360" strokeWidth={1} opacity={0.5} />
        <path d="M 288 330 C 296 340 304 350 310 360" strokeWidth={1} opacity={0.5} />
      </g>
      <circle cx={CX + 3.5} cy={384} r={2.4} fill={look.accent} stroke={fold} strokeWidth={0.6} />
      {/* Collar: the band behind the neck, its shadow, and two open points. */}
      <path d="M 172 296 C 182 286 218 286 228 296 L 224 300 C 214 292 186 292 176 300 Z" fill={mix(look.shirt, fold, 0.6)} />
      <g fill={mix(fold, '#000000', 0.25)} opacity={0.35}>
        <path d={COLLAR_L} transform="translate(2.5 3.5)" />
        <path d={COLLAR_R} transform="translate(-1 4)" />
      </g>
      <path d={COLLAR_L} fill={look.shirt} stroke={fold} strokeWidth={1} strokeLinejoin="round" />
      <path d={COLLAR_R} fill={mix(look.shirt, fold, 0.3)} stroke={fold} strokeWidth={1} strokeLinejoin="round" />
    </>
  );
}

function FemaleHairBack({ look }: { look: Look }) {
  return (
    <path
      d="M 200 80 C 138 80 118 126 122 178 C 124 228 116 262 132 292 C 146 300 162 298 172 290 L 228 290 C 238 298 254 300 268 292 C 284 262 276 228 278 178 C 282 126 262 80 200 80 Z"
      fill={mix(look.hair, '#000000', 0.12)}
    />
  );
}

function FemaleHairFront({ look, uid }: { look: Look; uid: string }) {
  return (
    <>
      <path d={FEMALE_FRINGE} fill={`url(#${uid}-hair)`} />
      <path d="M 143 158 C 138 200 142 236 156 270 C 161 272 165 269 162 262 C 150 230 148 200 151 168 Z" fill={look.hair} />
      <path d="M 257 158 C 262 200 258 236 244 270 C 239 272 235 269 238 262 C 250 230 252 200 249 168 Z" fill={look.hair} />
      <g fill="none" stroke={look.hairGrey} strokeWidth={1.2} strokeLinecap="round" opacity={0.7}>
        <path d="M 214 92 C 234 98 248 112 254 140" />
        <path d="M 196 96 C 178 104 160 118 150 140" />
      </g>
      <circle cx={CX - look.face.halfWidth + 1} cy={188} r={2.4} fill={look.accent} />
      <circle cx={CX + look.face.halfWidth - 1} cy={188} r={2.4} fill={look.accent} />
    </>
  );
}

function MaleHair({ look, uid }: { look: Look; uid: string }) {
  const dark = mix(look.hair, '#000000', 0.32);
  const light = look.hairGrey;
  return (
    <>
      {/* Short back and sides, longer on top, swept to the right from a part on the left. */}
      <path d={MALE_HAIR} fill={`url(#${uid}-hair)`} />
      <path d={MALE_HAIRLINE} fill="none" stroke={dark} strokeWidth={2.4} strokeLinecap="round" opacity={0.45} />
      <g fill={dark} opacity={0.7}>
        <path d="M 164 112 C 168 98 176 86 190 75 C 181 88 173 100 168 114 Z" />
        <path d="M 232 110 C 246 113 256 124 260 142 C 253 127 244 118 232 110 Z" />
        <path d="M 142 156 C 139 136 142 118 150 104 C 146 120 145 138 146 158 Z" />
      </g>
      <ellipse cx={196} cy={84} rx={40} ry={14} transform="rotate(-8 196 84)" fill={`url(#${uid}-sheen)`} />
      <g fill="none" stroke={light} strokeLinecap="round">
        <path d="M 164 106 C 184 86 214 78 244 90" strokeWidth={1.8} opacity={0.8} />
        <path d="M 172 102 C 194 84 222 80 250 96" strokeWidth={1.2} opacity={0.65} />
        <path d="M 182 100 C 206 88 234 90 256 108" strokeWidth={1.5} opacity={0.6} />
        <path d="M 176 92 C 192 78 212 72 232 74" strokeWidth={1.2} opacity={0.55} />
        <path d="M 206 80 C 228 78 248 88 260 106" strokeWidth={1.6} opacity={0.6} />
        <path d="M 194 96 C 216 88 240 94 254 112" strokeWidth={1} opacity={0.5} />
        <path d="M 154 120 C 158 106 164 96 172 88" strokeWidth={1} opacity={0.45} />
      </g>
      <g fill="none" stroke={dark} strokeLinecap="round" opacity={0.55}>
        <path d="M 168 104 C 190 90 220 86 246 98" strokeWidth={1} />
        <path d="M 188 96 C 212 86 238 90 258 116" strokeWidth={1} />
      </g>
    </>
  );
}
