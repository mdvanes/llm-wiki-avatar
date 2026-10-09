'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '@/lib/language';
import {
  type Recognition,
  classifyError,
  readResults,
  recognitionCtor,
  restartDelay,
  speechLang,
} from '@/lib/speech/webSpeech';
import type { SpeechState } from '@/lib/status';
import type { PushToTalk } from './usePushToTalk';

/** After the reply has been spoken, wait for the room to go quiet before listening again (speaker echo). */
const RESUME_DELAY_MS = 600;

interface Options {
  enabled: boolean;
  language: Language;
  continuous?: boolean;
  paused?: boolean;
  onPress?: () => void;
  onResult: (text: string, elapsedMs: number) => void;
}

/** The same interface as push-to-talk, on the browser's speech recognition (which streams audio to the browser vendor). */
export function useWebSpeechInput({
  enabled,
  language,
  continuous = false,
  paused = false,
  onPress,
  onResult,
}: Options): PushToTalk {
  const [state, setState] = useState<SpeechState>('idle');
  const [held, setHeld] = useState(false);
  const [error, setError] = useState<string>();
  const [interim, setInterim] = useState('');
  const [muted, setMuted] = useState(false);

  const latest = useRef({ language, onPress, onResult, continuous });
  latest.current = { language, onPress, onResult, continuous };
  const recognition = useRef<Recognition | undefined>(undefined);
  const wanted = useRef(false);
  const failures = useRef(0);
  const restart = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const turn = useRef(false);

  const supported = enabled && recognitionCtor() !== undefined;
  const listening = supported && continuous && !muted;

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    const r = new Ctor();
    r.lang = speechLang(latest.current.language);
    r.interimResults = true;
    // Android Chrome repeats earlier results with `continuous`; one utterance per session and a restart is steadier.
    r.continuous = false;
    r.maxAlternatives = 1;
    const began = performance.now();
    let spokeUntil = 0;
    let delivered = false;
    r.onspeechstart = () => setState('hearing');
    r.onspeechend = () => {
      spokeUntil = performance.now();
    };
    r.onresult = (event) => {
      const { final, interim: partial } = readResults(event);
      if (final) {
        delivered = true;
        failures.current = 0;
        setInterim('');
        setState('idle');
        latest.current.onResult(final, performance.now() - (spokeUntil || began));
      } else if (partial) {
        setInterim(partial);
        setState('hearing');
      }
    };
    r.onerror = ({ error: code }) => {
      const kind = classifyError(code);
      if (kind === 'fatal') {
        wanted.current = false;
        setError(code);
      } else if (kind === 'network') {
        failures.current++;
        setError(code);
      }
    };
    r.onend = () => {
      if (recognition.current === r) recognition.current = undefined;
      setState('idle');
      setInterim('');
      if (turn.current) {
        turn.current = false;
        if (!delivered) latest.current.onResult('', 0);
      }
      if (wanted.current) {
        restart.current = setTimeout(start, restartDelay(failures.current));
      }
    };
    recognition.current = r;
    try {
      r.start();
    } catch (err) {
      recognition.current = undefined;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!listening) return;
    if (paused) {
      // Do not hear the speaker: stop listening while the reply plays.
      wanted.current = false;
      recognition.current?.abort();
      return;
    }
    setError(undefined);
    const timer = setTimeout(() => {
      wanted.current = true;
      start();
    }, RESUME_DELAY_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(restart.current);
      wanted.current = false;
      recognition.current?.abort();
      setState('idle');
    };
  }, [listening, paused, start]);

  const press = useCallback(() => {
    if (!supported || latest.current.continuous || recognition.current) return;
    setHeld(true);
    setError(undefined);
    setState('hearing');
    turn.current = true;
    latest.current.onPress?.();
    start();
  }, [supported, start]);

  const release = useCallback((send: boolean) => {
    setHeld(false);
    if (!recognition.current) return;
    if (send) recognition.current.stop();
    else {
      turn.current = false;
      recognition.current.abort();
    }
  }, []);

  useEffect(
    () => () => {
      wanted.current = false;
      clearTimeout(restart.current);
      recognition.current?.abort();
    },
    [],
  );

  const toggleListening = useCallback(() => setMuted((m) => !m), []);

  return {
    status: supported ? { kind: 'browser' } : { kind: 'none' },
    state,
    held,
    track: undefined,
    error,
    continuous,
    listening,
    interim,
    toggleListening,
    press,
    release,
  };
}
