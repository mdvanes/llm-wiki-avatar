import type { TranscriptEntry } from './history';

/** The complete text of a reply whose speech the user stopped (see agent/src/replyCapture.ts). */
export interface FullReply {
  id: string;
  /** Transcript message the reply belongs to; empty if none was showing yet. */
  target: string;
  text: string;
  timestamp: number;
}

/** The agent message being spoken: the last one, if it came after the user's last message. */
export function stopTarget(entries: TranscriptEntry[]): string {
  const last = entries.at(-1);
  return last && !last.fromUser ? last.id : '';
}

/**
 * Puts the full text of stopped replies in place of the transcript messages that were cut off with the voice.
 * A reply without a (known) target is added as a message of its own.
 */
export function withFullReplies(entries: TranscriptEntry[], replies: FullReply[]): TranscriptEntry[] {
  if (replies.length === 0) return entries;
  const byTarget = new Map(replies.filter((r) => r.target).map((r) => [r.target, r]));
  const merged = entries.map((e) => {
    const reply = !e.fromUser && byTarget.get(e.id);
    return reply && reply.text ? { ...e, text: reply.text } : e;
  });
  const ids = new Set(entries.map((e) => e.id));
  for (const r of replies) {
    if (!r.text || ids.has(r.target)) continue;
    const at = merged.findIndex((e) => e.timestamp > r.timestamp);
    const entry = { id: r.id, fromUser: false, text: r.text, timestamp: r.timestamp };
    if (at < 0) merged.push(entry);
    else merged.splice(at, 0, entry);
  }
  return merged;
}
