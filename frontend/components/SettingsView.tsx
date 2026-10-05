'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePushToTalk } from '@/hooks/usePushToTalk';
import { useDeviceCaps } from '@/hooks/useSpeechRecognizer';
import { type Language, STRINGS, loadLanguage, saveLanguage } from '@/lib/language';
import type { PublicModelConfig } from '@/lib/server-config';
import {
  type StorageInfo,
  cachedBytes,
  formatBytes,
  persistStorage,
  removeCached,
  storageInfo,
} from '@/lib/stt/cache';
import { SttClient } from '@/lib/stt/client';
import {
  type DeviceCaps,
  STT_MODELS,
  type SttModel,
  deviceFor,
  loadSpec,
  loadSttModel,
  recommendedModel,
  saveSttModel,
} from '@/lib/stt/models';
import { LanguageSelector } from './LanguageSelector';
import { MicButton } from './MicButton';
import { VoiceSettings } from './VoiceSettings';

interface CacheState {
  bytes: number;
  complete: boolean;
}

const BUTTON = 'rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-40';
const PRIMARY = `${BUTTON} bg-accent text-bg`;
const SECONDARY = `${BUTTON} border border-border text-muted hover:border-accent hover:text-accent`;
const DANGER = `${BUTTON} border border-danger/60 text-danger hover:bg-danger/10`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function capsText(caps: DeviceCaps, strings: (typeof STRINGS)['en']): string {
  if (!caps.webgpu) return strings.webgpuNo;
  return caps.f16 ? strings.webgpuYes : strings.webgpuNoF16;
}

