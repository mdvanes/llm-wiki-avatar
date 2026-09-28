// Minimal typings for the parts of TalkingHead (https://github.com/met4citizen/TalkingHead) we use.
declare module '@met4citizen/talkinghead' {
  export type TalkingHeadMood = 'neutral' | 'happy' | 'angry' | 'sad' | 'fear' | 'disgust' | 'love' | 'sleep';
  export type TalkingHeadGesture =
    | 'handup'
    | 'index'
    | 'ok'
    | 'thumbup'
    | 'thumbdown'
    | 'side'
    | 'shrug'
    | 'namaste';

  export interface TalkingHeadOptions {
    lipsyncModules?: string[];
    lipsyncLang?: string;
    cameraView?: 'full' | 'mid' | 'upper' | 'head';
    cameraX?: number;
    cameraY?: number;
    cameraDistance?: number;
    cameraRotateEnable?: boolean;
    cameraPanEnable?: boolean;
    cameraZoomEnable?: boolean;
    modelFPS?: number;
    modelPixelRatio?: number;
    avatarMood?: TalkingHeadMood;
    avatarIdleEyeContact?: number;
    avatarIdleHeadMove?: number;
    avatarSpeakingEyeContact?: number;
    avatarSpeakingHeadMove?: number;
    lightAmbientIntensity?: number;
    lightDirectIntensity?: number;
    /** Called every animation frame, before morph targets are applied. */
    update?: ((dtMs: number) => void) | null;
    [key: string]: unknown;
  }

  export interface AvatarConfig {
    url: string;
    body?: 'M' | 'F';
    avatarMood?: TalkingHeadMood;
    lipsyncLang?: string;
    [key: string]: unknown;
  }

  export class TalkingHead {
    constructor(node: HTMLElement, opt?: TalkingHeadOptions);
    showAvatar(avatar: AvatarConfig, onprogress?: ((ev: ProgressEvent) => void) | null): Promise<void>;
    setMood(mood: TalkingHeadMood): void;
    setValue(mt: string, value: number, ms?: number | null): void;
    getValue(mt: string): number | undefined;
    playGesture(name: TalkingHeadGesture, dur?: number, mirror?: boolean, ms?: number): void;
    stopGesture(ms?: number): void;
    speakWithHands(delay?: number, prob?: number): void;
    lookAtCamera(t: number): void;
    makeEyeContact(t: number): void;
    lookAhead(t: number): void;
    setView(view: 'full' | 'mid' | 'upper' | 'head', opt?: Record<string, unknown>): void;
    start(): void;
    stop(): void;
    dispose(): void;
  }
}
