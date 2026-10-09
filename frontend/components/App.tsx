'use client';

import { SessionProvider, useSession } from '@livekit/components-react';
import { DisconnectReason, RoomEvent, TokenSource } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Problem, describeConnectionError, describeDisconnect, isUnexpectedDisconnect } from '@/lib/diagnostics';
import { type Conversation, clearHistory, deleteConversation, loadHistory, saveConversation } from '@/lib/history';
import { type Language, STRINGS, type Strings, loadLanguage, saveLanguage } from '@/lib/language';
import { type Presentation, loadPresentation, savePresentation } from '@/lib/presentation';
import { LANGUAGE_ATTRIBUTE } from '@/lib/protocol';
import { ConversationViewer } from './ConversationViewer';
import { HistorySidebar } from './HistorySidebar';
import { SessionView } from './SessionView';
import { WelcomeView } from './WelcomeView';

const tokenSource = TokenSource.endpoint('/api/token');
const SIDEBAR_KEY = 'llm-wiki-avatar.historySidebar';

/** Kept as a function of the strings, so the notice follows a language switch. */
export type ErrorState = (strings: Strings) => Problem;

/** The LiveKit URL the browser tried; only asked for after a failure. */
async function fetchLivekitUrl(): Promise<string | undefined> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const body = (await res.json()) as { livekitUrl?: unknown };
    return typeof body.livekitUrl === 'string' ? body.livekitUrl : undefined;
  } catch {
    return undefined;
  }
}

export function App({ defaultPresentation }: { defaultPresentation: Presentation }) {
  const [language, setLanguage] = useState<Language>('en');
  const [presentation, setPresentation] = useState<Presentation>(defaultPresentation);
  const [error, setError] = useState<ErrorState>();
  const [starting, setStarting] = useState(false);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [viewing, setViewing] = useState<Conversation>();
  const [continuing, setContinuing] = useState<Conversation>();
  const [conversationId, setConversationId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setLanguage(loadLanguage());
    setPresentation(loadPresentation(defaultPresentation));
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

  const changePresentation = useCallback((next: Presentation) => {
    setPresentation(next);
    savePresentation(next);
  }, []);

  // The token route puts this on the participant, so the agent starts in the right language.
  const options = useMemo(() => ({ participantAttributes: { [LANGUAGE_ATTRIBUTE]: language } }), [language]);
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
      console.warn('could not start the conversation', err);
      const livekitUrl = await fetchLivekitUrl();
      setError(() => (s: Strings) => describeConnectionError(err, livekitUrl, s));
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
  // A dropped connection used to just return to the welcome screen; explain it there instead.
  const room = session.room;
  useEffect(() => {
    const onDisconnected = (reason?: DisconnectReason) => {
      if (!wasConnected.current || !isUnexpectedDisconnect(reason)) return;
      console.warn('LiveKit connection lost', reason === undefined ? 'UNKNOWN' : DisconnectReason[reason]);
      setError(() => (s: Strings) => describeDisconnect(reason, s));
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

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
              strings={strings}
              language={language}
              onLanguageChange={changeLanguage}
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
              presentation={presentation}
              onPresentationChange={changePresentation}
              onStart={() => void start()}
              connecting={connecting}
              error={error?.(strings)}
              onDismissError={() => setError(undefined)}
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
      </div>
    </SessionProvider>
  );
}
