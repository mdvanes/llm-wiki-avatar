'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDeviceCaps } from '@/hooks/useSpeechRecognizer';
import type { TranscriptEntry } from '@/lib/history';
import type { Language } from '@/lib/language';
import { cachedFiles } from '@/lib/stt/cache';
import { TtsClient } from '@/lib/tts/client';
import { type PlayerState, SpeechPlayer } from '@/lib/tts/player';
import { speechSegments } from '@/lib/tts/speechText';
import { type VoiceGender, type VoiceSpec, voiceFiles, voiceFor, voiceSpec } from '@/lib/tts/voices';

/** The voice for the language and gender, once it is downloaded; `missing` when it is not. */
export function useVoice(language: Language, gender: VoiceGender | null): { spec?: VoiceSpec; missing: boolean } {
  const caps = useDeviceCaps();
  const [ready, setReady] = useState<boolean>();
  const spec = useMemo(
    () => (gender && caps ? voiceSpec(voiceFor(language, gender), caps) : undefined),
    [language, gender, caps],
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

  return { spec: ready ? spec : undefined, missing: ready === false };
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
  player?: SpeechPlayer<Spoken>;
  failed: boolean;
}

/**
 * Speaks the agent's replies in the browser as their text streams in. `messages` are this session's messages,
 * `final` tells whether the agent has finished writing the last one, and without a voice the replies stay text only.
 */
export function useReplySpeech({
  messages,
  final,
  spec,
  instant,
}: {
  messages: TranscriptEntry[];
  final: boolean;
  spec?: VoiceSpec;
  instant: boolean;
}): ReplySpeech {
  const [player, setPlayer] = useState<SpeechPlayer<Spoken>>();
  const [state, setState] = useState<PlayerState>('idle');
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState(false);
  const client = useRef<TtsClient | undefined>(undefined);
  const active = useRef<Active | undefined>(undefined);
  const finalRef = useRef(final);
  finalRef.current = final;

  const revealAll = useCallback((id: string) => {
    setRevealed((all) => (all[id] === Infinity ? all : { ...all, [id]: Infinity }));
  }, []);

  useEffect(() => {
    const created = new TtsClient();
    client.current = created;
    const speaker = new SpeechPlayer<Spoken>(created, {
      onSentence: ({ meta }) => {
        if (meta) setRevealed((all) => ({ ...all, [meta.id]: Math.max(all[meta.id] ?? 0, meta.end) }));
      },
      onState: (next) => {
        setState(next);
        if (next === 'idle' && active.current && finalRef.current) revealAll(active.current.id);
      },
      onError: (err) => {
        console.error('speech failed', err);
        setFailed(true);
        if (!active.current) return;
        active.current.stopped = true;
        revealAll(active.current.id);
      },
    });
    setPlayer(speaker);
    return () => {
      speaker.close();
      created.terminate();
      client.current = undefined;
    };
  }, [revealAll]);

  useEffect(() => {
    player?.setVoice(spec);
    setFailed(false);
    if (spec) client.current?.load(spec).catch((err: unknown) => console.warn('voice warm-up failed', err));
  }, [player, spec]);

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
      active.current = { id: last.id, queued: 0, stopped: !spec };
    }
    const reply = active.current;
    if (reply.stopped || !spec) {
      reply.stopped = true;
      revealAll(reply.id);
      return;
    }
    const segments = speechSegments(last.text, final).filter((s) => s.end > reply.queued);
    if (segments.length > 0) {
      reply.queued = segments.at(-1)!.end;
      player.enqueue(segments.map((s) => ({ text: s.text, meta: { id: reply.id, end: s.end } })));
    }
    if (final && player.state === 'idle') revealAll(reply.id);
  }, [player, last?.id, last?.text, last?.fromUser, final, spec, revealAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    player?.stop();
    if (!active.current) return;
    active.current.stopped = true;
    revealAll(active.current.id);
  }, [player, revealAll]);

  const speakingId = spec && last && !last.fromUser ? last.id : undefined;
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

  return { state, display, stop, player, failed };
}