/** Download, select and remove the speech models (recognition and voices) that run in this browser. */
export function SettingsView({ modelConfig }: { modelConfig: PublicModelConfig }) {
  const [language, setLanguage] = useState<Language>('en');
  const strings = STRINGS[language];
  const caps = useDeviceCaps();
  const [active, setActive] = useState<SttModel>();
  const [cache, setCache] = useState<Record<string, CacheState>>();
  const [storage, setStorage] = useState<StorageInfo>();
  const [downloading, setDownloading] = useState<{ id: string; progress: number }>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [test, setTest] = useState<{ text: string; ms: number }>();
  const manager = useRef<SttClient | undefined>(undefined);

  useEffect(() => {
    setLanguage(loadLanguage());
    setActive(loadSttModel());
    const client = new SttClient();
    manager.current = client;
    return () => {
      client.terminate();
      manager.current = undefined;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const refresh = useCallback(async () => {
    const client = manager.current;
    if (!caps || !client) return;
    const specs = Object.fromEntries(
      STT_MODELS.flatMap((model) => {
        const device = deviceFor(model, caps);
        return device ? [[model.id, loadSpec(model, device)] as const] : [];
      }),
    );
    const [complete, sizes, info] = await Promise.all([
      client.check(specs).catch((): Record<string, boolean> => ({})),
      Promise.all(STT_MODELS.map((model) => cachedBytes(model.repo).catch(() => 0))),
      storageInfo().catch(() => undefined),
    ]);
    setCache(
      Object.fromEntries(STT_MODELS.map((model, i) => [model.id, { bytes: sizes[i]!, complete: !!complete[model.id] }])),
    );
    setStorage(info);
  }, [caps]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshStorage = useCallback(() => {
    void storageInfo()
      .catch(() => undefined)
      .then(setStorage);
  }, []);

  const choose = (model: SttModel | undefined) => {
    setActive(model);
    saveSttModel(model);
    setTest(undefined);
  };

  const download = async (model: SttModel) => {
    const device = caps && deviceFor(model, caps);
    const client = manager.current;
    if (!device || !client) return;
    setDownloading({ id: model.id, progress: 0 });
    setErrors(({ [model.id]: _, ...rest }) => rest);
    void persistStorage();
    try {
      await client.download(loadSpec(model, device), (loaded, total) =>
        setDownloading({ id: model.id, progress: total > 0 ? loaded / total : 0 }),
      );
      if (!loadSttModel()) choose(model);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('model download failed', err);
        setErrors((all) => ({ ...all, [model.id]: errorMessage(err) }));
      }
    } finally {
      setDownloading(undefined);
      void refresh();
    }
  };

  const cancel = () => {
    manager.current?.terminate();
    manager.current = new SttClient();
  };

  const remove = async (model: SttModel) => {
    if (!window.confirm(strings.confirmRemove)) return;
    await removeCached(model.repo);
    if (active?.id === model.id) choose(undefined);
    await refresh();
  };

  const testModel = active && cache?.[active.id]?.complete ? active : undefined;
  const ptt = usePushToTalk({ model: testModel, language, onResult: (text, ms) => setTest({ text, ms }) });
  const recommended = caps && recommendedModel(caps);

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <a href="/" className="text-sm text-muted hover:text-accent">
          ← {strings.backToApp}
        </a>
        <LanguageSelector
          value={language}
          onChange={(next) => {
            setLanguage(next);
            saveLanguage(next);
          }}
          label={strings.language}
        />
      </header>

      <div>
        <h1 className="text-2xl font-semibold">{strings.settings}</h1>
      </div>

      <section className="min-w-0 border-b border-border pb-6 text-sm [overflow-wrap:anywhere]" aria-labelledby="model-connection">
        <h2 id="model-connection" className="text-lg font-semibold">{strings.modelConnection}</h2>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt className="text-muted">{strings.configuredProvider}</dt>
          <dd>{modelConfig.provider === 'ollama' ? 'Ollama' : modelConfig.provider === 'legacy' ? strings.legacyProvider : 'OpenAI-compatible API'}</dd>
          <dt className="text-muted">{strings.configuredAuth}</dt>
          <dd>{modelConfig.auth === 'entra' ? 'Microsoft Entra ID' : strings.apiKeyAuth}</dd>
          <dt className="text-muted">{strings.configuredModel}</dt>
          <dd className="break-all font-mono">{modelConfig.model ?? strings.modelNotSet}</dd>
        </dl>
        <p className="mt-2 text-xs text-muted">{strings.modelConfigNote}</p>

        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer font-semibold">{strings.apiSetup}</summary>
          <div className="mt-3 space-y-3">
            <p>{strings.apiSetupIntro}</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-panel-2 p-3 text-xs"><code>{`LLM_PROVIDER=openai-compatible
LLM_AUTH=api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=YOUR_TOOL_CAPABLE_MODEL
LLM_API_KEY=YOUR_API_KEY`}</code></pre>
            <p>{strings.apiSetupKey}</p>
            <p>{strings.apiDockerOverride}</p>
            <p className="text-muted">{strings.modelPrivacy}</p>
          </div>
        </details>

        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer font-semibold">{strings.entraSetup}</summary>
          <div className="mt-3 space-y-3">
            <p>{strings.entraIntro}</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-panel-2 p-3 text-xs"><code>{`LLM_PROVIDER=openai-compatible
LLM_AUTH=entra
LLM_BASE_URL=https://api.staging.example.com/openai/v1
LLM_MODEL=YOUR_DEPLOYMENT_NAME
ENTRA_SCOPE=api://api.staging.example.com/.default
ENTRA_AUTH_MODE=cli
LLM_TEMPERATURE=omit`}</code></pre>
            <p>{strings.entraCli}</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-panel-2 p-3 text-xs"><code>az login --tenant YOUR_TENANT_ID --allow-no-subscriptions</code></pre>
            <p>{strings.entraServicePrincipal}</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-panel-2 p-3 text-xs"><code>{`ENTRA_AUTH_MODE=sp
AZURE_TENANT_ID=YOUR_TENANT_ID
AZURE_CLIENT_ID=YOUR_APPLICATION_ID
AZURE_CLIENT_SECRET=YOUR_CLIENT_SECRET`}</code></pre>
            <p>{strings.entraManagedIdentity}</p>
            <p>{strings.entraProduction}</p>
            <p>{strings.entraCa}</p>
            <p>{strings.apiDockerOverride}</p>
          </div>
        </details>

        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer font-semibold">{strings.ollamaSetup}</summary>
          <div className="mt-3 space-y-3">
            <p>{strings.ollamaNative}</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-panel-2 p-3 text-xs"><code>{`ollama pull qwen3:4b-instruct

LLM_PROVIDER=ollama
LLM_AUTH=api-key
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3:4b-instruct
LLM_API_KEY=ollama`}</code></pre>
            <p>{strings.ollamaDocker}</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-panel-2 p-3 text-xs"><code>{`LLM_BASE_URL_DOCKER=http://ollama:11434/v1

docker compose --profile ollama up -d --build`}</code></pre>
            <p>{strings.ollamaHost}</p>
            <p>{strings.ollamaProd}</p>
          </div>
        </details>

        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer font-semibold">{strings.modelApply}</summary>
          <div className="mt-3 space-y-3">
            <p>{strings.modelEnv}</p>
            <p>{strings.modelRestart}</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-panel-2 p-3 text-xs"><code>docker compose up -d --build --force-recreate agent frontend</code></pre>
            <p>{strings.modelFallback}</p>
            <p>{strings.modelTroubleshooting}</p>
          </div>
        </details>
      </section>

      <div>
        <h2 className="text-lg font-semibold">{strings.speechSettings}</h2>
        <p className="mt-2 text-muted">{strings.settingsIntro}</p>
      </div>

      <section className="rounded-xl border border-border bg-panel p-4 text-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{strings.thisBrowser}</h2>
        <p>{caps ? capsText(caps, strings) : '…'}</p>
        {storage && (
          <p className="mt-1 text-muted">
            {strings.storageUsed}: {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{strings.settingsTitle}</h2>
        <ul className="flex flex-col gap-3">
          {STT_MODELS.map((model) => {
            const device = caps && deviceFor(model, caps);
            const state = cache?.[model.id];
            const inUse = active?.id === model.id;
            const busy = downloading?.id === model.id;
            const size = device && model.sizeMb[device];
            const status = !state
              ? '…'
              : state.complete
                ? `${strings.downloaded} (${formatBytes(state.bytes)})`
                : state.bytes > 0
                  ? `${strings.partlyDownloaded} (${formatBytes(state.bytes)})`
                  : strings.notDownloaded;
            return (
              <li
                key={model.id}
                className={`rounded-xl border bg-panel p-4 ${inUse ? 'border-accent' : 'border-border'} ${
                  caps && !device ? 'opacity-60' : ''
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{model.label}</span>
                      {recommended?.id === model.id && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                          {strings.recommended}
                        </span>
                      )}
                      {inUse && (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-bg">
                          {strings.inUse}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted">{model.note[language]}</p>
                    <p className="mt-1 text-xs text-muted">
                      {caps && !device
                        ? strings.needsWebgpuF16
                        : `${device === 'webgpu' ? 'WebGPU' : 'WASM'}${size ? ` · ~${formatBytes(size * 1e6)}` : ''} · ${status}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {busy ? (
                      <button type="button" onClick={cancel} className={SECONDARY}>
                        {strings.cancel}
                      </button>
                    ) : (
                      <>
                        {device && state && !state.complete && (
                          <button
                            type="button"
                            onClick={() => void download(model)}
                            disabled={!!downloading}
                            className={PRIMARY}
                          >
                            {state.bytes > 0 ? strings.resumeDownload : strings.download}
                          </button>
                        )}
                        {device && state?.complete && !inUse && (
                          <button type="button" onClick={() => choose(model)} className={PRIMARY}>
                            {strings.use}
                          </button>
                        )}
                        {state && state.bytes > 0 && (
                          <button type="button" onClick={() => void remove(model)} className={DANGER}>
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
                {errors[model.id] && (
                  <p className="mt-2 text-xs text-danger">
                    {strings.downloadFailed}: {errors[model.id]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-panel p-4 text-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{strings.tryIt}</h2>
        {!testModel ? (
          <p className="text-muted">{strings.tryItNoModel}</p>
        ) : ptt.status.kind === 'ready' ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <MicButton ptt={ptt} strings={strings} />
              <span className="text-muted">
                {ptt.state === 'transcribing' ? strings.transcribing : strings.tryItHint}
              </span>
            </div>
            {ptt.error && <p className="text-danger">{strings.micUnavailable}</p>}
            {test && (
              <div className="rounded-lg bg-panel-2 p-3">
                <p>{test.text || <span className="text-muted">{strings.nothingRecognized}</span>}</p>
                {test.text && (
                  <p className="mt-1 text-xs text-muted">
                    {strings.transcribedIn} {Math.round(test.ms)} ms
                  </p>
                )}
              </div>
            )}
          </div>
        ) : ptt.status.kind === 'error' ? (
          <p className="text-danger">
            {strings.speechModelFailed} {ptt.status.message}
          </p>
        ) : (
          <p className="text-muted">
            {strings.loadingSpeechModel}{' '}
            {ptt.status.kind === 'loading' && `${Math.round(ptt.status.progress * 100)}%`}
          </p>
        )}
      </section>

      <VoiceSettings language={language} strings={strings} caps={caps} onChange={refreshStorage} />
    </main>
  );
}
