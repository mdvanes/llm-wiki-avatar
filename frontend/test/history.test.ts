import { describe, expect, it } from 'vitest';
import {
  type Conversation,
  HISTORY_KEY,
  MAX_CONVERSATIONS,
  type TranscriptEntry,
  conversationTitle,
  deleteConversation,
  groupHistory,
  isWorthSaving,
  loadHistory,
  mergeEntries,
  restorePayload,
  saveConversation,
} from '@/lib/history';

class MemoryStore {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (value.length > this.quota) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const entry = (id: string, fromUser: boolean, text: string): TranscriptEntry => ({ id, fromUser, text, timestamp: 0 });

function conversation(id: string, updatedAt: number, messages: TranscriptEntry[] = []): Conversation {
  return { id, title: id, language: 'en', startedAt: updatedAt, updatedAt, messages, answers: [] };
}

describe('conversation history storage', () => {
  it('saves, replaces and deletes conversations, newest first', () => {
    const store = new MemoryStore();
    saveConversation(conversation('a', 1), store);
    saveConversation(conversation('b', 2), store);
    expect(loadHistory(store).map((c) => c.id)).toEqual(['b', 'a']);

    saveConversation({ ...conversation('a', 3), title: 'updated' }, store);
    expect(loadHistory(store).map((c) => [c.id, c.title])).toEqual([
      ['a', 'updated'],
      ['b', 'b'],
    ]);

    expect(deleteConversation('a', store).map((c) => c.id)).toEqual(['b']);
    expect(loadHistory(store).map((c) => c.id)).toEqual(['b']);
  });

  it('keeps at most MAX_CONVERSATIONS and drops the oldest when storage is full', () => {
    const store = new MemoryStore();
    for (let i = 0; i < MAX_CONVERSATIONS + 3; i++) saveConversation(conversation(`c${i}`, i), store);
    const kept = loadHistory(store);
    expect(kept).toHaveLength(MAX_CONVERSATIONS);
    expect(kept.at(-1)!.id).toBe('c3');

    store.quota = store.getItem(HISTORY_KEY)!.length;
    saveConversation(conversation('new', 1000), store);
    const afterQuota = loadHistory(store);
    expect(afterQuota[0]!.id).toBe('new');
    expect(afterQuota.some((c) => c.id === 'c3')).toBe(false);
  });

  it('ignores corrupt storage', () => {
    const store = new MemoryStore();
    store.setItem(HISTORY_KEY, '{not json');
    expect(loadHistory(store)).toEqual([]);
    store.setItem(HISTORY_KEY, JSON.stringify([{ id: 1 }, conversation('ok', 1)]));
    expect(loadHistory(store).map((c) => c.id)).toEqual(['ok']);
  });
});

describe('conversation helpers', () => {
  it('titles a conversation after the first user message', () => {
    expect(conversationTitle([entry('1', false, 'Hi!'), entry('2', true, '  How are\nwebhooks retried? ')])).toBe(
      'How are webhooks retried?',
    );
    expect(conversationTitle([entry('1', true, 'x'.repeat(100))])).toHaveLength(60);
    expect(conversationTitle([entry('1', false, 'Hi!')])).toBe('');
  });

  it('only saves conversations where the user said something', () => {
    expect(isWorthSaving([entry('1', false, 'Hi!')])).toBe(false);
    expect(isWorthSaving([entry('1', false, 'Hi!'), entry('2', true, 'Hello')])).toBe(true);
  });

  it('merges streamed entries by id', () => {
    const merged = mergeEntries([entry('1', true, 'old'), entry('2', false, 'partial')], [entry('2', false, 'full')]);
    expect(merged.map((m) => m.text)).toEqual(['old', 'full']);
  });

  it('groups by today, yesterday, previous 7 days and month', () => {
    const now = new Date(2026, 8, 29, 10).getTime();
    const at = (month: number, day: number) => new Date(2026, month, day, 9).getTime();
    const groups = groupHistory(
      [
        conversation('today', at(8, 29)),
        conversation('yesterday', at(8, 28)),
        conversation('week', at(8, 24)),
        conversation('aug1', at(7, 20)),
        conversation('aug2', at(7, 2)),
        conversation('july', at(6, 1)),
      ],
      now,
    );
    expect(groups.map((g) => [g.key, g.conversations.map((c) => c.id)])).toEqual([
      ['today', ['today']],
      ['yesterday', ['yesterday']],
      ['week', ['week']],
      ['2026-7', ['aug1', 'aug2']],
      ['2026-6', ['july']],
    ]);
  });

  it('sends the latest turns that fit in the restore payload', () => {
    const c = conversation('c', 1, [
      entry('1', true, 'first question'),
      entry('2', false, 'a'.repeat(200)),
      entry('3', true, 'latest question'),
      entry('4', false, ''),
    ]);
    expect(JSON.parse(restorePayload(c))).toEqual([
      { role: 'user', text: 'first question' },
      { role: 'assistant', text: 'a'.repeat(200) },
      { role: 'user', text: 'latest question' },
    ]);
    expect(JSON.parse(restorePayload(c, 100))).toEqual([{ role: 'user', text: 'latest question' }]);
  });
});
