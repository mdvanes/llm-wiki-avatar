'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language, Strings } from '@/lib/language';
import type { WordTiming } from '@/lib/protocol';
import { cachedFiles, formatBytes, persistStorage, removeFiles } from '@/lib/stt/cache';
import type { DeviceCaps } from '@/lib/stt/models';
import { TtsClient } from '@/lib/tts/client';
import { SpeechPlayer } from '@/lib/tts/player';
import { SAMPLE_TEXT, TTS_VOICES, type TtsVoice, filesToRemove, ttsDevice, voiceFiles, voiceSpec } from '@/lib/tts/voices';

interface CacheState {
  bytes: number;
  complete: boolean;
}

interface Run {
  startedAt: number;
  firstAudioMs?: number;
  speechMs: number;
  synthMs: number;
  sentence?: { text: string; words?: WordTiming[]; startAt: number };
  done: boolean;
  error?: string;
}

const BUTTON = 'rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-40';
const PRIMARY = `${BUTTON} bg-accent text-bg`;
const SECONDARY = `${BUTTON} border border-border text-muted hover:border-accent hover:text-accent`;
const DANGER = `${BUTTON} border border-danger/60 text-danger hover:bg-danger/10`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Index of the word being spoken, given the time since the sentence started. */
function currentWord(words: readonly WordTiming[], ms: number): number {
  return words.findIndex((w) => ms >= w.s && ms < w.e);
}

