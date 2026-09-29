'use client';

import { RoomAudioRenderer, SessionProvider, StartAudio, useSession } from '@livekit/components-react';
import { TokenSource } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Conversation, clearHistory, deleteConversation, loadHistory, saveConversation } from '@/lib/history';
import { type Language, STRINGS, loadInputMode, loadLanguage, saveInputMode, saveLanguage } from '@/lib/language';
import { type Presentation, loadPresentation, savePresentation, voiceOf } from '@/lib/presentation';
import type { AvatarSettings } from '@/lib/server-config';
import { INPUT_MODE_ATTRIBUTE, type InputMode, LANGUAGE_ATTRIBUTE, VOICE_ATTRIBUTE } from '@/lib/protocol';
import { ConversationViewer } from './ConversationViewer';
import { HistorySidebar } from './HistorySidebar';
import { SessionView } from './SessionView';
import { WelcomeView } from './WelcomeView';

const tokenSource = TokenSource.endpoint('/api/token');
const SIDEBAR_KEY = 'llm-wiki-avatar.historySidebar';

export function App({ avatar }: { avatar: AvatarSettings }) {
  const [language, setLanguage] = useState<Language>('en');
  const [inputMode, setInputMode] = useState<InputMode>('always');
  const [presentation, setPresentation] = useState<Presentation>(avatar.defaultPresentation);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [viewing, setViewing] = useState<Conversation>();
  const [continuing, setContinuing] = useState<Conversation>();
  const [conversationId, setConversationId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setLanguage(loadLanguage());
    setInputMode(loadInputMode());
    setPresentation(loadPresentation(avatar.defaultPresentation));
    setHistory(loadHistory());
    const stored = window.localStorage.getItem(SIDEBAR_KEY);
    setSidebarOpen(stored ? stored === 'open' : window.innerWidth >= 768);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSidebar = useCallback((open: boolean) => {
    setSidebarOpen(open);
    window.localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed');
  }, []);

  const save = useCallback((conversation: Conversation) => setHistory(saveConversation(conversation)), []);
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

  const changePresentation = useCallback((next: Presentation) => {
    setPresentation(next);
    savePresentation(next);
  }, []);

  // The token route puts these on the participant, so the agent starts in the right language, mic mode and voice.
  const voice = voiceOf(presentation);
  const options = useMemo(
    () => ({
      participantAttributes: {
        [LANGUAGE_ATTRIBUTE]: language,
        [INPUT_MODE_ATTRIBUTE]: inputMode,
        [VOICE_ATTRIBUTE]: voice,
      },
    }),
    [language, inputMode, voice],
  );
  const session = useSession(tokenSource, options);
  const strings = STRINGS[language];

  const start = async (previous?: Conversation) => {
    setContinuing(previous);
    setConversationId(previous?.id ?? crypto.randomUUID());
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

  // Leaving a continued conversation: the next start is a fresh one again.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (wasConnected.current && !session.isConnected) setContinuing(undefined);
    wasConnected.current = session.isConnected;
  }, [session.isConnected]);
  const showHistory = sidebarOpen ? undefined : () => toggleSidebar(true);

  return (
    <SessionProvider session={session}>
      <div className="flex h-full">
        {sidebarOpen && (
          <HistorySidebar
            conversations={history}
            activeId={session.isConnected ? conversationId : undefined}
            strings={strings}
            language={language}
            onSelect={setViewing}
            onClear={() => {
              clearHistory();
              setHistory([]);
            }}
            onHide={() => toggleSidebar(false)}
          />
        )}
        <div className="h-full min-w-0 flex-1">
          {session.isConnected ? (
            <SessionView
              avatar={avatar}
              strings={strings}
              language={language}
              onLanguageChange={changeLanguage}
              inputMode={inputMode}
              onInputModeChange={changeInputMode}
              presentation={presentation}
              onPresentationChange={changePresentation}
              previous={continuing}
              conversationId={conversationId}
              onSave={save}
              onShowHistory={showHistory}
            />
          ) : (
            <WelcomeView
              strings={strings}
              language={language}
              onLanguageChange={changeLanguage}
              inputMode={inputMode}
              onInputModeChange={changeInputMode}
              presentation={presentation}
              onPresentationChange={changePresentation}
              onStart={() => void start()}
              connecting={connecting}
              error={error}
              onShowHistory={showHistory}
            />
          )}
        </div>
        {viewing && (
          <ConversationViewer
            conversation={viewing}
            strings={strings}
            language={language}
            onClose={() => setViewing(undefined)}
            onDelete={
              session.isConnected && viewing.id === conversationId
                ? undefined
                : () => {
                    setHistory(deleteConversation(viewing.id));
                    setViewing(undefined);
                  }
            }
            onContinue={
              session.isConnected || connecting
                ? undefined
                : () => {
                    setViewing(undefined);
                    void start(viewing);
                  }
            }
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
