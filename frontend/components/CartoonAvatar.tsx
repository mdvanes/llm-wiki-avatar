'use client';

import type { AgentState } from '@livekit/components-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useWordSegments } from '@/hooks/useWordSegments';
import { LOOKS } from '@/lib/cartoon/character';
import { FaceAnimator } from '@/lib/cartoon/face';
import { mouthPose } from '@/lib/cartoon/mouth';
import type { PhotoMesh } from '@/lib/photo/mesh';
import { FEMALE_PHOTO } from '@/lib/photo/female';
import { MALE_PHOTO } from '@/lib/photo/male';
import { LipSync, brightness, rms } from '@/lib/lipsync';
import type { AvatarGender } from '@/lib/presentation';
import type { Lipsync, Mood } from '@/lib/protocol';
import { REST, WordLipSync } from '@/lib/wordLipsync';
import { CartoonCharacter } from './cartoon/CartoonCharacter';
import { Parts, drawFrame } from './cartoon/draw';
import { PhotoRenderer } from './photo/PhotoRenderer';
import { SpinnerOverlay } from './Spinner';

export interface MoodEvent {
  mood: Mood;
  /** Increments per event so the same mood twice still counts as a new event. */
  seq: number;
}

interface Props {
  gender: AvatarGender;
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
  /** The user stopped the voice: close the mouth, even while audio is still draining. */
  silenced?: boolean;
  /** `words`: follow the word timings the agent sends, falling back to loudness where there are none. */
  lipsync?: Lipsync;
  className?: string;
}

/** Avatars that are an animated photo; the others are drawn cartoons. */
const PHOTOS: Partial<Record<AvatarGender, { mesh: PhotoMesh; image: string; background?: string }>> = {
  male: { mesh: MALE_PHOTO, image: '/avatars/male.webp', background: '/avatars/male-bg.webp' },
  female: { mesh: FEMALE_PHOTO, image: '/avatars/female.webp', background: '/avatars/female-bg.webp' },
};

/** Word lip-sync with TalkingHead's English text-to-viseme rules; the module is loaded on first use. */
async function createWordLipSync(): Promise<WordLipSync> {
  const { LipsyncEn } = await import('@met4citizen/talkinghead/modules/lipsync-en.mjs');
  const rules = new LipsyncEn();
  return new WordLipSync((word) => rules.wordsToVisemes(rules.preProcessText(word)));
}

/** Audio analysis chain for the agent's voice; not connected to the speakers (RoomAudioRenderer plays it). */
class VoiceAnalyser {
  readonly ctx = new AudioContext();
  readonly #analyser: AnalyserNode;
  readonly #source: MediaStreamAudioSourceNode;
  readonly #time: Float32Array<ArrayBuffer>;
  readonly #freq: Uint8Array<ArrayBuffer>;

  constructor(track: MediaStreamTrack) {
    this.#source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.#analyser = this.ctx.createAnalyser();
    this.#analyser.fftSize = 1024;
    this.#analyser.smoothingTimeConstant = 0.2;
    this.#source.connect(this.#analyser);
    this.#time = new Float32Array(this.#analyser.fftSize);
    this.#freq = new Uint8Array(this.#analyser.frequencyBinCount);
    void this.ctx.resume().catch(() => {});
  }

  sample(): { level: number; tone: number } {
    this.#analyser.getFloatTimeDomainData(this.#time);
    this.#analyser.getByteFrequencyData(this.#freq);
    return { level: rms(this.#time), tone: brightness(this.#freq, this.ctx.sampleRate) };
  }

  close(): void {
    this.#source.disconnect();
    void this.ctx.close().catch(() => {});
  }
}

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
  silenced = false,
  lipsync = 'audio',
  className,
}: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Without WebGL the photo avatar falls back to the drawn cartoon.
  const [noWebGL, setNoWebGL] = useState(false);
  const photo = noWebGL ? undefined : PHOTOS[gender];
  const analyserRef = useRef<VoiceAnalyser | null>(null);
  const loudness = useRef(new LipSync());
  const words = useRef<WordLipSync | null>(null);
  const face = useRef<FaceAnimator | null>(null);
  const live = useRef({ agentState, silenced, lipsync });
  live.current = { agentState, silenced, lipsync };

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
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const animator = new FaceAnimator({ motion: reducedMotion ? 0.3 : 1 });
    face.current = animator;
    const look = LOOKS[gender];
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(100, now - last);
      last = now;
      const { agentState: state, silenced: quiet, lipsync: mode } = live.current;

      let shape = REST;
      let level = 0;
      const analyser = analyserRef.current;
      if (analyser && !quiet) {
        const sample = analyser.sample();
        // Keep the loudness lip-sync running, so it can take over smoothly where there are no word timings.
        const byLoudness = loudness.current.update(sample.level, sample.tone, dt);
        const byWords = mode === 'words' ? words.current?.update(now, sample.level, dt) : null;
        shape = byWords ?? { ...REST, ...byLoudness };
        level = loudness.current.level;
      }

      const pose = animator.update(now, dt, { state, level });
      if (renderer) renderer.draw(pose, mouthPose(shape, pose.smile));
      else if (parts) drawFrame(parts, look, pose, shape);
    });
    return () => {
      cancelAnimationFrame(frame);
      renderer?.dispose();
      face.current = null;
    };
  }, [gender, photo]);

  // Moods from the agent's [mood:x] tags.
  useEffect(() => {
    if (mood) face.current?.setMood(mood.mood, performance.now());
  }, [mood, gender]);

  // Follow the agent's audio track for lip-sync.
  useEffect(() => {
    if (!audioTrack) return;
    const analyser = new VoiceAnalyser(audioTrack);
    analyserRef.current = analyser;
    return () => {
      analyserRef.current = null;
      loudness.current.reset();
      words.current?.clear();
      analyser.close();
    };
  }, [audioTrack]);

  // Word timings for the premium avatar.
  useEffect(() => {
    if (lipsync !== 'words') {
      words.current?.clear();
      return;
    }
    if (words.current) return;
    let cancelled = false;
    createWordLipSync()
      .then((w) => {
        if (!cancelled) words.current = w;
      })
      .catch((err: unknown) => console.warn('word lip-sync unavailable', err));
    return () => {
      cancelled = true;
    };
  }, [lipsync]);
  useWordSegments((segment) => {
    if (live.current.lipsync === 'words') words.current?.add(segment, performance.now());
  });
  // Segments left over from speech that ended or was interrupted must not play with the next reply.
  const previousState = useRef(agentState);
  useEffect(() => {
    if (previousState.current === 'speaking' && agentState !== 'speaking') words.current?.clear();
    previousState.current = agentState;
  }, [agentState]);

  useEffect(() => {
    if (!silenced) return;
    loudness.current.reset();
    words.current?.clear();
  }, [silenced]);

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
