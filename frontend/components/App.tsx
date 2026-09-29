'use client';

import { RoomAudioRenderer, SessionProvider, StartAudio, useSession } from '@livekit/components-react';
import { TokenSource } from 'livekit-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Language,
  STRINGS,
  loadInputMode,
  loadLanguage,
  saveInputMode,
  saveLanguage,
} from '@/lib/language';
import type { AvatarConfig } from '@/lib/server-config';
import { INPUT_MODE_ATTRIBUTE, type InputMode, LANGUAGE_ATTRIBUTE } from '@/lib/protocol';
import { SessionView } from './SessionView';
import { WelcomeView } from './WelcomeView';

const tokenSource = TokenSource.endpoint('/api/token');

export function App({ avatar }: { avatar: AvatarConfig }) {
  const [language, setLanguage] = useState<Language>('en');
  const [inputMode, setInputMode] = useState<InputMode>('always');
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    setLanguage(loadLanguage());
    setInputMode(loadInputMode());
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = useCallback((next: Language) => {
    setLanguage(next);
    saveLanguage(next);
  }, []);

  const changeInputMode = useCallback((next: InputMode) => {
    setInputMode(next);
    saveInputMode(next);
  }, []);

  // The token route puts these on the participant, so the agent starts in the right language and mic mode.
  const options = useMemo(
    () => ({ participantAttributes: { [LANGUAGE_ATTRIBUTE]: language, [INPUT_MODE_ATTRIBUTE]: inputMode } }),
    [language, inputMode],
  );
  const session = useSession(tokenSource, options);
  const strings = STRINGS[language];

  const start = async () => {
    setError(undefined);
    setStarting(true);
    try {
      await session.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const connecting = starting || session.connectionState === 'connecting';

  return (
    <SessionProvider session={session}>
      <div className="h-full">
        {session.isConnected ? (
          <SessionView
            avatar={avatar}
            strings={strings}
            language={language}
            onLanguageChange={changeLanguage}
            inputMode={inputMode}
            onInputModeChange={changeInputMode}
          />
        ) : (
          <WelcomeView
            strings={strings}
            language={language}
            onLanguageChange={changeLanguage}
            inputMode={inputMode}
            onInputModeChange={changeInputMode}
            onStart={start}
            connecting={connecting}
            error={error}
          />
        )}
        <RoomAudioRenderer />
        <StartAudio
          label="🔊 Click to enable audio"
          className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg"
        />
      </div>
    </SessionProvider>
  );
}
