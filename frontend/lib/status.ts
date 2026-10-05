/** Where push-to-talk is with the user's speech: held down, or being transcribed in the browser. */
export type SpeechState = 'idle' | 'hearing' | 'transcribing';

/** What the conversation is doing, as shown to the user. */
export type Phase = 'waiting' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking';

/**
 * The agent's state as the user experiences it when the browser speaks the replies: the agent only writes, so it is
 * "speaking" while the voice plays, and still "thinking" while text waits for the voice.
 */
export function voicedAgentState(agentState: string, player: 'idle' | 'preparing' | 'playing'): string {
  if (agentState !== 'listening' && agentState !== 'thinking' && agentState !== 'speaking') return agentState;
  if (player === 'playing') return 'speaking';
  if (player === 'preparing' || agentState === 'speaking') return 'thinking';
  return agentState;
}

/** The user's speech takes precedence, so they can see it was picked up even while the agent is still talking. */
export function conversationPhase(agentState: string, speech: SpeechState): Phase {
  const connected = agentState === 'listening' || agentState === 'thinking' || agentState === 'speaking';
  if (!connected) return 'waiting';
  if (speech === 'hearing') return 'hearing';
  if (speech === 'transcribing') return 'transcribing';
  return agentState as Phase;
}

/** Phases where the user is waiting on the system, worth an elapsed-time counter. */
export function isProcessing(phase: Phase): boolean {
  return phase === 'transcribing' || phase === 'thinking';
}

/** How long "transcribing" stays visible after the transcript arrives, until the agent starts thinking. */
export const TRANSCRIPT_GRACE_MS = 1500;

/**
 * Between the transcript and the agent's "thinking" state there is a short gap (sending the transcript, the agent
 * picking it up). Returns true when that gap should keep showing the previous phase instead of "listening".
 */
export function holdsPrevious(previous: Phase, next: Phase): boolean {
  return previous === 'transcribing' && next === 'listening';
}
