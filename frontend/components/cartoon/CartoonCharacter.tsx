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
  browPath,
  facePath,
  lidPath,
} from '@/lib/cartoon/character';
import { NEUTRAL_FACE } from '@/lib/cartoon/face';
import { mouthGeometry, mouthPose } from '@/lib/cartoon/mouth';
import { REST } from '@/lib/wordLipsync';

const INK = '#2a1d17';
const SIDES = ['L', 'R'] as const;

/**
 * A flat cartoon character. The parts that move carry `data-part` and are updated by the animation loop in
 * CartoonAvatar; they are drawn here in their resting pose.
 */
export function CartoonCharacter({ gender, uid }: { gender: AvatarGender; uid: string }) {
  const look = LOOKS[gender];
  const face = NEUTRAL_FACE;
  const mouth = mouthGeometry(mouthPose(REST, face.smile), look.mouth);
  const ids = { mouth: `${uid}-mouth`, blush: `${uid}-blush`, eye: (side: string) => `${uid}-eye-${side}` };

  return (
    <>
      <defs>
        {SIDES.map((side) => (
          <clipPath key={side} id={ids.eye(side)}>
            <ellipse cx={eyeX(side)} cy={EYE_Y} rx={EYE_RX} ry={EYE_RY} />
          </clipPath>
        ))}
        <radialGradient id={ids.blush}>
          <stop offset="0%" stopColor="#e8846f" stopOpacity={0.28} />
          <stop offset="100%" stopColor="#e8846f" stopOpacity={0} />
        </radialGradient>
        <clipPath id={ids.mouth}>
          <path data-part="cavity-clip" d={mouth.cavity} />
        </clipPath>
      </defs>

      <g data-part="head-back">{gender === 'female' && <FemaleHairBack look={look} />}</g>

      <g data-part="body">
        <Body gender={gender} look={look} />
      </g>

      <g data-part="head">
        <ellipse cx={CX - look.face.halfWidth - 1} cy={170} rx={8} ry={14} fill={look.skinShade} />
        <ellipse cx={CX + look.face.halfWidth + 1} cy={170} rx={8} ry={14} fill={look.skinShade} />
        <path data-part="face" d={facePath(look, mouth.jawDrop)} fill={look.skin} />
        <circle cx={CX - 30} cy={193} r={12} fill={`url(#${ids.blush})`} />
        <circle cx={CX + 30} cy={193} r={12} fill={`url(#${ids.blush})`} />

        {/* Nose, smile lines and a hint of tiredness under the eyes: a face that has seen a few years. */}
        <g fill="none" stroke={look.skinShade} strokeLinecap="round">
          <path d={`M ${CX - 1} 170 Q ${CX - 5} 186 ${CX - 8} 192 Q ${CX - 3} 197 ${CX + 2} 195`} strokeWidth={2} />
          <path d={`M ${CX - 15} 198 Q ${CX - 21} 208 ${CX - 19} 220`} strokeWidth={1.4} opacity={0.6} />
          <path d={`M ${CX + 15} 198 Q ${CX + 21} 208 ${CX + 19} 220`} strokeWidth={1.4} opacity={0.6} />
          <path d={`M ${eyeX('L') - 8} 171 Q ${eyeX('L')} 175 ${eyeX('L') + 8} 171`} strokeWidth={1} opacity={0.4} />
          <path d={`M ${eyeX('R') - 8} 171 Q ${eyeX('R')} 175 ${eyeX('R') + 8} 171`} strokeWidth={1} opacity={0.4} />
        </g>

        {SIDES.map((side) => {
          const x = eyeX(side);
          const lid = lidPath(side, face.lid);
          return (
            <g key={side}>
              <g clipPath={`url(#${ids.eye(side)})`}>
                <ellipse cx={x} cy={EYE_Y} rx={EYE_RX} ry={EYE_RY} fill="#fbfaf7" />
                <g data-part={`iris-${side}`}>
                  <circle cx={x} cy={EYE_Y} r={5.6} fill={look.iris} />
                  <circle cx={x} cy={EYE_Y} r={2.7} fill="#1b1714" />
                  <circle cx={x + 1.8} cy={EYE_Y - 1.9} r={1.3} fill="#fff" />
                </g>
                <path data-part={`lid-${side}`} d={lid.lid} fill={look.skin} />
                <path data-part={`lid-edge-${side}`} d={lid.edge} fill="none" stroke={INK} strokeWidth={1.8} />
              </g>
              <ellipse cx={x} cy={EYE_Y} rx={EYE_RX} ry={EYE_RY} fill="none" stroke={INK} strokeWidth={0.8} opacity={0.5} />
              <path
                data-part={`brow-${side}`}
                d={browPath(side, side === 'L' ? face.browL : face.browR)}
                fill="none"
                stroke={look.brow}
                strokeWidth={look.browWidth}
                strokeLinecap="round"
              />
            </g>
          );
        })}

        <g transform={`translate(${CX} ${MOUTH_Y})`}>
          <path data-part="lips" d={mouth.lips} fill={look.lips} />
          <path data-part="cavity" d={mouth.cavity} fill="#4a1a1f" />
          <g clipPath={`url(#${ids.mouth})`}>
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

        {gender === 'female' ? <FemaleHairFront look={look} /> : <MaleHair look={look} />}
        {gender === 'male' && <Glasses />}
      </g>
    </>
  );
}

