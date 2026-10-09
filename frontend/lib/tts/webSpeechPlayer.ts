import type { WordListener } from '@/lib/wordLipsync';
import { pickVoice } from '@/lib/speech/webSpeech';
import type { PlayerState } from './player';
import type { Speaker, SpokenItem } from './speaker';

export interface WebSpeechEvents<M> {
  onSentence?: (sentence: { text: string; meta?: M }) => void;
  onState?: (state: PlayerState) => void;
  onError?: (err: unknown) => void;
  /** Time from `enqueue` to the first sound, in ms. */
  onLatency?: (ms: number) => void;
}

/**
 * Speaks with the browser's voices (`speechSynthesis`): no download and almost no delay. The browser plays the audio
 * itself, so the avatar gets a stand-in `track` that pulses while speaking instead of the voice.
 */
export class WebSpeechPlayer<M = unknown> implements Speaker<M> {
  readonly track: MediaStreamTrack;
  readonly #context = new AudioContext();
  readonly #gain = this.#context.createGain();
  readonly #events: WebSpeechEvents<M>;
  #lang = 'en-US';
  #voiceURI: string | null = null;
  #pending = 0;
  #speaking = false;
  #state: PlayerState = 'idle';
  #epoch = 0;
  #queuedAt = 0;
  #pulse: ReturnType<typeof setInterval> | undefined;

  constructor(events: WebSpeechEvents<M> = {}) {
    this.#events = events;
    const oscillator = this.#context.createOscillator();
    const stream = this.#context.createMediaStreamDestination();
    this.#gain.gain.value = 0;
    oscillator.connect(this.#gain);
    this.#gain.connect(stream);
    oscillator.start();
    this.track = stream.stream.getAudioTracks()[0]!;
  }

  get state(): PlayerState {
    return this.#state;
  }

  setVoice(lang: string, voiceURI: string | null): void {
    this.#lang = lang;
    this.#voiceURI = voiceURI;
  }

  subscribe(_listener: WordListener): () => void {
    // The browser's word boundaries are not reliable on Android; the avatar falls back to loudness.
    return () => {};
  }

  enqueue(items: SpokenItem<M>[]): void {
    if (items.length === 0) return;
    void this.#context.resume();
    const epoch = this.#epoch;
    if (this.#pending === 0) this.#queuedAt = performance.now();
    for (const item of items) {
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.lang = this.#lang;
      const voice = pickVoice(speechSynthesis.getVoices(), this.#lang, this.#voiceURI);
      if (voice) utterance.voice = voice;
      this.#pending++;
      utterance.onstart = () => {
        if (epoch !== this.#epoch) return;
        if (!this.#speaking) this.#events.onLatency?.(performance.now() - this.#queuedAt);
        this.#setSpeaking(true);
        this.#events.onSentence?.({ text: item.text, meta: item.meta });
      };
      utterance.onend = () => this.#done(epoch);
      utterance.onerror = (event) => {
        this.#done(epoch);
        if (event.error !== 'canceled' && event.error !== 'interrupted') this.#events.onError?.(event.error);
      };
      speechSynthesis.speak(utterance);
    }
    this.#update();
  }

  stop(): void {
    this.#epoch++;
    this.#pending = 0;
    this.#setSpeaking(false);
    speechSynthesis.cancel();
    this.#update();
  }

  close(): void {
    this.stop();
    this.track.stop();
    void this.#context.close();
  }

  #done(epoch: number): void {
    if (epoch !== this.#epoch) return;
    this.#pending = Math.max(0, this.#pending - 1);
    if (this.#pending === 0) this.#setSpeaking(false);
    this.#update();
  }

  #setSpeaking(on: boolean): void {
    this.#speaking = on;
    if (on && !this.#pulse) {
      this.#pulse = setInterval(() => {
        const level = 0.15 + 0.6 * Math.abs(Math.sin(performance.now() / 90)) * (0.5 + Math.random() / 2);
        this.#gain.gain.setTargetAtTime(level, this.#context.currentTime, 0.02);
      }, 60);
    } else if (!on && this.#pulse) {
      clearInterval(this.#pulse);
      this.#pulse = undefined;
      this.#gain.gain.setTargetAtTime(0, this.#context.currentTime, 0.03);
    }
    this.#update();
  }

  #update(): void {
    const state: PlayerState = this.#speaking ? 'playing' : this.#pending > 0 ? 'preparing' : 'idle';
    if (state === this.#state) return;
    this.#state = state;
    this.#events.onState?.(state);
  }
}