/** Download, remove and try the voices that speak the replies in this browser. */
export function VoiceSettings({
  language,
  strings,
  caps,
  onChange,
}: {
  language: Language;
  strings: Strings;
  caps: DeviceCaps | undefined;
  onChange: () => void;
}) {
  const [cache, setCache] = useState<Record<string, CacheState>>();
  const [downloading, setDownloading] = useState<{ id: string; progress: number }>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>();
  const [text, setText] = useState(SAMPLE_TEXT[language]);
  const [run, setRun] = useState<Run>();
  const [clock, setClock] = useState(0);
  const client = useRef<TtsClient | undefined>(undefined);
  const player = useRef<SpeechPlayer | undefined>(undefined);

  const startClient = useCallback(() => {
    const created = new TtsClient();
    client.current = created;
    player.current?.close();
    player.current = new SpeechPlayer(created, {
      onSentence: (sentence) =>
        setRun((r) =>
          r && {
            ...r,
            firstAudioMs: r.firstAudioMs ?? performance.now() - r.startedAt,
            speechMs: r.speechMs + sentence.durationMs,
            synthMs: r.synthMs + sentence.synthMs,
            sentence,
          },
        ),
      onIdle: () => setRun((r) => r && { ...r, done: true, sentence: undefined }),
      onError: (err) => setRun((r) => r && { ...r, done: true, error: errorMessage(err) }),
    });
    return created;
  }, []);

  useEffect(() => {
    startClient();
    return () => {
      player.current?.close();
      client.current?.terminate();
      player.current = undefined;
      client.current = undefined;
    };
  }, [startClient]);

  const refresh = useCallback(async () => {
    if (!caps) return;
    const states = await Promise.all(
      TTS_VOICES.map((voice) =>
        cachedFiles(voiceFiles(voiceSpec(voice, caps))).catch((): CacheState => ({ bytes: 0, complete: false })),
      ),
    );
    setCache(Object.fromEntries(TTS_VOICES.map((voice, i) => [voice.id, states[i]!])));
    onChange();
  }, [caps, onChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = TTS_VOICES.filter((voice) => cache?.[voice.id]?.complete);
  const tryVoice = ready.find((voice) => voice.id === selected) ?? ready[0];
  const tryLanguage = tryVoice?.language ?? language;

  useEffect(() => {
    setText(SAMPLE_TEXT[tryLanguage]);
  }, [tryLanguage]);

  const download = async (voice: TtsVoice) => {
    const worker = client.current;
    if (!caps || !worker) return;
    setDownloading({ id: voice.id, progress: 0 });
    setErrors(({ [voice.id]: _, ...rest }) => rest);
    void persistStorage();
    try {
      await worker.download(voiceSpec(voice, caps), (loaded, total) =>
        setDownloading({ id: voice.id, progress: total > 0 ? loaded / total : 0 }),
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('voice download failed', err);
        setErrors((all) => ({ ...all, [voice.id]: errorMessage(err) }));
      }
    } finally {
      setDownloading(undefined);
      void refresh();
    }
  };

  const cancel = () => {
    client.current?.terminate();
    startClient();
  };

  const remove = async (voice: TtsVoice) => {
    if (!caps || !window.confirm(strings.confirmRemoveVoice)) return;
    const others = TTS_VOICES.filter((v) => v.id !== voice.id && (cache?.[v.id]?.bytes ?? 0) > 0);
    await removeFiles(
      filesToRemove(
        voiceSpec(voice, caps),
        others.map((v) => voiceSpec(v, caps)),
      ),
    );
    await refresh();
  };

  const speak = () => {
    const current = player.current;
    if (!caps || !tryVoice || !current) return;
    current.stop();
    current.setVoice(voiceSpec(tryVoice, caps));
    setRun({ startedAt: performance.now(), speechMs: 0, synthMs: 0, done: false });
    current.speak(text);
  };

  const stop = () => {
    player.current?.stop();
    setRun((r) => r && { ...r, done: true, sentence: undefined });
  };

  const speaking = !!run && !run.done;
  useEffect(() => {
    if (!speaking) return;
    let frame = requestAnimationFrame(function tick() {
      setClock(player.current?.context.currentTime ?? 0);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [speaking]);

  const words = run?.sentence?.words;
  const wordIndex = words && run?.sentence ? currentWord(words, (clock - run.sentence.startAt) * 1000) : -1;

  return (
    <>
      <section>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{strings.voices}</h2>
        <p className="mb-3 text-sm text-muted">{strings.voicesIntro}</p>
        <ul className="flex flex-col gap-3">
          {TTS_VOICES.map((voice) => {
            const state = cache?.[voice.id];
            const busy = downloading?.id === voice.id;
            const device = caps && ttsDevice(voice, caps);
            const status = !state
              ? '…'
              : state.complete
                ? `${strings.downloaded} (${formatBytes(state.bytes)})`
                : state.bytes > 0
                  ? `${strings.partlyDownloaded} (${formatBytes(state.bytes)})`
                  : strings.notDownloaded;
            return (
              <li key={voice.id} className="rounded-xl border border-border bg-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{voice.label}</span>
                      <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-muted">
                        {voice.language.toUpperCase()} · {voice.gender === 'female' ? strings.female : strings.male}
                      </span>
                      {voice.engine === 'kokoro' && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                          {strings.wordTimings}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {device === 'webgpu' ? 'WebGPU' : 'WASM'}
                      {device && ` · ~${formatBytes(voice.sizeMb[device] * 1e6)}`} · {status}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {busy ? (
                      <button type="button" onClick={cancel} className={SECONDARY}>
                        {strings.cancel}
                      </button>
                    ) : (
                      <>
                        {state && !state.complete && (
                          <button
                            type="button"
                            onClick={() => void download(voice)}
                            disabled={!!downloading}
                            className={PRIMARY}
                          >
                            {state.bytes > 0 ? strings.resumeDownload : strings.download}
                          </button>
                        )}
                        {state && state.bytes > 0 && (
                          <button type="button" onClick={() => void remove(voice)} className={DANGER}>
                            {strings.remove}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {busy && (
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                      <div
                        className="h-full bg-accent transition-[width]"
                        style={{ width: `${Math.round(downloading.progress * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {strings.downloading} {Math.round(downloading.progress * 100)}%
                    </p>
                  </div>
                )}
                {errors[voice.id] && (
                  <p className="mt-2 text-xs text-danger">
                    {strings.downloadFailed}: {errors[voice.id]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-panel p-4 text-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{strings.tryVoice}</h2>
        {!tryVoice ? (
          <p className="text-muted">{strings.tryVoiceNone}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={tryVoice.id}
                onChange={(e) => setSelected(e.target.value)}
                className="rounded-lg border border-border bg-panel-2 px-2 py-1 text-sm"
              >
                {ready.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label} · {voice.language.toUpperCase()}
                  </option>
                ))}
              </select>
              {speaking ? (
                <button type="button" onClick={stop} className={SECONDARY}>
                  {strings.stop}
                </button>
              ) : (
                <button type="button" onClick={speak} disabled={!text.trim()} className={PRIMARY}>
                  {strings.speak}
                </button>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-panel-2 p-2 text-sm"
            />
            {run && (
              <div className="rounded-lg bg-panel-2 p-3">
                {run.error ? (
                  <p className="text-danger">
                    {strings.voiceFailed} {run.error}
                  </p>
                ) : run.firstAudioMs === undefined ? (
                  <p className="text-muted">{strings.preparingSpeech}</p>
                ) : (
                  <p className="text-xs text-muted">
                    {strings.firstAudioAfter} {Math.round(run.firstAudioMs)} ms · {strings.speechLength}{' '}
                    {seconds(run.speechMs)} · {strings.synthesizedIn} {seconds(run.synthMs)}
                  </p>
                )}
                {run.sentence && <p className="mt-2">{run.sentence.text}</p>}
                {words && words.length > 0 && (
                  <p className="mt-1 font-mono text-xs text-muted">
                    {words.map((w, i) => (
                      <span key={`${i}-${w.s}`} className={i === wordIndex ? 'rounded bg-accent px-0.5 text-bg' : ''}>
                        {w.w}{' '}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
