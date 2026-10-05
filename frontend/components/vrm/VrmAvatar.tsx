'use client';

import type { AgentState } from '@livekit/components-react';
import { useEffect, useRef, useState } from 'react';
import { type MoodEvent, useAvatarDriver } from '@/hooks/useAvatarDriver';
import type { AvatarGender } from '@/lib/presentation';
import { VRM_MODELS } from '@/lib/vrm/models';
import type { WordSource } from '@/lib/wordLipsync';
import { SpinnerOverlay } from '../Spinner';
import { VrmRenderer } from './VrmRenderer';

interface Props {
  gender: AvatarGender;
  /** Accessible name of the avatar. */
  label: string;
  loadingLabel: string;
  unavailableLabel: string;
  /** Translation of "by" in "<model> by VTubeMe". */
  madeBy: string;
  /** Something is being switched: show `busyLabel` over the avatar. */
  busy?: boolean;
  busyLabel?: string;
  audioTrack?: MediaStreamTrack;
  agentState: AgentState;
  mood?: MoodEvent;
  /** Word timings of the speech, for the lip-sync. */
  words?: WordSource;
  className?: string;
}

/** A 3D VRM avatar that lip-syncs to the agent's voice and reacts to its mood and state. */
export function VrmAvatar({
  gender,
  label,
  loadingLabel,
  unavailableLabel,
  madeBy,
  busy = false,
  busyLabel,
  audioTrack,
  agentState,
  mood,
  words,
  className,
}: Props) {
  const model = VRM_MODELS[gender];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const drive = useAvatarDriver({ audioTrack, mood, words });
  const live = useRef(agentState);
  live.current = agentState;

  useEffect(() => {
    if (!canvasRef.current) return;
    let renderer: VrmRenderer;
    try {
      renderer = new VrmRenderer(canvasRef.current);
    } catch (err) {
      console.warn('VRM avatar unavailable', err);
      setStatus('failed');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    renderer.load(model.url).then(
      () => {
        if (!cancelled) setStatus('ready');
      },
      (err: unknown) => {
        if (cancelled) return;
        console.warn('VRM avatar unavailable', err);
        setStatus('failed');
      },
    );
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(100, now - last);
      last = now;
      renderer.draw(drive(now, dt, live.current), dt);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      renderer.dispose();
    };
  }, [drive, model.url]);

  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{ background: 'radial-gradient(ellipse at 50% 45%, #34363b 0%, #23252a 45%, #171717 80%)' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" role="img" aria-label={label} />
      {status === 'failed' ? (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/70">
          {unavailableLabel}
        </p>
      ) : (
        <a
          href={model.creditUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium leading-tight text-white/70 hover:text-white"
        >
          {model.name} {madeBy} VTubeMe
        </a>
      )}
      {status === 'loading' && <SpinnerOverlay label={loadingLabel} />}
      {busy && busyLabel && <SpinnerOverlay label={busyLabel} dim />}
    </div>
  );
}
