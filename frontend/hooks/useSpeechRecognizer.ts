'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SttClient } from '@/lib/stt/client';
import {
  type DeviceCaps,
  STT_MODEL_KEY,
  type SttDevice,
  type SttModel,
  detectCaps,
  deviceFor,
  loadSpec,
  loadSttModel,
} from '@/lib/stt/models';

export function useDeviceCaps(): DeviceCaps | undefined {
  const [caps, setCaps] = useState<DeviceCaps>();
  useEffect(() => {
    void detectCaps().then(setCaps);
  }, []);
  return caps;
}

/** The model chosen on the settings page; follows changes made there in another tab. */
export function useActiveSttModel(): SttModel | undefined {
  const [model, setModel] = useState<SttModel>();
  useEffect(() => {
    setModel(loadSttModel());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STT_MODEL_KEY || e.key === null) setModel(loadSttModel());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return model;
}

export type RecognizerStatus =
  | { kind: 'none' }
  | { kind: 'loading'; progress: number }
  | { kind: 'ready'; model: SttModel; device: SttDevice }
  | { kind: 'error'; message: string };

export interface Recognizer {
  status: RecognizerStatus;
  transcribe(audio: Float32Array, language: string): Promise<string>;
}

/** Loads the model in a Web Worker and transcribes with it. */
export function useSpeechRecognizer(model: SttModel | undefined): Recognizer {
  const caps = useDeviceCaps();
  const [status, setStatus] = useState<RecognizerStatus>({ kind: 'none' });
  const client = useRef<SttClient | undefined>(undefined);

  useEffect(() => {
    const created = new SttClient();
    client.current = created;
    return () => {
      created.terminate();
      client.current = undefined;
    };
  }, []);

  useEffect(() => {
    const worker = client.current;
    const device = model && caps ? deviceFor(model, caps) : undefined;
    if (!worker || !model || !device) {
      setStatus({ kind: 'none' });
      return;
    }
    let cancelled = false;
    setStatus({ kind: 'loading', progress: 0 });
    worker
      .load(loadSpec(model, device), (loaded, total) => {
        if (!cancelled) setStatus({ kind: 'loading', progress: total > 0 ? loaded / total : 0 });
      })
      .then(() => {
        if (!cancelled) setStatus({ kind: 'ready', model, device });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('speech model failed to load', err);
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [model, caps]);

  const transcribe = useCallback(async (audio: Float32Array, language: string) => {
    if (!client.current) throw new Error('speech worker not running');
    return client.current.transcribe(audio, language);
  }, []);

  return { status, transcribe };
}
