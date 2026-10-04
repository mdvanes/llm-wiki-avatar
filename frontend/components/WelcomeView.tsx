'use client';

import { useActiveSttModel } from '@/hooks/useSpeechRecognizer';
import type { Language, Strings } from '@/lib/language';
import type { Presentation } from '@/lib/presentation';
import { ShowHistoryButton } from './HistorySidebar';
import { LanguageSelector } from './LanguageSelector';
import { PresentationSelector } from './PresentationSelector';
import { SettingsLink } from './SettingsLink';

interface Props {
  strings: Strings;
  language: Language;
  onLanguageChange: (language: Language) => void;
  presentation: Presentation;
  onPresentationChange: (presentation: Presentation) => void;
  onStart: () => void;
  connecting: boolean;
  error?: string;
  /** Set when the history sidebar is hidden. */
  onShowHistory?: () => void;
}

export function WelcomeView({
  strings,
  language,
  onLanguageChange,
  presentation,
  onPresentationChange,
  onStart,
  connecting,
  error,
  onShowHistory,
}: Props) {
  const sttModel = useActiveSttModel();
  return (
    <main className="relative grid min-h-full place-items-center p-6">
      {onShowHistory && (
        <div className="absolute left-4 top-3">
          <ShowHistoryButton onClick={onShowHistory} label={strings.showHistory} />
        </div>
      )}
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
          <PresentationSelector
            value={presentation}
            onChange={onPresentationChange}
            strings={strings}
            disabled={connecting}
          />
          <SettingsLink label={strings.speechSettings} />
        </div>
        {!sttModel && <p className="text-sm text-muted">{strings.noSpeechModel}</p>}
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
