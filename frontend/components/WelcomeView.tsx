'use client';

import type { Language, Strings } from '@/lib/language';
import type { InputMode } from '@/lib/protocol';
import { InputModeSelector } from './InputModeSelector';
import { LanguageSelector } from './LanguageSelector';

interface Props {
  strings: Strings;
  language: Language;
  onLanguageChange: (language: Language) => void;
  inputMode: InputMode;
  onInputModeChange: (mode: InputMode) => void;
  onStart: () => void;
  connecting: boolean;
  error?: string;
}

export function WelcomeView({
  strings,
  language,
  onLanguageChange,
  inputMode,
  onInputModeChange,
  onStart,
  connecting,
  error,
}: Props) {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <div className="grid size-20 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-4xl">
          📚
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{strings.title}</h1>
          <p className="mt-2 text-muted">{strings.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <LanguageSelector value={language} onChange={onLanguageChange} label={strings.language} disabled={connecting} />
          <InputModeSelector value={inputMode} onChange={onInputModeChange} strings={strings} disabled={connecting} />
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={connecting}
          className="rounded-full bg-accent px-6 py-2.5 font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {connecting ? strings.connecting : strings.start}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </main>
  );
}
