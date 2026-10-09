import type { WordSource } from '@/lib/wordLipsync';
import type { PlayerState } from './player';

export interface SpokenItem<M> {
  text: string;
  meta?: M;
}

/** What the reply speech needs from a voice: the on-device `SpeechPlayer` and the browser's `WebSpeechPlayer` both fit. */
export interface Speaker<M = unknown> extends WordSource {
  readonly state: PlayerState;
  /** The voice as a track, for the avatar's lip-sync. */
  readonly track: MediaStreamTrack;
  enqueue(items: SpokenItem<M>[]): void;
  stop(): void;
  close(): void;
}
