'use client';

import { useTrackVolume } from '@livekit/components-react';
import { useEffect } from 'react';
import type { PushToTalk } from '@/hooks/usePushToTalk';
import type { Strings } from '@/lib/language';
import { withBase } from '@/lib/basePath';

/** Mic level (0–1) from which the input counts as speech rather than room noise. */
export const SPEECH_LEVEL = 0.04;

/** Size of the ring around the mic button for a mic level; 0 below the speech threshold. */
export function ringSize(level: number): number {
  if (!(level > SPEECH_LEVEL)) return 0;
  return Math.round(3 + Math.min(1, (level - SPEECH_LEVEL) * 4) * 9);
}

interface Props {
  ptt: PushToTalk;
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

/** Hold Space to talk, unless the user is typing. */
function usePushToTalkKey({ press, release }: PushToTalk, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      press();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
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
  }, [enabled, press, release]);
}

/**
 * Push-to-talk button: hold it (or Space) while talking; the speech is transcribed in the browser on release.
 * A ring around the button follows the microphone level. Without a ready speech model it links to the settings.
 */
export function MicButton({ ptt, strings }: Props) {
  const level = useTrackVolume(ptt.track);
  const { status } = ptt;
  const usable = status.kind === 'ready' || status.kind === 'browser';
  usePushToTalkKey(ptt, usable && !ptt.continuous);

  if (!usable) {
    const title =
      status.kind === 'loading'
        ? strings.loadingSpeechModel
        : status.kind === 'error'
          ? strings.speechModelFailed
          : strings.noSpeechModel;
    return (
      <a
        href={withBase('/settings')}
        target="_blank"
        rel="noopener"
        title={title}
        aria-label={title}
        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${
          status.kind === 'error'
            ? 'border-danger text-danger'
            : 'border-border text-muted hover:border-accent hover:text-accent'
        }`}
      >
        <MicIcon muted={status.kind !== 'loading'} />
        {status.kind === 'loading' && <span>{Math.round(status.progress * 100)}%</span>}
      </a>
    );
  }

  if (ptt.continuous) {
    const ring = ptt.listening ? ringSize(level) : 0;
    const label = ptt.error ? strings.micUnavailable : ptt.listening ? strings.listening : strings.micOff;
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={ptt.listening}
        data-speech={ring > 0 || undefined}
        onClick={ptt.toggleListening}
        style={{ boxShadow: ring ? `0 0 0 ${ring}px color-mix(in srgb, var(--color-accent) 35%, transparent)` : undefined }}
        className={`flex h-12 min-w-12 shrink-0 select-none items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-[box-shadow,background-color,color] duration-100 sm:h-9 sm:min-w-0 ${
          ptt.error
            ? 'border-danger text-danger'
            : ptt.listening
              ? 'border-accent bg-accent text-bg'
              : 'border-border text-muted hover:border-accent hover:text-accent'
        }`}
      >
        <MicIcon muted={!ptt.listening} />
        <span className="hidden sm:inline">{ptt.listening ? strings.listening : strings.micOff}</span>
      </button>
    );
  }

  const ring = ptt.held ? ringSize(level) : 0;
  const title = ptt.error ? strings.micUnavailable : ptt.held ? strings.talking : strings.holdToTalk;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={ptt.held}
      data-speech={ring > 0 || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        ptt.press();
      }}
      onPointerUp={() => ptt.release(true)}
      onPointerCancel={() => ptt.release(false)}
      onContextMenu={(e) => e.preventDefault()}
      style={{ boxShadow: ring ? `0 0 0 ${ring}px color-mix(in srgb, var(--color-accent) 35%, transparent)` : undefined }}
      className={`flex h-12 min-w-12 shrink-0 touch-none select-none items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-[box-shadow,background-color,color] duration-100 sm:h-9 sm:min-w-0 ${
        ptt.held
          ? 'border-accent bg-accent text-bg'
          : ptt.error
            ? 'border-danger text-danger'
            : 'border-border text-muted hover:border-accent hover:text-accent'
      }`}
    >
      <MicIcon muted={false} />
      <span className="hidden sm:inline">{ptt.held ? strings.talking : strings.pushToTalk}</span>
    </button>
  );
}
