'use client';

import { useEffect, useRef, useState } from 'react';
import { useAvatarDriver } from '@/hooks/useAvatarDriver';
import { type AvatarProps, CartoonAvatar } from '../CartoonAvatar';
import { SpinnerOverlay } from '../Spinner';
import { VrmRenderer } from './VrmRenderer';

const MODEL_URL = '/avatars/ember.vrm';
const CREDIT_URL = 'https://vtubeme.com';

interface Props extends AvatarProps {
  loadingLabel: string;
  creditLabel: string;
}

/** A 3D VRM avatar (Ember); without WebGL, or when the model fails to load, the female photo avatar instead. */
export function VrmAvatar({ loadingLabel, creditLabel, ...props }: Props) {
  const [failed, setFailed] = useState(false);
  if (failed) return <CartoonAvatar gender="female" {...props} />;
  return (
    <VrmCanvas {...props} loadingLabel={loadingLabel} creditLabel={creditLabel} onFail={() => setFailed(true)} />
  );
}

function VrmCanvas({
  label,
  aiLabel,
  loadingLabel,
  creditLabel,
  busy = false,
  busyLabel,
  audioTrack,
  agentState,
  mood,
  lipsync = 'audio',
  words,
  className,
  onFail,
}: Props & { onFail: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const drive = useAvatarDriver({ audioTrack, mood, lipsync, words });
  const live = useRef({ agentState, onFail });
  live.current = { agentState, onFail };

  useEffect(() => {
    if (!canvasRef.current) return;
    let renderer: VrmRenderer;
    try {
      renderer = new VrmRenderer(canvasRef.current);
    } catch (err) {
      console.warn('VRM avatar unavailable', err);
      live.current.onFail();
      return;
    }
    let cancelled = false;
    renderer.load(MODEL_URL).then(
      () => {
        if (!cancelled) setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        console.warn('VRM avatar unavailable', err);
        live.current.onFail();
      },
    );
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(100, now - last);
      last = now;
      renderer.draw(drive(now, dt, live.current.agentState), dt);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      renderer.dispose();
    };
  }, [drive]);

  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{ background: 'radial-gradient(ellipse at 50% 45%, #34363b 0%, #23252a 45%, #171717 80%)' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" role="img" aria-label={label} />
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium leading-tight text-white/90">
        {aiLabel}
      </span>
      <a
        href={CREDIT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium leading-tight text-white/70 hover:text-white"
      >
        {creditLabel}
      </a>
      {loading && <SpinnerOverlay label={loadingLabel} />}
      {busy && busyLabel && <SpinnerOverlay label={busyLabel} dim />}
    </div>
  );
}
