import { describe, expect, it } from 'vitest';
import type { TranscriptEntry } from '@/lib/history';
import { type FullReply, stopTarget, withFullReplies } from '@/lib/reply';

const user = (id: string, text: string, timestamp: number): TranscriptEntry => ({ id, fromUser: true, text, timestamp });
const agent = (id: string, text: string, timestamp: number): TranscriptEntry => ({ id, fromUser: false, text, timestamp });
const reply = (id: string, target: string, text: string, timestamp: number): FullReply => ({ id, target, text, timestamp });

describe('stopTarget', () => {
  it('is the agent message being spoken', () => {
    expect(stopTarget([user('u1', 'hi', 1), agent('a1', 'Hello', 2)])).toBe('a1');
  });

  it('is empty when the reply has no transcript yet', () => {
    expect(stopTarget([agent('a1', 'Hello', 1), user('u1', 'why?', 2)])).toBe('');
    expect(stopTarget([])).toBe('');
  });
});

describe('withFullReplies', () => {
  const entries = [agent('a0', 'Welcome', 1), user('u1', 'hi', 2), agent('a1', 'Hello the', 3), user('u2', 'ok', 5)];

  it('replaces the cut-off message with the full reply', () => {
    const out = withFullReplies(entries, [reply('r1', 'a1', 'Hello there, how are you?', 4)]);
    expect(out.map((e) => e.text)).toEqual(['Welcome', 'hi', 'Hello there, how are you?', 'ok']);
    expect(out[2]!.id).toBe('a1');
  });

  it('keeps the transcript until the reply has text', () => {
    expect(withFullReplies(entries, [reply('r1', 'a1', '', 4)])).toEqual(entries);
  });

  it('never replaces user messages', () => {
    expect(withFullReplies(entries, [reply('r1', 'u1', 'nope', 4)])[1]!.text).toBe('hi');
  });

  it('adds a reply without a transcript message in time order', () => {
    const out = withFullReplies(entries, [reply('r1', '', 'Unheard reply', 4)]);
    expect(out.map((e) => e.id)).toEqual(['a0', 'u1', 'a1', 'r1', 'u2']);
    expect(out[3]).toMatchObject({ fromUser: false, text: 'Unheard reply' });
  });
});
