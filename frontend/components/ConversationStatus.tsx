'use client';

import { useEffect, useState } from 'react';
import type { Strings } from '@/lib/language';
import { type Phase, isProcessing } from '@/lib/status';

/** Seconds since the phase started, ticking while the phase lasts. */
function useElapsed(phase: Phase): number {
  const [start, setStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = Date.now();
    setStart(t);
    setNow(t);
    if (!isProcessing(phase)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);
  return Math.floor((now - start) / 1000);
}

export function phaseLabel(phase: Phase, strings: Strings): string {
  switch (phase) {
    case 'hearing':
      return strings.hearing;
    case 'transcribing':
      return strings.transcribing;
    case 'thinking':
      return strings.preparing;
    case 'speaking':
      return strings.speaking;
    case 'listening':
      return strings.listening;
    default:
      return strings.waiting;
  }
}

const TONE: Record<Phase, { text: string; bg: string }> = {
  waiting: { text: 'text-muted', bg: 'bg-panel-2' },
  listening: { text: 'text-muted', bg: 'bg-panel-2' },
  hearing: { text: 'text-accent ring-1 ring-accent/50', bg: 'bg-accent/15' },
  transcribing: { text: 'text-amber-200 ring-1 ring-amber-300/50', bg: 'bg-amber-400/15' },
  thinking: { text: 'text-fg ring-1 ring-fg/40', bg: 'bg-fg/10' },
  speaking: { text: 'text-fg', bg: 'bg-panel-2' },
};

function Indicator({ phase }: { phase: Phase }) {
  if (phase === 'hearing') {
    return (
      <span className="flex h-3 items-end gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-0.5 animate-[soundbar_0.9s_ease-in-out_infinite] rounded-full bg-current"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    );
  }
  if (isProcessing(phase)) {
    return <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
  }
  const dot = phase === 'listening' ? 'bg-accent' : phase === 'speaking' ? 'bg-accent' : 'bg-muted';
  return <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />;
}

interface Props {
  phase: Phase;
  strings: Strings;
  /** `pill` for the header, `banner` for the prominent overlay on the avatar. */
  variant?: 'pill' | 'banner';
}

export function ConversationStatus({ phase, strings, variant = 'pill' }: Props) {
  const elapsed = useElapsed(phase);
  const size =
    variant === 'banner'
      ? 'bg-bg/90 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur'
      : `${TONE[phase].bg} px-2.5 py-0.5 text-xs`;
  return (
    <span
      role="status"
      aria-live="polite"
      data-phase={phase}
      className={`flex items-center gap-2 rounded-full transition-colors ${size} ${TONE[phase].text}`}
    >
      <Indicator phase={phase} />
      <span>{phaseLabel(phase, strings)}</span>
      {isProcessing(phase) && elapsed >= 2 && <span className="tabular-nums opacity-70">{elapsed} s</span>}
    </span>
  );
}
