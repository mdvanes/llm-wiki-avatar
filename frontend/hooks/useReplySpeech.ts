'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpeechEngines } from '@/hooks/useSpeechEngines';
import { useDeviceCaps } from '@/hooks/useSpeechRecognizer';
import { loadWebVoice } from '@/lib/speech/engine';
import { speechLang } from '@/lib/speech/webSpeech';
import type { TranscriptEntry } from '@/lib/history';
import type { Language } from '@/lib/language';
import { cachedFiles } from '@/lib/stt/cache';
import { TtsClient } from '@/lib/tts/client';
import { type PlayerState, SpeechPlayer } from '@/lib/tts/player';
import type { Speaker } from '@/lib/tts/speaker';
import { WebSpeechPlayer } from '@/lib/tts/webSpeechPlayer';
import { speechSegments } from '@/lib/tts/speechText';
import { type VoiceGender, type VoiceSpec, voiceFiles, voiceFor, voiceSpec } from '@/lib/tts/voices';

/** The browser's voice settings, when the browser engine is chosen for speech output. */
export interface WebVoice {
  lang: string;
  voiceURI: string | null;
}

/**
 * The voice for the language and gender, once it is downloaded; `missing` when it is not. With the browser engine
 * there is nothing to download: `web` is set instead of `spec`.
 */
export function useVoice(
  language: Language,
  gender: VoiceGender | null,
): { spec?: VoiceSpec; web?: WebVoice; missing: boolean } {
  const caps = useDeviceCaps();
  const { output } = useSpeechEngines();
  const [ready, setReady] = useState<boolean>();
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const spec = useMemo(
    () => (gender && caps && output === 'device' ? voiceSpec(voiceFor(language, gender), caps) : undefined),
    [language, gender, caps, output],
  );

  useEffect(() => {
    const read = () => setVoiceURI(loadWebVoice(language));
    read();
    window.addEventListener('focus', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('focus', read);
      window.removeEventListener('storage', read);
    };
  }, [language]);
  const web = useMemo(
    () => (gender && output === 'browser' ? { lang: speechLang(language), voiceURI } : undefined),
    [gender, output, language, voiceURI],
  );

  useEffect(() => {
    setReady(undefined);
    if (!spec) return;
    let cancelled = false;
    // The voice may be downloaded in the settings tab meanwhile.
    const check = () => {
      cachedFiles(voiceFiles(spec))
        .then((state) => !cancelled && setReady(state.complete))
        .catch(() => !cancelled && setReady(false));
    };
    check();
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', check);
    };
  }, [spec]);

  return { spec: ready ? spec : undefined, web, missing: ready === false };
}

interface Spoken {
  id: string;
  end: number;
}

interface Active {
  id: string;
  /** Offset in the reply up to which sentences have been queued. */
  queued: number;
  stopped: boolean;
}

export interface ReplySpeech {
  state: PlayerState;
  /** The transcript as far as it should be shown: the reply being spoken only up to the sentence being heard. */
  display: (entries: TranscriptEntry[]) => TranscriptEntry[];
  /** Stops the voice; the reply is shown in full. */
  stop: () => void;
  player?: Speaker<Spoken>;
  failed: boolean;
  /** Browser voice only: ms from the reply's first sentence to the first sound. */
  latencyMs?: number;
}

/**
 * Speaks the agent's replies in the browser as their text streams in. `messages` are this session's messages,
 * `final` tells whether the agent has finished writing the last one, and without a voice the replies stay text only.
 */
