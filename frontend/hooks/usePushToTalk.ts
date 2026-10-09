'use client';

import { type LocalAudioTrack, createLocalAudioTrack } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '@/lib/language';
import { isSilent, resampleForWhisper } from '@/lib/stt/audio';
import { type SttModel, whisperLanguage } from '@/lib/stt/models';
import { MicRecorder } from '@/lib/stt/recorder';
import { Vad } from '@/lib/stt/vad';
import type { SpeechState } from '@/lib/status';
import { type RecognizerStatus, useSpeechRecognizer } from './useSpeechRecognizer';

/** Keep recording briefly after release so the last word is not cut off. */
const RELEASE_TAIL_MS = 250;
/** After the reply has been spoken, wait for the room to go quiet before listening again (speaker echo). */
const RESUME_DELAY_MS = 600;

interface Options {
  model: SttModel | undefined;
  language: Language;
  /** Listen continuously and detect utterances, instead of holding a button. */
  continuous?: boolean;
  /** Continuous mode only: ignore the microphone, e.g. while the reply is spoken, so it is not heard as speech. */
  paused?: boolean;
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
  /** Browser speech input only: what is being recognized so far. */
  interim?: string;
  /** Hands-free mode is on. */
  continuous: boolean;
  /** Continuous mode: the microphone is open and utterances are detected. */
  listening: boolean;
  /** Continuous mode: stop or resume listening. */
  toggleListening(): void;
  press(): void;
  /** `send: false` drops the recording (e.g. the window lost focus). */
  release(send: boolean): void;
}

/** Hold to record, release to transcribe in the browser. */
export function usePushToTalk({
  model,
  language,
  continuous = false,
  paused = false,
  onPress,
  onResult,
}: Options): PushToTalk {
  const recognizer = useSpeechRecognizer(model);
  const [state, setState] = useState<SpeechState>('idle');
  const [held, setHeld] = useState(false);
  const [track, setTrack] = useState<LocalAudioTrack>();
  const [error, setError] = useState<string>();

  const latest = useRef({ recognizer, language, onPress, onResult });
  latest.current = { recognizer, language, onPress, onResult };
  const [muted, setMuted] = useState(false);
  const [reopen, setReopen] = useState(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const ignoreUntil = useRef(0);
  const wasPaused = useRef(false);
  const busy = useRef(false);
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
    recorder.current ??= createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
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

  const transcribe = useCallback(async (samples: Float32Array, sampleRate: number, id: number) => {
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
  }, []);

  const ready = recognizer.status.kind === 'ready';
  const listening = continuous && ready && !muted;

  useEffect(() => {
    if (!listening) return;
    let cancelled = false;
    let opened: MicRecorder | undefined;
    let mediaTrack: MediaStreamTrack | undefined;
    const onEnded = () => {
      // The input went away (e.g. a Bluetooth route change): open the microphone again.
      recorder.current = undefined;
      void opened?.close();
      setReopen((n) => n + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void opened?.resume();
    };
    const onTap = () => void opened?.resume();
    openRecorder()
      .then(async (r) => {
        if (cancelled) return;
        opened = r;
        mediaTrack = r.mediaStreamTrack;
        mediaTrack.addEventListener('ended', onEnded);
        const vad = new Vad(r.sampleRate);
        await r.startStreaming((frame) => {
          const hold = pausedRef.current || busy.current;
          if (pausedRef.current) ignoreUntil.current = performance.now() + RESUME_DELAY_MS;
          if (hold || performance.now() < ignoreUntil.current) {
            if (!wasPaused.current) vad.reset();
            wasPaused.current = true;
            return;
          }
          wasPaused.current = false;
          const event = vad.push(frame);
          if (!event) return;
          if (event.type === 'start') {
            setState('hearing');
            setError(undefined);
          } else if (event.type === 'discard') {
            setState('idle');
          } else {
            busy.current = true;
            const id = ++turn.current;
            void transcribe(event.samples, r.sampleRate, id).finally(() => {
              busy.current = false;
            });
          }
        });
        // Created outside a gesture, the context may stay suspended until the next tap.
        window.addEventListener('pointerdown', onTap);
        document.addEventListener('visibilitychange', onVisible);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('microphone failed', err);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      mediaTrack?.removeEventListener('ended', onEnded);
      window.removeEventListener('pointerdown', onTap);
      document.removeEventListener('visibilitychange', onVisible);
      opened?.stopStreaming();
      setState('idle');
    };
  }, [listening, reopen, openRecorder, transcribe]);

  const toggleListening = useCallback(() => setMuted((m) => !m), []);

  const press = useCallback(() => {
    if (continuous || heldRef.current || latest.current.recognizer.status.kind !== 'ready') return;
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
  }, [openRecorder, continuous]);

  const release = useCallback(
    (send: boolean) => {
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
        await transcribe(samples, sampleRate, id);
      })();
    },
    [transcribe],
  );

  return {
    status: recognizer.status,
    state,
    held,
    track,
    error,
    continuous,
    listening,
    toggleListening,
    press,
    release,
  };
}
