'use client';

import type { TalkingHead as TalkingHeadType, TalkingHeadMood } from '@met4citizen/talkinghead';
import type { AgentState } from '@livekit/components-react';
import { useEffect, useRef, useState } from 'react';
import { CLOSED, LipSync, type MouthShape, brightness, rms } from '@/lib/lipsync';
import type { Mood } from '@/lib/protocol';

export const AVATAR_URL = process.env.NEXT_PUBLIC_AVATAR_URL || '/avatars/mpfb.glb';
const AVATAR_BODY = (process.env.NEXT_PUBLIC_AVATAR_BODY as 'M' | 'F' | undefined) || 'F';

const MOOD_MAP: Record<Mood, TalkingHeadMood> = {
  neutral: 'neutral',
  happy: 'happy',
  sad: 'sad',
  confused: 'neutral',
};

export interface MoodEvent {
  mood: Mood;
  /** Increments per event so the same mood twice still triggers a gesture. */
  seq: number;
}

interface Props {
  audioTrack?: MediaStreamTrack;
  agentState: AgentState;
  mood?: MoodEvent;
  className?: string;
}

/** Audio analysis chain for the agent's voice; not connected to the speakers (RoomAudioRenderer plays it). */
class VoiceAnalyser {
  readonly ctx = new AudioContext();
  readonly analyser: AnalyserNode;
  readonly #source: MediaStreamAudioSourceNode;
  readonly #time: Float32Array<ArrayBuffer>;
  readonly #freq: Uint8Array<ArrayBuffer>;

  constructor(track: MediaStreamTrack) {
    this.#source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.2;
    this.#source.connect(this.analyser);
    this.#time = new Float32Array(this.analyser.fftSize);
    this.#freq = new Uint8Array(this.analyser.frequencyBinCount);
    void this.ctx.resume().catch(() => {});
  }

  sample(): { level: number; tone: number } {
    this.analyser.getFloatTimeDomainData(this.#time);
    this.analyser.getByteFrequencyData(this.#freq);
    return { level: rms(this.#time), tone: brightness(this.#freq, this.ctx.sampleRate) };
  }

  close(): void {
    this.#source.disconnect();
    void this.ctx.close().catch(() => {});
  }
}

export function TalkingHeadAvatar({ audioTrack, agentState, mood, className }: Props) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<TalkingHeadType | null>(null);
  const analyserRef = useRef<VoiceAnalyser | null>(null);
  const lipsync = useRef(new LipSync());
  const lastShape = useRef<MouthShape>(CLOSED);
  const [status, setStatus] = useState<{ state: 'loading' | 'ready' | 'error'; detail?: string }>({
    state: 'loading',
  });

  // Create the avatar once.
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    let disposed = false;
    let head: TalkingHeadType | null = null;

    const applyMouth = (shape: MouthShape) => {
      const prev = lastShape.current;
      for (const key of Object.keys(shape) as (keyof MouthShape)[]) {
        if (Math.abs(shape[key] - prev[key]) > 0.005 || (shape[key] === 0 && prev[key] !== 0)) {
          head?.setValue(key, shape[key]);
        }
      }
      lastShape.current = shape;
    };

    (async () => {
      try {
        const probe = await fetch(AVATAR_URL, { method: 'HEAD' });
        if (!probe.ok) {
          throw new Error(`Avatar model not found at ${AVATAR_URL}. Run "npm run fetch-avatar" first.`);
        }
        const { TalkingHead } = await import('@met4citizen/talkinghead');
        if (disposed) return;
        head = new TalkingHead(node, {
          lipsyncModules: [],
          cameraView: 'upper',
          // Shift the avatar up: the default framing leaves the top third of a tall panel empty.
          cameraY: 0.4,
          cameraRotateEnable: false,
          avatarMood: 'neutral',
          avatarIdleEyeContact: 0.3,
          avatarSpeakingEyeContact: 0.6,
          update: (dt: number) => {
            const analyser = analyserRef.current;
            if (!analyser) {
              if (lastShape.current !== CLOSED) applyMouth(CLOSED);
              return;
            }
            const { level, tone } = analyser.sample();
            applyMouth(lipsync.current.update(level, tone, dt));
          },
        });
        headRef.current = head;
        await head.showAvatar({ url: AVATAR_URL, body: AVATAR_BODY, avatarMood: 'neutral', lipsyncLang: 'en' });
        if (disposed) return;
        setStatus({ state: 'ready' });
      } catch (err) {
        if (!disposed) setStatus({ state: 'error', detail: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      disposed = true;
      headRef.current = null;
      try {
        head?.stop();
        head?.dispose();
      } catch {
        // The avatar may not have finished loading.
      }
      node.replaceChildren();
    };
  }, []);

  // Follow the agent's audio track for lip-sync.
  useEffect(() => {
    if (!audioTrack) return;
    const analyser = new VoiceAnalyser(audioTrack);
    analyserRef.current = analyser;
    return () => {
      analyserRef.current = null;
      lipsync.current.reset();
      analyser.close();
    };
  }, [audioTrack]);

  // Moods from the agent's [mood:x] tags.
  useEffect(() => {
    const head = headRef.current;
    if (!head || !mood || status.state !== 'ready') return;
    try {
      head.setMood(MOOD_MAP[mood.mood]);
      if (mood.mood === 'confused') head.playGesture('shrug', 2);
    } catch {
      // Unknown mood or avatar not ready: keep the current face.
    }
  }, [mood, status.state]);

  // Idle behaviour per agent state.
  useEffect(() => {
    const head = headRef.current;
    if (!head || status.state !== 'ready') return;
    if (agentState === 'listening') head.makeEyeContact(1500);
    else if (agentState === 'thinking') head.lookAhead(1200);
    else if (agentState === 'speaking') {
      head.lookAtCamera(600);
      if (Math.random() < 0.4) head.speakWithHands(300, 0.6);
    }
  }, [agentState, status.state]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={nodeRef} className="absolute inset-0" />
      {status.state === 'loading' && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted">Loading avatar…</div>
      )}
      {status.state === 'error' && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
          <p>
            Avatar unavailable.
            <br />
            <span className="text-xs">{status.detail}</span>
          </p>
        </div>
      )}
    </div>
  );
}
