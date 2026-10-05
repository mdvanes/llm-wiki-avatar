'use client';

import { useCallback, useEffect, useRef } from 'react';
import { FaceAnimator, type FacePose, NEUTRAL_FACE } from '@/lib/cartoon/face';
import { LipSync, brightness, rms } from '@/lib/lipsync';
import type { Lipsync, Mood } from '@/lib/protocol';
import { ipaToVisemes } from '@/lib/tts/visemes';
import { REST, type VisemeShape, WordLipSync, type WordSource } from '@/lib/wordLipsync';

export interface MoodEvent {
  mood: Mood;
  /** Increments per event so the same mood twice still counts as a new event. */
  seq: number;
}

export interface AvatarDriverInput {
  audioTrack?: MediaStreamTrack;
  mood?: MoodEvent;
  /** `words`: follow the word timings of the speech, falling back to loudness where there are none. */
  lipsync?: Lipsync;
  /** Word timings of the speech, for the `words` lip-sync. */
  words?: WordSource;
}

export interface AvatarFrame {
  pose: FacePose;
  shape: VisemeShape;
}

/** Audio analysis chain for the voice; not connected to the speakers (the speech player plays it). */
class VoiceAnalyser {
  readonly ctx = new AudioContext();
  readonly #analyser: AnalyserNode;
  readonly #source: MediaStreamAudioSourceNode;
  readonly #time: Float32Array<ArrayBuffer>;
  readonly #freq: Uint8Array<ArrayBuffer>;

  constructor(track: MediaStreamTrack) {
    this.#source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.#analyser = this.ctx.createAnalyser();
    this.#analyser.fftSize = 1024;
    this.#analyser.smoothingTimeConstant = 0.2;
    this.#source.connect(this.#analyser);
    this.#time = new Float32Array(this.#analyser.fftSize);
    this.#freq = new Uint8Array(this.#analyser.frequencyBinCount);
    void this.ctx.resume().catch(() => {});
  }

  sample(): { level: number; tone: number } {
    this.#analyser.getFloatTimeDomainData(this.#time);
    this.#analyser.getByteFrequencyData(this.#freq);
    return { level: rms(this.#time), tone: brightness(this.#freq, this.ctx.sampleRate) };
  }

  close(): void {
    this.#source.disconnect();
    void this.ctx.close().catch(() => {});
  }
}

/**
 * What every avatar does apart from drawing: lip-sync to the agent's voice (by loudness or word timings) and a face
 * that reacts to the mood and the agent's state. Returns a stable function to call once per animation frame.
 */
export function useAvatarDriver({ audioTrack, mood, lipsync = 'audio', words: wordSource }: AvatarDriverInput) {
  const analyserRef = useRef<VoiceAnalyser | null>(null);
  const loudness = useRef(new LipSync());
  const words = useRef<WordLipSync | null>(null);
  const face = useRef<FaceAnimator | null>(null);
  const live = useRef(lipsync);
  live.current = lipsync;

  // Declared before the mood effect, so the face exists when the first mood arrives.
  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    face.current = new FaceAnimator({ motion: reducedMotion ? 0.3 : 1 });
    return () => {
      face.current = null;
    };
  }, []);

  // Moods from the agent's [mood:x] tags.
  useEffect(() => {
    if (mood) face.current?.setMood(mood.mood, performance.now());
  }, [mood]);

  // Follow the agent's audio track for lip-sync.
  useEffect(() => {
    if (!audioTrack) return;
    const analyser = new VoiceAnalyser(audioTrack);
    analyserRef.current = analyser;
    return () => {
      analyserRef.current = null;
      loudness.current.reset();
      words.current?.clear();
      analyser.close();
    };
  }, [audioTrack]);

  useEffect(() => {
    if (lipsync !== 'words') {
      words.current?.clear();
      return;
    }
    words.current ??= new WordLipSync(ipaToVisemes);
  }, [lipsync]);
  useEffect(
    () =>
      wordSource?.subscribe((event) => {
        if (!event) words.current?.clear();
        else if (live.current === 'words') words.current?.add(event.segment, performance.now(), event.startsAt);
      }),
    [wordSource],
  );

  return useCallback((now: number, dt: number, state: string): AvatarFrame => {
    let shape = REST;
    let level = 0;
    const analyser = analyserRef.current;
    if (analyser) {
      const sample = analyser.sample();
      // Keep the loudness lip-sync running, so it can take over smoothly where there are no word timings.
      const byLoudness = loudness.current.update(sample.level, sample.tone, dt);
      const byWords = live.current === 'words' ? words.current?.update(now, sample.level, dt) : null;
      shape = byWords ?? { ...REST, ...byLoudness };
      level = loudness.current.level;
    }
    const pose = face.current?.update(now, dt, { state, level }) ?? NEUTRAL_FACE;
    return { pose, shape };
  }, []);
}
