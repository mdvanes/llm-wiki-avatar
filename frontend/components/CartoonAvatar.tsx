'use client';

import type { AgentState } from '@livekit/components-react';
import { useEffect, useId, useRef, useState } from 'react';
import { type MoodEvent, useAvatarDriver } from '@/hooks/useAvatarDriver';
import { LOOKS } from '@/lib/cartoon/character';
import { mouthPose } from '@/lib/cartoon/mouth';
import type { PhotoMesh } from '@/lib/photo/mesh';
import { FEMALE_PHOTO } from '@/lib/photo/female';
import { MALE_PHOTO } from '@/lib/photo/male';
import type { AvatarGender } from '@/lib/presentation';
import type { Lipsync } from '@/lib/protocol';
import type { WordSource } from '@/lib/wordLipsync';
import { CartoonCharacter } from './cartoon/CartoonCharacter';
import { Parts, drawFrame } from './cartoon/draw';
import { PhotoRenderer } from './photo/PhotoRenderer';
import { SpinnerOverlay } from './Spinner';

export type { MoodEvent };

export interface AvatarProps {
  /** Accessible name of the avatar. */
  label: string;
  /** Shown on photo avatars, so nobody takes the person for real. */
  aiLabel: string;
  /** Something is being switched: show `busyLabel` over the avatar. */
  busy?: boolean;
  busyLabel?: string;
  audioTrack?: MediaStreamTrack;
  agentState: AgentState;
  mood?: MoodEvent;
  /** `words`: follow the word timings of the speech, falling back to loudness where there are none. */
  lipsync?: Lipsync;
  /** Word timings of the speech, for the `words` lip-sync. */
  words?: WordSource;
  className?: string;
}

interface Props extends AvatarProps {
  gender: AvatarGender;
}

/** Avatars that are an animated photo; the others are drawn cartoons. */
const PHOTOS: Partial<Record<AvatarGender, { mesh: PhotoMesh; image: string; background?: string }>> = {
  male: { mesh: MALE_PHOTO, image: '/avatars/male.webp', background: '/avatars/male-bg.webp' },
  female: { mesh: FEMALE_PHOTO, image: '/avatars/female.webp', background: '/avatars/female-bg.webp' },
};

/** A 2D cartoon avatar that lip-syncs to the agent's voice and reacts to its mood and state. */
export function CartoonAvatar({
  gender,
  label,
  aiLabel,
  busy = false,
  busyLabel,
  audioTrack,
  agentState,
  mood,
  lipsync = 'audio',
  words,
  className,
}: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Without WebGL the photo avatar falls back to the drawn cartoon.
  const [noWebGL, setNoWebGL] = useState(false);
  const photo = noWebGL ? undefined : PHOTOS[gender];
  const drive = useAvatarDriver({ audioTrack, mood, lipsync, words });
  const live = useRef(agentState);
  live.current = agentState;

  // The animation loop.
  useEffect(() => {
    let renderer: PhotoRenderer | null = null;
    let parts: Parts | null = null;
    if (photo) {
      if (!canvasRef.current) return;
      try {
        renderer = new PhotoRenderer(canvasRef.current, photo.mesh, photo.image, photo.background);
      } catch (err) {
        console.warn('photo avatar unavailable', err);
        setNoWebGL(true);
        return;
      }
    } else {
      if (!svgRef.current) return;
      parts = new Parts(svgRef.current);
    }
    const look = LOOKS[gender];
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(100, now - last);
      last = now;
      const { pose, shape } = drive(now, dt, live.current);
      if (renderer) renderer.draw(pose, mouthPose(shape, pose.smile));
      else if (parts) drawFrame(parts, look, pose, shape);
    });
    return () => {
      cancelAnimationFrame(frame);
      renderer?.dispose();
    };
  }, [gender, photo, drive]);

  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{ background: 'radial-gradient(ellipse at 50% 45%, #34363b 0%, #23252a 45%, #171717 80%)' }}
    >
      {photo ? (
        <canvas key={gender} ref={canvasRef} className="absolute inset-0 h-full w-full" role="img" aria-label={label} />
      ) : (
        <svg
          ref={svgRef}
          key={gender}
          viewBox="40 60 320 340"
          preserveAspectRatio="xMidYMax meet"
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={label}
        >
          <CartoonCharacter gender={gender} uid={uid} />
        </svg>
      )}
      {photo && (
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium leading-tight text-white/90">
          {aiLabel}
        </span>
      )}
      {busy && busyLabel && <SpinnerOverlay label={busyLabel} dim />}
    </div>
  );
}
