'use client';

import { type LocalAudioTrack, createLocalAudioTrack } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '@/lib/language';
import { isSilent, resampleForWhisper } from '@/lib/stt/audio';
import { type SttModel, whisperLanguage } from '@/lib/stt/models';
import { MicRecorder } from '@/lib/stt/recorder';
import type { SpeechState } from '@/lib/status';
import { type RecognizerStatus, useSpeechRecognizer } from './useSpeechRecognizer';

/** Keep recording briefly after release so the last word is not cut off. */
const RELEASE_TAIL_MS = 250;

interface Options {
  model: SttModel | undefined;
  language: Language;
  /** The button went down. */
  onPress?: () => void;
  /** A turn was transcribed; `text` is empty when nothing was recognized. */
  onResult: (text: string, elapsedMs: number) => void;
}

export interface PushToTalk {
  status: RecognizerStatus;
  state: SpeechState;
  held: boolean;
  /** The local microphone track (never published); for the level meter. */
  track: LocalAudioTrack | undefined;
  error: string | undefined;
  press(): void;
  /** `send: false` drops the recording (e.g. the window lost focus). */
  release(send: boolean): void;
}

/** Hold to record, release to transcribe in the browser. */
export function usePushToTalk({ model, language, onPress, onResult }: Options): PushToTalk {
  const recognizer = useSpeechRecognizer(model);
  const [state, setState] = useState<SpeechState>('idle');
  const [held, setHeld] = useState(false);
  const [track, setTrack] = useState<LocalAudioTrack>();
  const [error, setError] = useState<string>();

  const latest = useRef({ recognizer, language, onPress, onResult });
  latest.current = { recognizer, language, onPress, onResult };
  const heldRef = useRef(false);
  const turn = useRef(0);
  const recorder = useRef<Promise<MicRecorder> | undefined>(undefined);
  const starting = useRef<Promise<void>>(Promise.resolve());

  useEffect(
    () => () => {
      const opened = recorder.current;
      recorder.current = undefined;
      void opened?.then(
        (r) => r.close(),
        () => {},
      );
    },
    [],
  );
  useEffect(() => () => track?.stop(), [track]);

  // The microphone opens on the first press and stays open, so later turns start without delay.
  const openRecorder = useCallback(() => {
    recorder.current ??= createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
      .then((created) => {
        setTrack(created);
        return MicRecorder.open(created.mediaStreamTrack);
      })
      .catch((err: unknown) => {
        recorder.current = undefined;
        throw err;
      });
    return recorder.current;
  }, []);

  const press = useCallback(() => {
    if (heldRef.current || latest.current.recognizer.status.kind !== 'ready') return;
    heldRef.current = true;
    const id = ++turn.current;
    setHeld(true);
    setState('hearing');
    setError(undefined);
    latest.current.onPress?.();
    starting.current = openRecorder()
      .then((r) => (heldRef.current && id === turn.current ? r.start() : undefined))
      .catch((err: unknown) => {
        console.error('microphone failed', err);
        setError(err instanceof Error ? err.message : String(err));
        setState('idle');
      });
  }, [openRecorder]);

  const release = useCallback((send: boolean) => {
    if (!heldRef.current) return;
    heldRef.current = false;
    const id = turn.current;
    setHeld(false);
    void (async () => {
      await starting.current;
      await new Promise((r) => setTimeout(r, RELEASE_TAIL_MS));
      // Pressed again during the tail: that turn owns the recorder now.
      if (id !== turn.current) return;
      const r = await recorder.current?.catch(() => undefined);
      if (!r?.recording) {
        setState('idle');
        return;
      }
      const { samples, sampleRate } = await r.stop();
      if (!send) {
        setState('idle');
        return;
      }
      const started = performance.now();
      if (isSilent(samples, sampleRate)) {
        setState('idle');
        latest.current.onResult('', 0);
        return;
      }
      setState('transcribing');
      try {
        const audio = await resampleForWhisper(samples, sampleRate);
        const { recognizer: current, language } = latest.current;
        const text = await current.transcribe(audio, whisperLanguage(language));
        if (id === turn.current) latest.current.onResult(text, performance.now() - started);
      } catch (err) {
        console.error('transcription failed', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (id === turn.current) setState('idle');
      }
    })();
  }, []);

  return { status: recognizer.status, state, held, track, error, press, release };
}
