'use client';

import { useLocalParticipant, useTrackVolume } from '@livekit/components-react';
import type { LocalAudioTrack } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Strings } from '@/lib/language';
import { type InputMode, RPC_PTT_CANCEL, RPC_PTT_END, RPC_PTT_START } from '@/lib/protocol';

/** Mic level (0–1) from which the input counts as speech rather than room noise. */
export const SPEECH_LEVEL = 0.04;
/** Keep sending audio briefly after release so the last word is not cut off. */
const RELEASE_TAIL_MS = 250;

/** Size of the ring around the mic button for a mic level; 0 below the speech threshold. */
export function ringSize(level: number): number {
  if (!(level > SPEECH_LEVEL)) return 0;
  return Math.round(3 + Math.min(1, (level - SPEECH_LEVEL) * 4) * 9);
}

interface Props {
  mode: InputMode;
  agentIdentity?: string;
  strings: Strings;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
      {muted && <path d="M4 4l16 16" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * Microphone button. Always-on mode: click to mute/unmute. Push-to-talk: hold the button (or Space) while talking.
 * A ring around the button follows the microphone level while speech is picked up.
 */
export function MicButton({ mode, agentIdentity, strings }: Props) {
  const { localParticipant, isMicrophoneEnabled, microphoneTrack } = useLocalParticipant();
  const level = useTrackVolume(microphoneTrack?.track as LocalAudioTrack | undefined);
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);

  const rpc = useCallback(
    (method: string) => {
      if (!agentIdentity) return Promise.resolve('');
      return localParticipant.performRpc({
        destinationIdentity: agentIdentity,
        method,
        payload: '',
        responseTimeout: 30_000,
      });
    },
    [agentIdentity, localParticipant],
  );

  const press = useCallback(() => {
    if (heldRef.current) return;
    heldRef.current = true;
    setHeld(true);
    Promise.all([localParticipant.setMicrophoneEnabled(true), rpc(RPC_PTT_START)]).catch((err) =>
      console.error('push-to-talk start failed', err),
    );
  }, [localParticipant, rpc]);

  const release = useCallback(
    (send: boolean) => {
      if (!heldRef.current) return;
      heldRef.current = false;
      setHeld(false);
      setTimeout(() => {
        localParticipant
          .setMicrophoneEnabled(false)
          .then(() => rpc(send ? RPC_PTT_END : RPC_PTT_CANCEL))
          .catch((err) => console.error('push-to-talk end failed', err));
      }, RELEASE_TAIL_MS);
    },
    [localParticipant, rpc],
  );

  // Push-to-talk: the mic stays off between turns. Always-on: it comes back on when switching modes.
  useEffect(() => {
    if (heldRef.current) return;
    localParticipant.setMicrophoneEnabled(mode === 'always').catch(() => {});
  }, [mode, localParticipant]);

  // Hold Space to talk, unless the user is typing.
  useEffect(() => {
    if (mode !== 'ptt') return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      press();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !heldRef.current) return;
      e.preventDefault();
      release(true);
    };
    const blur = () => release(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      release(false);
    };
  }, [mode, press, release]);

  const live = mode === 'ptt' ? held : isMicrophoneEnabled;
  const ring = live ? ringSize(level) : 0;
  const title = mode === 'ptt' ? (held ? strings.talking : strings.holdToTalk) : isMicrophoneEnabled ? strings.mute : strings.unmute;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={live}
      data-speech={ring > 0 || undefined}
      onClick={mode === 'always' ? () => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled) : undefined}
      onPointerDown={
        mode === 'ptt'
          ? (e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              press();
            }
          : undefined
      }
      onPointerUp={mode === 'ptt' ? () => release(true) : undefined}
      onPointerCancel={mode === 'ptt' ? () => release(false) : undefined}
      onContextMenu={mode === 'ptt' ? (e) => e.preventDefault() : undefined}
      style={{ boxShadow: ring ? `0 0 0 ${ring}px color-mix(in srgb, var(--color-accent) 35%, transparent)` : undefined }}
      className={`grid shrink-0 touch-none select-none place-items-center rounded-full border transition-[box-shadow,background-color,color] duration-100 ${
        mode === 'ptt' ? 'h-9 gap-1.5 px-3' : 'size-9'
      } ${
        live
          ? `border-accent ${held ? 'bg-accent text-bg' : 'text-accent'}`
          : mode === 'ptt'
            ? 'border-border text-muted hover:border-accent hover:text-accent'
            : 'border-danger text-danger'
      }`}
    >
      {mode === 'ptt' ? (
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <MicIcon muted={false} />
          <span className="hidden sm:inline">{held ? strings.talking : strings.pushToTalk}</span>
        </span>
      ) : (
        <MicIcon muted={!isMicrophoneEnabled} />
      )}
    </button>
  );
}
