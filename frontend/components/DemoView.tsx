'use client';

import { useEffect, useMemo, useState } from 'react';
import { useContinuousMode } from '@/hooks/useContinuousMode';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { useReplySpeech, useVoice } from '@/hooks/useReplySpeech';
import { useActiveSttModel } from '@/hooks/useSpeechRecognizer';
import { useWakeLock } from '@/hooks/useWakeLock';
import { withBase } from '@/lib/basePath';
import type { TranscriptEntry } from '@/lib/history';
import { type Language, STRINGS, loadLanguage, saveLanguage } from '@/lib/language';
import {
  type Presentation,
  avatarOf,
  loadInstantTranscript,
  loadPresentation,
  savePresentation,
  voiceOf,
} from '@/lib/presentation';
import { conversationPhase, voicedAgentState } from '@/lib/status';
import { ConversationStatus } from './ConversationStatus';
import { LanguageSelector } from './LanguageSelector';
import { MicButton } from './MicButton';
import { PresentationSelector } from './PresentationSelector';
import { SettingsLink } from './SettingsLink';
import { Transcript } from './Transcript';
import { VrmAvatar } from './vrm/VrmAvatar';

/** The echo that makes up a demo turn: what was heard, and the same text as the "reply". */
export function echoTurn(text: string, now: number, id: string): TranscriptEntry[] {
  return [
    { id: `${id}-user`, fromUser: true, text, timestamp: now },
    { id: `${id}-echo`, fromUser: false, text, timestamp: now },
  ];
}

/** Runs the speech front end on its own: what the microphone hears is transcribed and spoken back, without any agent. */
export function DemoView({ defaultPresentation }: { defaultPresentation: Presentation }) {
  const [language, setLanguage] = useState<Language>('en');
  const [presentation, setPresentation] = useState<Presentation>(defaultPresentation);
  const [messages, setMessages] = useState<TranscriptEntry[]>([]);
  const [lastMs, setLastMs] = useState<number>();
  const [instant, setInstant] = useState(false);
  const continuous = useContinuousMode();
  const sttModel = useActiveSttModel();
  const strings = STRINGS[language];

  useEffect(() => {
    setLanguage(loadLanguage());
    setPresentation(loadPresentation(defaultPresentation));
    setInstant(loadInstantTranscript());
  }, [defaultPresentation]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const voice = voiceOf(presentation);
  const gender = avatarOf(presentation);
  const { spec, web, missing: voiceMissing } = useVoice(language, voice === 'off' ? null : voice);
  const speech = useReplySpeech({ messages, final: true, spec, web, instant });
  const stopSpeech = speech.stop;

  // While the reply plays, the microphone is ignored: on speakerphone it would hear the reply as speech.
  const ptt = useSpeechInput({
    model: sttModel,
    language,
    continuous,
    paused: speech.state !== 'idle',
    onPress: stopSpeech,
    onResult: (text, ms) => {
      if (!text) return;
      setLastMs(ms);
      setMessages((all) => [...all, ...echoTurn(text, Date.now(), crypto.randomUUID())]);
    },
  });
  useWakeLock(ptt.listening);

  const voiced = spec !== undefined || web !== undefined;
  const agentState = voiced ? voicedAgentState('listening', speech.state) : 'listening';
  const phase = conversationPhase(agentState, ptt.state);
  const shown = useMemo(() => speech.display(messages), [speech, messages]);
  const micSettings = ptt.track?.mediaStreamTrack.getSettings();
  const notice =
    voice !== 'off' && (speech.failed ? strings.voiceFailedShort : voiceMissing ? strings.voiceMissing : undefined);

  return (
    <div className="flex h-dvh flex-col pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate font-semibold">🎙️ {strings.demoTitle}</span>
        <div className="flex items-center gap-2">
          <LanguageSelector
            value={language}
            onChange={(l) => (setLanguage(l), saveLanguage(l))}
            label={strings.language}
          />
          <SettingsLink label={strings.settings} />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="relative overflow-hidden rounded-xl border border-border bg-panel">
          {gender ? (
            <VrmAvatar
              key={gender}
              gender={gender}
              label={gender === 'female' ? strings.avatarFemalePremium : strings.avatarMale}
              loadingLabel={strings.loadingAvatar}
              unavailableLabel={strings.avatarUnavailable}
              madeBy={strings.madeBy}
              className="h-[32vh] min-h-[180px] lg:h-[45vh]"
              audioTrack={speech.player?.track}
              agentState={agentState as never}
              words={speech.player}
            />
          ) : (
            <div className="grid h-32 place-items-center text-4xl" aria-hidden>
              {voice === 'off' ? '💬' : '🔊'}
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <ConversationStatus phase={phase} strings={strings} variant="banner" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <MicButton ptt={ptt} strings={strings} />
          <PresentationSelector
            value={presentation}
            onChange={(next) => {
              if (voiceOf(next) !== voice) stopSpeech();
              setPresentation(next);
              savePresentation(next);
            }}
            strings={strings}
          />
          {speech.state !== 'idle' && (
            <button
              type="button"
              onClick={stopSpeech}
              className="ml-auto rounded-full bg-danger px-4 py-2 text-sm font-semibold text-bg"
            >
              {strings.stop}
            </button>
          )}
        </div>

        {(!sttModel && ptt.engine !== 'browser') || notice ? (
          <p className="text-sm text-muted">
            {strings.demoSetup}{' '}
            <a href={withBase('/settings')} className="text-accent underline">
              {strings.speechSettings}
            </a>
          </p>
        ) : (
          <p className="text-xs text-muted">{strings.demoStartListening}</p>
        )}
        {ptt.error && <p className="text-sm text-danger">{strings.micUnavailable}</p>}
        {ptt.interim && <p className="text-sm italic text-muted">{ptt.interim}</p>}

        <section className="rounded-xl border border-border bg-panel">
          <Transcript messages={shown} emptyText={strings.demoIntro} maxEntries={4} thinking={false} />
        </section>

        <details className="rounded-xl border border-border bg-panel p-3 text-xs text-muted">
          <summary className="cursor-pointer font-semibold">{strings.demoDiagnostics}</summary>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt>{strings.demoModel}</dt>
            <dd>
              {ptt.status.kind === 'ready'
                ? `${ptt.status.model.label} (${ptt.status.device})`
                : ptt.status.kind === 'browser'
                  ? strings.demoBrowserSpeech
                  : (sttModel?.label ?? strings.demoNone)}
            </dd>
            <dt>{strings.demoVoiceEngine}</dt>
            <dd>{web ? strings.demoBrowserSpeech : spec ? spec.engine : strings.demoNone}</dd>
            <dt>{strings.demoFirstSound}</dt>
            <dd>{speech.latencyMs === undefined ? '–' : `${Math.round(speech.latencyMs)} ms`}</dd>
            {ptt.error && (
              <>
                <dt>{strings.demoLastError}</dt>
                <dd>{ptt.error}</dd>
              </>
            )}
            <dt>{strings.demoLastTranscription}</dt>
            <dd>{lastMs === undefined ? '–' : `${Math.round(lastMs)} ms`}</dd>
            <dt>{strings.demoMic}</dt>
            <dd>
              {micSettings
                ? `AEC ${micSettings.echoCancellation ? 'on' : 'off'}, NS ${micSettings.noiseSuppression ? 'on' : 'off'}, AGC ${micSettings.autoGainControl ? 'on' : 'off'}, ${micSettings.sampleRate ?? '?'} Hz`
                : '–'}
            </dd>
          </dl>
          <p className="mt-2">{strings.demoPrivacyNote}</p>
        </details>
      </main>
    </div>
  );
}
