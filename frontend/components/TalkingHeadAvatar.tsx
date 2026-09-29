'use client';

import type { TalkingHead as TalkingHeadType, TalkingHeadMood } from '@met4citizen/talkinghead';
import type { AgentState } from '@livekit/components-react';
import { useEffect, useRef, useState } from 'react';
import { CLOSED, LipSync, type MouthShape, brightness, rms } from '@/lib/lipsync';
import type { Mood } from '@/lib/protocol';
import type { AvatarConfig } from '@/lib/server-config';
import {
  calmAvatar,
  eyeLevelCameraY,
  eyePitchToCamera,
  headPitchCorrection,
  type TalkingHeadInternals,
} from '@/lib/avatar-calm';

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
  avatar: AvatarConfig;
  audioTrack?: MediaStreamTrack;
  agentState: AgentState;
  mood?: MoodEvent;
  className?: string;
}

/** Moves the (level) camera to the avatar's eye height, so looking straight ahead is looking at the viewer. */
function frameAtEyeLevel(head: TalkingHeadType, avatar: AvatarConfig): void {
  const h = head as unknown as {
    objectLeftEye?: THREEObject;
    objectRightEye?: THREEObject;
    avatarHeight?: number;
    camera?: { fov: number };
    cameraClock: number | null;
    opt: { cameraY: number };
  };
  if (!h.objectLeftEye || !h.objectRightEye || !h.avatarHeight || !h.camera) return;
  h.objectLeftEye.updateMatrixWorld(true);
  h.objectRightEye.updateMatrixWorld(true);
  const eyeY = (h.objectLeftEye.matrixWorld.elements[13] + h.objectRightEye.matrixWorld.elements[13]) / 2;
  const cameraY = eyeLevelCameraY({
    view: avatar.view,
    eyeY,
    avatarHeight: h.avatarHeight,
    fovDeg: h.camera.fov,
    cameraDistance: avatar.cameraDistance,
  });
  h.opt.cameraY = cameraY;
  h.cameraClock = null; // jump instead of panning
  head.setView(avatar.view, { cameraY, cameraDistance: avatar.cameraDistance });
}

/**
 * Replaces TalkingHead's vertical eye-contact angle, which is calibrated for one rig (the AvatarSDK sample ends up
 * looking down), with the actual angle between the face direction and the camera. Runs every frame.
 */
function eyeAimer(head: TalkingHeadType): (() => void) | null {
  type Morph = { system: number | null; needsUpdate: boolean };
  const h = head as unknown as {
    armature?: { getObjectByName(name: string): THREEObject | undefined };
    objectLeftEye?: THREEObject;
    objectRightEye?: THREEObject;
    camera?: { position: { y: number; z: number } };
    mtAvatar?: Record<string, Morph | undefined>;
  };
  const bone = h.armature?.getObjectByName('Head');
  const left = h.objectLeftEye;
  const right = h.objectRightEye;
  const down = h.mtAvatar?.eyesLookDown;
  const up = h.mtAvatar?.eyesLookUp;
  const camera = h.camera;
  if (!bone || !left || !right || !down || !up || !camera) return null;
  return () => {
    if (down.system === null && up.system === null) return; // eye contact is off (e.g. a gesture)
    const m = bone.matrixWorld.elements;
    const faceDown = Math.asin(-m[9] / Math.hypot(m[8], m[9], m[10]));
    const l = left.matrixWorld.elements;
    const r = right.matrixWorld.elements;
    const cameraDown = Math.atan2((l[13] + r[13]) / 2 - camera.position.y, camera.position.z - (l[14] + r[14]) / 2);
    const eyes = eyePitchToCamera(faceDown, cameraDown);
    Object.assign(down, { system: eyes.down, needsUpdate: true });
    Object.assign(up, { system: eyes.up, needsUpdate: true });
  };
}

/** Adds a head-pitch baseline for models whose head leans forward at rest. */
function levelHead(head: TalkingHeadType): void {
  const h = head as unknown as {
    armature?: { getObjectByName(name: string): THREEObject | undefined };
    avatar?: { baseline?: Record<string, number> };
    moodName?: string;
  };
  const bone = h.armature?.getObjectByName('Head');
  if (!bone || !h.avatar) return;
  bone.updateMatrixWorld(true);
  const m = bone.matrixWorld.elements;
  const correction = headPitchCorrection({ y: m[5], z: m[6] });
  if (correction === 0) return;
  h.avatar.baseline = { ...h.avatar.baseline, headRotateX: correction };
  head.setMood((h.moodName ?? 'neutral') as TalkingHeadMood);
}

interface THREEObject {
  updateMatrixWorld(force?: boolean): void;
  matrixWorld: { elements: ArrayLike<number> };
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

export function TalkingHeadAvatar({ avatar, audioTrack, agentState, mood, className }: Props) {
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
    let aimEyes: (() => void) | null = null;

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
        const probe = await fetch(avatar.url, { method: 'HEAD' });
        if (!probe.ok) {
          throw new Error(`Avatar model not found at ${avatar.url}. Run "npm run fetch-avatar" first.`);
        }
        const { TalkingHead } = await import('@met4citizen/talkinghead');
        if (disposed) return;
        head = new TalkingHead(node, {
          lipsyncModules: [],
          cameraView: avatar.view,
          cameraY: avatar.cameraY ?? 0,
          cameraDistance: avatar.cameraDistance,
          cameraRotateEnable: false,
          cameraPanEnable: false,
          cameraZoomEnable: false,
          avatarMood: 'neutral',
          avatarIdleEyeContact: 1,
          avatarIdleHeadMove: 0,
          avatarSpeakingEyeContact: 1,
          avatarSpeakingHeadMove: 0,
          update: (dt: number) => {
            aimEyes?.();
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
        await head.showAvatar({ url: avatar.url, body: avatar.body, avatarMood: 'neutral', lipsyncLang: 'en' });
        if (disposed) return;
        calmAvatar(head as unknown as TalkingHeadInternals);
        // Let the straight pose settle before measuring the head.
        await new Promise((r) => setTimeout(r, 1200));
        if (disposed) return;
        levelHead(head);
        if (avatar.cameraY === null) frameAtEyeLevel(head, avatar);
        aimEyes = eyeAimer(head);
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
  }, [avatar.url, avatar.body, avatar.view, avatar.cameraY, avatar.cameraDistance]);

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

  // Look at the user whenever the conversation state changes.
  useEffect(() => {
    const head = headRef.current;
    if (!head || status.state !== 'ready') return;
    head.makeEyeContact(2000);
    if (agentState === 'speaking' && avatar.view === 'upper' && Math.random() < 0.4) head.speakWithHands(300, 0.6);
  }, [agentState, status.state, avatar.view]);

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
