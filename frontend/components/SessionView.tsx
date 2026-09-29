'use client';

import {
  useAgent,
  useLocalParticipant,
  useSessionContext,
  useSessionMessages,
} from '@livekit/components-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useWikiStreams } from '@/hooks/useWikiStreams';
import type { Language, Strings } from '@/lib/language';
import type { AvatarConfig } from '@/lib/server-config';
import {
  type InputMode,
  RPC_SET_INPUT_MODE,
  RPC_SET_LANGUAGE,
  SPEECH_STATE_ATTRIBUTE,
  toSpeechState,
} from '@/lib/protocol';
import { type Phase, TRANSCRIPT_GRACE_MS, conversationPhase, holdsPrevious } from '@/lib/status';
import { AnswerCard } from './AnswerCard';
import { ConversationStatus, phaseLabel } from './ConversationStatus';
import { InputModeSelector } from './InputModeSelector';
import { LanguageSelector } from './LanguageSelector';
import { MicButton } from './MicButton';
import { PageViewer, type PageRef } from './PageViewer';
import { SourceChips } from './SourceChips';
import { TalkingHeadAvatar } from './TalkingHeadAvatar';
import { Transcript } from './Transcript';

interface Props {
  avatar: AvatarConfig;
  strings: Strings;
  language: Language;
  onLanguageChange: (language: Language) => void;
  inputMode: InputMode;
  onInputModeChange: (mode: InputMode) => void;
}

/** Smooths over the brief "listening" gap between the transcript and the agent starting to think. */
function useSettledPhase(phase: Phase): Phase {
  const [shown, setShown] = useState(phase);
  useEffect(() => {
    if (!holdsPrevious(shown, phase)) {
      setShown(phase);
      return;
    }
    const timer = setTimeout(() => setShown(phase), TRANSCRIPT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  return shown;
}

export function SessionView({ avatar, strings, language, onLanguageChange, inputMode, onInputModeChange }: Props) {
  const session = useSessionContext();
  const agent = useAgent();
  const { localParticipant } = useLocalParticipant();
  const { messages, send } = useSessionMessages();
  const { mood, answers, sources, agentLanguage } = useWikiStreams();
  const [page, setPage] = useState<PageRef | null>(null);
  const [draft, setDraft] = useState('');
  const [switching, setSwitching] = useState(false);

  // The agent announces its language on start and after each switch; keep the selector in sync.
  useEffect(() => {
    if (agentLanguage && agentLanguage !== language) onLanguageChange(agentLanguage);
  }, [agentLanguage]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeLanguage = useCallback(
    async (next: Language) => {
      if (next === language) return;
      const previous = language;
      onLanguageChange(next);
      if (!agent.identity) return;
      setSwitching(true);
      try {
        await localParticipant.performRpc({
          destinationIdentity: agent.identity,
          method: RPC_SET_LANGUAGE,
          payload: next,
        });
      } catch (err) {
        console.error('set_language failed', err);
        onLanguageChange(previous);
      } finally {
        setSwitching(false);
      }
    },
    [agent.identity, language, localParticipant, onLanguageChange],
  );

  const changeInputMode = useCallback(
    async (next: InputMode) => {
      if (next === inputMode) return;
      const previous = inputMode;
      onInputModeChange(next);
      if (!agent.identity) return;
      try {
        await localParticipant.performRpc({
          destinationIdentity: agent.identity,
          method: RPC_SET_INPUT_MODE,
          payload: next,
        });
      } catch (err) {
        console.error('set_input_mode failed', err);
        onInputModeChange(previous);
      }
    },
    [agent.identity, inputMode, localParticipant, onInputModeChange],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await send(text);
  };

  const speechState = toSpeechState(agent.attributes?.[SPEECH_STATE_ATTRIBUTE]);
  const phase = useSettledPhase(conversationPhase(agent.state, speechState));
  const busy = phase === 'hearing' || phase === 'transcribing' || phase === 'thinking';
  const agentAudio = agent.microphoneTrack?.publication.track?.mediaStreamTrack;
  const newestFirst = [...answers].reverse();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="font-semibold">📚 LLM Wiki</span>
          <ConversationStatus phase={phase} strings={strings} />
        </div>
        <div className="flex items-center gap-3">
          <InputModeSelector
            value={inputMode}
            onChange={changeInputMode}
            disabled={!agent.isConnected}
            strings={strings}
          />
          <LanguageSelector
            value={language}
            onChange={changeLanguage}
            disabled={switching || !agent.isConnected}
            label={strings.language}
          />
          <button
            type="button"
            onClick={() => void session.end()}
            className="rounded-full border border-danger/60 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
          >
            {strings.end}
          </button>
        </div>
      </header>

      {agent.state === 'failed' && (
        <p className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {agent.failureReasons.join(' ')} Is the agent running (npm run dev -w agent)?
        </p>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:overflow-hidden">
        <section className="flex min-h-0 flex-col gap-4">
          <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-panel">
            <div className="relative">
              <TalkingHeadAvatar
                avatar={avatar}
                className="h-[50vh] min-h-[240px]"
                audioTrack={agentAudio}
                agentState={agent.state}
                mood={mood}
              />
              {busy && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                  <ConversationStatus phase={phase} strings={strings} variant="banner" />
                </div>
              )}
            </div>
            <form onSubmit={submit} className="flex items-center gap-2 border-t border-border p-3">
              <MicButton mode={inputMode} agentIdentity={agent.identity} strings={strings} />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={strings.typePlaceholder}
                className="min-w-0 flex-1 rounded-full border border-border bg-panel-2 px-4 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"
              >
                {strings.send}
              </button>
            </form>
          </div>
          <div className="flex min-h-[160px] flex-1 flex-col rounded-xl border border-border bg-panel">
            <h2 className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {strings.onScreen}
            </h2>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <div>
                <h3 className="mb-1.5 text-xs text-muted">{strings.sources}</h3>
                {sources.length > 0 ? (
                  <SourceChips sources={sources} onOpen={setPage} />
                ) : (
                  <p className="text-xs text-muted/70">{strings.noSources}</p>
                )}
              </div>
              {newestFirst.map((a) => (
                <AnswerCard key={a.id} answer={a} onOpen={setPage} />
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-[320px] flex-col rounded-xl border border-border bg-panel">
          <h2 className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {strings.transcript}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Transcript
              messages={messages}
              emptyText={strings.empty}
              thinking={phase === 'thinking'}
              pendingSpeech={phase === 'hearing' || phase === 'transcribing' ? phaseLabel(phase, strings) : undefined}
              onWikiLink={(name) => setPage({ name })}
            />
          </div>
        </section>
      </main>

      {page && (
        <PageViewer page={page} closeLabel={strings.close} onClose={() => setPage(null)} onNavigate={setPage} />
      )}
    </div>
  );
}
