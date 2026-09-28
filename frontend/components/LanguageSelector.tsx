'use client';

import { LANGUAGES, type Language } from '@/lib/language';

interface Props {
  value: Language;
  onChange: (language: Language) => void;
  disabled?: boolean;
  label: string;
}

export function LanguageSelector({ value, onChange, disabled, label }: Props) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-border bg-panel p-0.5">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={value === l.code}
          title={l.label}
          disabled={disabled}
          onClick={() => onChange(l.code)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
            value === l.code ? 'bg-accent text-bg' : 'text-muted hover:text-fg'
          }`}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
