'use client';

import type { Strings } from '@/lib/language';
import type { InputMode } from '@/lib/protocol';

interface Props {
  value: InputMode;
  onChange: (mode: InputMode) => void;
  disabled?: boolean;
  strings: Strings;
}

export function InputModeSelector({ value, onChange, disabled, strings }: Props) {
  const options: { mode: InputMode; label: string }[] = [
    { mode: 'always', label: strings.alwaysOn },
    { mode: 'ptt', label: strings.pushToTalk },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={strings.micMode}
      className="inline-flex rounded-full border border-border bg-panel p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          role="radio"
          aria-checked={value === o.mode}
          disabled={disabled}
          onClick={() => onChange(o.mode)}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
            value === o.mode ? 'bg-accent text-bg' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
