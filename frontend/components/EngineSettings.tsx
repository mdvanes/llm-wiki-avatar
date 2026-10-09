'use client';

import { useEffect, useState } from 'react';
import { useWebSpeechInput } from '@/hooks/useWebSpeechInput';
import type { Language, STRINGS } from '@/lib/language';
import {
  type Engine,
  type EngineKind,
  browserSupports,
  loadWebVoice,
  saveEngine,
  saveWebVoice,
} from '@/lib/speech/engine';
import { pickVoice, speechLang } from '@/lib/speech/webSpeech';
import { SAMPLE_TEXT } from '@/lib/tts/voices';
import { MicButton } from './MicButton';

type Strings = (typeof STRINGS)['en'];

interface Props {
  language: Language;
  strings: Strings;
  input: Engine;
  output: Engine;
  onChange: (kind: EngineKind, engine: Engine) => void;
}

function EngineChoice({
  kind,
  title,
  note,
  value,
  strings,
  onChange,
}: {
  kind: EngineKind;
  title: string;
  note: string;
  value: Engine;
  strings: Strings;
  onChange: (kind: EngineKind, engine: Engine) => void;
}) {
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(browserSupports(kind)), [kind]);
  const options: [Engine, string, boolean][] = [
    ['device', strings.engineDevice, true],
    ['browser', strings.engineBrowser, supported],
  ];
  return (
    <fieldset className="rounded-xl border border-border bg-panel p-4 text-sm">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      {options.map(([engine, label, enabled]) => (
        <label key={engine} className={`flex items-center gap-2 py-1 ${enabled ? '' : 'opacity-50'}`}>
          <input
            type="radio"
            name={`engine-${kind}`}
            checked={value === engine}
            disabled={!enabled}
            onChange={() => {
              saveEngine(kind, engine);
              onChange(kind, engine);
            }}
            className="accent-accent"
          />
          <span>
            {label}
            {!enabled && <span className="text-xs text-muted"> – {strings.engineUnsupported}</span>}
          </span>
        </label>
      ))}
      {value === 'browser' && <p className="mt-1 text-xs text-muted">{note}</p>}
    </fieldset>
  );
}

function WebVoicePicker({ language, strings }: { language: Language; strings: Strings }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const lang = speechLang(language);

  useEffect(() => {
    setChosen(loadWebVoice(language));
    const read = () => setVoices(speechSynthesis.getVoices());
    read();
    speechSynthesis.addEventListener('voiceschanged', read);
    return () => speechSynthesis.removeEventListener('voiceschanged', read);
  }, [language]);

  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));

  const preview = () => {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(SAMPLE_TEXT[language]);
    utterance.lang = lang;
    const voice = pickVoice(voices, lang, chosen);
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2">
        <span className="text-muted">{strings.engineVoice}</span>
        <select
          value={chosen ?? ''}
          disabled={matching.length === 0}
          onChange={(e) => {
            const next = e.target.value || null;
            setChosen(next);
            saveWebVoice(language, next);
          }}
          className="max-w-full rounded-lg border border-border bg-panel-2 px-2 py-1"
        >
          <option value="">{matching.length === 0 ? strings.engineVoiceNone : strings.engineVoiceDefault}</option>
          {matching.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={preview}
        className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted hover:border-accent hover:text-accent"
      >
        {strings.enginePreview}
      </button>
    </div>
  );
}

function InputTry({ language, strings }: { language: Language; strings: Strings }) {
  const [heard, setHeard] = useState<{ text: string; ms: number }>();
  const ptt = useWebSpeechInput({
    enabled: true,
    language,
    onResult: (text, ms) => text && setHeard({ text, ms }),
  });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <MicButton ptt={ptt} strings={strings} />
      <span className="text-xs text-muted">
        {strings.engineTry}
        {ptt.interim && `: ${ptt.interim}`}
      </span>
      {heard && (
        <span className="text-xs">
          {strings.engineHeard}: “{heard.text}” ({Math.round(heard.ms)} ms)
        </span>
      )}
      {ptt.error && <span className="text-xs text-danger">{ptt.error}</span>}
    </div>
  );
}

/** Chooses between the on-device models and the browser's Web Speech API for listening and speaking. */
export function EngineSettings({ language, strings, input, output, onChange }: Props) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="engines">
      <div>
        <h2 id="engines" className="text-lg font-semibold">
          {strings.engineTitle}
        </h2>
        <p className="mt-1 text-xs text-muted">{strings.engineIntro}</p>
      </div>
      <div>
        <EngineChoice
          kind="input"
          title={strings.engineInput}
          note={strings.engineInputNote}
          value={input}
          strings={strings}
          onChange={onChange}
        />
        {input === 'browser' && <InputTry language={language} strings={strings} />}
      </div>
      <div>
        <EngineChoice
          kind="output"
          title={strings.engineOutput}
          note={strings.engineOutputNote}
          value={output}
          strings={strings}
          onChange={onChange}
        />
        {output === 'browser' && <WebVoicePicker language={language} strings={strings} />}
      </div>
    </section>
  );
}
