import { describe, expect, it } from 'vitest';
import { conversationPhase, holdsPrevious, isProcessing } from '@/lib/status';

describe('conversationPhase', () => {
  it('waits until the agent is connected', () => {
    expect(conversationPhase('connecting', 'hearing')).toBe('waiting');
    expect(conversationPhase('initializing', 'idle')).toBe('waiting');
  });
  it('shows the user speech state before the agent state', () => {
    expect(conversationPhase('listening', 'hearing')).toBe('hearing');
    expect(conversationPhase('speaking', 'hearing')).toBe('hearing');
    expect(conversationPhase('listening', 'transcribing')).toBe('transcribing');
  });
  it('falls back to the agent state', () => {
    expect(conversationPhase('listening', 'idle')).toBe('listening');
    expect(conversationPhase('thinking', 'idle')).toBe('thinking');
    expect(conversationPhase('speaking', 'idle')).toBe('speaking');
  });
  it('counts time only while the user waits', () => {
    expect(isProcessing('transcribing')).toBe(true);
    expect(isProcessing('thinking')).toBe(true);
    expect(isProcessing('hearing')).toBe(false);
  });
});

describe('holdsPrevious', () => {
  it('bridges only the gap from transcribing to listening', () => {
    expect(holdsPrevious('transcribing', 'listening')).toBe(true);
    expect(holdsPrevious('transcribing', 'thinking')).toBe(false);
    expect(holdsPrevious('hearing', 'listening')).toBe(false);
  });
});
