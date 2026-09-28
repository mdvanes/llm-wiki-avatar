'use client';

import { RoomAudioRenderer, SessionProvider, StartAudio, useSession } from '@livekit/components-react';
import { TokenSource } from 'livekit-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Language, STRINGS, loadLanguage, saveLanguage } from '@/lib/language';
import { LANGUAGE_ATTRIBUTE } from '@/lib/protocol';
import { SessionView } from './SessionView';
import { WelcomeView } from './WelcomeView';

const tokenSource = TokenSource.endpoint('/api/token');

export function App() {
  const [language, setLanguage] = useState<Language>('en');
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  useEffect(() => setLanguage(loadLanguage()), []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = useCallback((next: Language) => {
    setLanguage(next);
    saveLanguage(next);
  }, []);

  // The token route puts the language on the participant, so the agent starts in the right language.
  const options = useMemo(() => ({ participantAttributes: { [LANGUAGE_ATTRIBUTE]: language } }), [language]);
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
          <SessionView strings={strings} language={language} onLanguageChange={changeLanguage} />
        ) : (
          <WelcomeView
            strings={strings}
            language={language}
            onLanguageChange={changeLanguage}
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