function eyeX(side: 'L' | 'R'): number {
  return CX + (side === 'L' ? -1 : 1) * EYE_DX;
}

function Body({ gender, look }: { gender: AvatarGender; look: Look }) {
  const n = look.neckHalfWidth;
  return (
    <>
      <path d={`M ${CX - n} 230 L ${CX - n} 292 Q ${CX} 304 ${CX + n} 292 L ${CX + n} 230 Z`} fill={look.skin} />
      <path d={`M ${CX - n} 240 Q ${CX} 270 ${CX + n} 240 L ${CX + n} 230 L ${CX - n} 230 Z`} fill={look.skinShade} />
      {/* Clothes are drawn 16 px higher than their coordinates. */}
      <g transform="translate(0 -16)">
      <path d="M 50 416 C 56 338 104 312 160 302 L 240 302 C 296 312 344 338 350 416 Z" fill={look.jacket} />
      {gender === 'female' ? (
        <>
          <path d={`M 170 302 Q ${CX} 346 230 302 Z`} fill={look.shirt} />
          <path d={`M 178 304 Q ${CX} 330 222 304`} fill="none" stroke={look.accent} strokeWidth={1.4} />
          <circle cx={CX} cy={318} r={3} fill={look.accent} />
        </>
      ) : (
        <>
          <path d={`M 170 300 L ${CX} 366 L 230 300 Z`} fill={look.shirt} />
          <path d={`M 195 318 L 205 318 L 209 350 L ${CX} 361 L 191 350 Z`} fill={look.accent} />
          <path d={`M 193 309 L 207 309 L 205 319 L 195 319 Z`} fill={look.accent} />
          <path d={`M 176 296 L ${CX - 2} 316 L 188 330 L 168 306 Z`} fill={look.shirt} stroke="#b9c7d8" strokeWidth={0.8} />
          <path d={`M 224 296 L ${CX + 2} 316 L 212 330 L 232 306 Z`} fill={look.shirt} stroke="#b9c7d8" strokeWidth={0.8} />
        </>
      )}
      {/* Lapels, along the opening of the jacket. */}
      <path
        d={gender === 'female' ? 'M 166 300 Q 182 330 199 352 L 186 352 L 162 336 L 150 310 Z' : 'M 168 299 L 199 366 L 186 352 L 160 340 L 150 312 Z'}
        fill={look.jacketShade}
      />
      <path
        d={gender === 'female' ? 'M 234 300 Q 218 330 201 352 L 214 352 L 238 336 L 250 310 Z' : 'M 232 299 L 201 366 L 214 352 L 240 340 L 250 312 Z'}
        fill={look.jacketShade}
      />
      </g>
    </>
  );
}

function FemaleHairBack({ look }: { look: Look }) {
  return (
    <path
      d="M 200 80 C 138 80 118 126 122 178 C 124 228 116 262 132 292 C 146 300 162 298 172 290 L 228 290 C 238 298 254 300 268 292 C 284 262 276 228 278 178 C 282 126 262 80 200 80 Z"
      fill={look.hair}
    />
  );
}

function FemaleHairFront({ look }: { look: Look }) {
  return (
    <>
      <path
        d="M 142 168 C 136 118 162 86 204 86 C 244 86 266 116 260 172 C 256 150 250 132 238 118 C 220 128 182 128 162 138 C 152 143 145 153 142 168 Z"
        fill={look.hair}
      />
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

function MaleHair({ look }: { look: Look }) {
  return (
    <>
      <path
        d="M 141 164 C 134 112 160 82 202 82 C 244 82 268 110 259 164 C 257 146 254 132 248 124 C 236 110 212 106 190 112 C 170 116 152 128 146 146 C 144 152 142 158 141 164 Z"
        fill={look.hair}
      />
      <path d="M 141 166 C 140 150 142 140 146 132 L 150 146 C 147 152 145 160 145 168 Z" fill={look.hairGrey} />
      <path d="M 259 166 C 260 150 258 140 254 132 L 250 146 C 253 152 255 160 255 168 Z" fill={look.hairGrey} />
      <g fill="none" strokeLinecap="round">
        <path d="M 222 86 C 228 96 231 104 232 112" stroke="#241a14" strokeWidth={1.4} />
        <path d="M 214 90 C 196 92 176 100 160 118" stroke="#55443a" strokeWidth={1.2} opacity={0.8} />
        <path d="M 238 92 C 248 100 254 112 256 128" stroke="#55443a" strokeWidth={1.2} opacity={0.8} />
      </g>
    </>
  );
}

function Glasses() {
  return (
    <g fill="none" stroke="#2b2b2b" strokeWidth={2} strokeLinejoin="round">
      <rect x={CX - EYE_DX - 16} y={150} width={32} height={21} rx={7} />
      <rect x={CX + EYE_DX - 16} y={150} width={32} height={21} rx={7} />
      <path d={`M ${CX - EYE_DX + 16} 158 Q ${CX} 153 ${CX + EYE_DX - 16} 158`} />
      <path d={`M ${CX - EYE_DX - 16} 156 L ${CX - 57} 154`} />
      <path d={`M ${CX + EYE_DX + 16} 156 L ${CX + 57} 154`} />
    </g>
  );
}