export function useReplySpeech({
  messages,
  final,
  spec,
  web,
  instant,
}: {
  messages: TranscriptEntry[];
  final: boolean;
  spec?: VoiceSpec;
  web?: WebVoice;
  instant: boolean;
}): ReplySpeech {
  const [player, setPlayer] = useState<Speaker<Spoken>>();
  const [state, setState] = useState<PlayerState>('idle');
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number>();
  const useWeb = web !== undefined;
  const webRef = useRef(web);
  webRef.current = web;
  const client = useRef<TtsClient | undefined>(undefined);
  const active = useRef<Active | undefined>(undefined);
  const finalRef = useRef(final);
  finalRef.current = final;

  const revealAll = useCallback((id: string) => {
    setRevealed((all) => (all[id] === Infinity ? all : { ...all, [id]: Infinity }));
  }, []);

  useEffect(() => {
    const events = {
      onSentence: ({ meta }: { meta?: Spoken }) => {
        if (meta)
          setRevealed((all) => ({
            ...all,
            [meta.id]: Math.max(all[meta.id] ?? 0, meta.end),
          }));
      },
      onState: (next: PlayerState) => {
        setState(next);
        if (next === 'idle' && active.current && finalRef.current) revealAll(active.current.id);
      },
      onError: (err: unknown) => {
        console.error('speech failed', err);
        setFailed(true);
        if (!active.current) return;
        active.current.stopped = true;
        revealAll(active.current.id);
      },
    };
    if (useWeb) {
      const speaker = new WebSpeechPlayer<Spoken>({
        ...events,
        onLatency: setLatencyMs,
      });
      const { lang, voiceURI } = webRef.current!;
      speaker.setVoice(lang, voiceURI);
      setPlayer(speaker);
      return () => {
        speaker.close();
        setPlayer(undefined);
      };
    }
    const created = new TtsClient();
    client.current = created;
    const speaker = new SpeechPlayer<Spoken>(created, events);
    setPlayer(speaker);
    return () => {
      speaker.close();
      created.terminate();
      client.current = undefined;
      setPlayer(undefined);
    };
  }, [revealAll, useWeb]);

  useEffect(() => {
    if (!player) return;
    setFailed(false);
    if (player instanceof WebSpeechPlayer) {
      if (web) player.setVoice(web.lang, web.voiceURI);
      return;
    }
    (player as SpeechPlayer<Spoken>).setVoice(spec);
    if (spec) client.current?.load(spec).catch((err: unknown) => console.warn('voice warm-up failed', err));
  }, [player, spec, web]);

  const voiced = spec !== undefined || web !== undefined;
  const last = messages.at(-1);
  useEffect(() => {
    if (!player) return;
    if (!last || last.fromUser) {
      // A new question: the previous reply is no longer spoken.
      if (active.current) {
        player.stop();
        revealAll(active.current.id);
        active.current = undefined;
      }
      return;
    }
    if (active.current?.id !== last.id) {
      if (active.current) revealAll(active.current.id);
      active.current = { id: last.id, queued: 0, stopped: !voiced };
    }
    const reply = active.current;
    if (reply.stopped || !voiced) {
      reply.stopped = true;
      revealAll(reply.id);
      return;
    }
    const segments = speechSegments(last.text, final).filter((s) => s.end > reply.queued);
    if (segments.length > 0) {
      reply.queued = segments.at(-1)!.end;
      player.enqueue(
        segments.map((s) => ({
          text: s.text,
          meta: { id: reply.id, end: s.end },
        })),
      );
    }
    if (final && player.state === 'idle') revealAll(reply.id);
  }, [player, last?.id, last?.text, last?.fromUser, final, voiced, revealAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    player?.stop();
    if (!active.current) return;
    active.current.stopped = true;
    revealAll(active.current.id);
  }, [player, revealAll]);

  const speakingId = voiced && last && !last.fromUser ? last.id : undefined;
  const display = useCallback(
    (entries: TranscriptEntry[]) => {
      if (instant || !speakingId) return entries;
      return entries.flatMap((entry) => {
        if (entry.id !== speakingId) return [entry];
        const text = entry.text.slice(0, revealed[entry.id] ?? 0);
        return text.trim() ? [{ ...entry, text }] : [];
      });
    },
    [instant, speakingId, revealed],
  );

  return { state, display, stop, player, failed, latencyMs };
}
