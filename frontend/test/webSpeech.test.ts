import { describe, expect, it } from 'vitest';
import {
  MAX_RESTART_MS,
  classifyError,
  pickVoice,
  readResults,
  restartDelay,
  speechLang,
} from '@/lib/speech/webSpeech';

const result = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal });

describe('web speech helpers', () => {
  it('maps languages', () => {
    expect(speechLang('en')).toBe('en-US');
    expect(speechLang('nl')).toBe('nl-NL');
  });

  it('classifies errors', () => {
    expect(classifyError('no-speech')).toBe('ignore');
    expect(classifyError('aborted')).toBe('ignore');
    expect(classifyError('not-allowed')).toBe('fatal');
    expect(classifyError('network')).toBe('network');
  });

  it('backs off restarts up to a maximum', () => {
    expect(restartDelay(0)).toBeLessThan(restartDelay(2));
    expect(restartDelay(50)).toBe(MAX_RESTART_MS);
  });

  it('splits final and interim results', () => {
    const event = { resultIndex: 0, results: Object.assign([result('hello ', true), result('wor', false)], {}) };
    expect(readResults(event)).toEqual({ final: 'hello', interim: 'wor' });
  });

  it('picks the chosen voice, else a local voice of the language', () => {
    const voices = [
      { voiceURI: 'a', lang: 'en-GB', localService: false },
      { voiceURI: 'b', lang: 'en_US', localService: true },
      { voiceURI: 'c', lang: 'nl-NL', localService: true },
    ];
    expect(pickVoice(voices, 'en-US', 'a')?.voiceURI).toBe('a');
    expect(pickVoice(voices, 'en-US')?.voiceURI).toBe('b');
    expect(pickVoice(voices, 'nl-NL')?.voiceURI).toBe('c');
    expect(pickVoice(voices, 'de-DE')).toBeUndefined();
  });
});
