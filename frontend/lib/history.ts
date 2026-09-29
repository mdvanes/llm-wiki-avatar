import type { Source } from './protocol';

/** A transcript line: what the user said or typed, or what the agent said. */
export interface TranscriptEntry {
  id: string;
  fromUser: boolean;
  text: string;
  timestamp: number;
}

export interface SavedAnswer {
  id: string;
  markdown: string;
  sources: Source[];
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  language: string;
  startedAt: number;
  updatedAt: number;
  messages: TranscriptEntry[];
  answers: SavedAnswer[];
}

export const HISTORY_KEY = 'llm-wiki-avatar.history';
export const MAX_CONVERSATIONS = 50;
const TITLE_CHARS = 60;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStore(): Store | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function isConversation(value: unknown): value is Conversation {
  const c = value as Conversation;
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.updatedAt === 'number' &&
    Array.isArray(c.messages) &&
    Array.isArray(c.answers)
  );
}

/** Saved conversations, most recently updated first. */
export function loadHistory(store: Store | undefined = browserStore()): Conversation[] {
  const raw = store?.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isConversation).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

function write(store: Store, conversations: Conversation[]): Conversation[] {
  let kept = conversations.slice(0, MAX_CONVERSATIONS);
  // When storage is full, drop the oldest conversations until it fits.
  while (kept.length > 0) {
    try {
      store.setItem(HISTORY_KEY, JSON.stringify(kept));
      return kept;
    } catch {
      kept = kept.slice(0, -1);
    }
  }
  store.removeItem(HISTORY_KEY);
  return [];
}

/** Inserts or replaces a conversation; returns the new history. */
export function saveConversation(
  conversation: Conversation,
  store: Store | undefined = browserStore(),
): Conversation[] {
  if (!store) return [conversation];
  const others = loadHistory(store).filter((c) => c.id !== conversation.id);
  return write(
    store,
    [conversation, ...others].sort((a, b) => b.updatedAt - a.updatedAt),
  );
}

export function deleteConversation(id: string, store: Store | undefined = browserStore()): Conversation[] {
  if (!store) return [];
  return write(
    store,
    loadHistory(store).filter((c) => c.id !== id),
  );
}

export function clearHistory(store: Store | undefined = browserStore()): void {
  store?.removeItem(HISTORY_KEY);
}

/** The first thing the user asked, shortened; empty when the user has not said anything yet. */
export function conversationTitle(messages: TranscriptEntry[]): string {
  const first =
    messages
      .find((m) => m.fromUser && m.text.trim())
      ?.text.trim()
      .replace(/\s+/g, ' ') ?? '';
  return first.length > TITLE_CHARS ? `${first.slice(0, TITLE_CHARS - 1).trimEnd()}…` : first;
}

/** Only conversations in which the user said or typed something are worth keeping. */
export function isWorthSaving(messages: TranscriptEntry[]): boolean {
  return messages.some((m) => m.fromUser && m.text.trim());
}

/** Merges entries by id, so streamed agent messages replace their earlier partial text. */
export function mergeEntries<T extends { id: string }>(previous: T[], current: T[]): T[] {
  const ids = new Set(current.map((c) => c.id));
  return [...previous.filter((p) => !ids.has(p.id)), ...current];
}

export type HistoryGroup =
  { kind: 'today' } | { kind: 'yesterday' } | { kind: 'week' } | { kind: 'month'; year: number; month: number };

function startOfDay(time: number): number {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function historyGroup(time: number, now: number): HistoryGroup {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY_MS);
  if (days <= 0) return { kind: 'today' };
  if (days === 1) return { kind: 'yesterday' };
  if (days < 7) return { kind: 'week' };
  const d = new Date(time);
  return { kind: 'month', year: d.getFullYear(), month: d.getMonth() };
}

function groupKey(g: HistoryGroup): string {
  return g.kind === 'month' ? `${g.year}-${g.month}` : g.kind;
}

/** Groups conversations (newest first) under "Today", "Yesterday", "Previous 7 days" and months. */
export function groupHistory(
  conversations: Conversation[],
  now: number,
): { key: string; group: HistoryGroup; conversations: Conversation[] }[] {
  const groups: { key: string; group: HistoryGroup; conversations: Conversation[] }[] = [];
  for (const c of conversations) {
    const group = historyGroup(c.updatedAt, now);
    const key = groupKey(group);
    const last = groups.at(-1);
    if (last?.key === key) last.conversations.push(c);
    else groups.push({ key, group, conversations: [c] });
  }
  return groups;
}

/** LiveKit RPC payloads are limited to 15 KiB. */
export const MAX_RESTORE_BYTES = 14_000;

/**
 * The most recent turns of a conversation as the agent's `restore_history` payload, as many as fit
 * in `maxBytes`.
 */
export function restorePayload(conversation: Conversation, maxBytes = MAX_RESTORE_BYTES): string {
  const turns: { role: 'user' | 'assistant'; text: string }[] = [];
  const size = () => new TextEncoder().encode(JSON.stringify(turns)).length;
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const m = conversation.messages[i]!;
    if (!m.text.trim()) continue;
    turns.unshift({ role: m.fromUser ? 'user' : 'assistant', text: m.text });
    if (size() > maxBytes) {
      turns.shift();
      break;
    }
  }
  return JSON.stringify(turns);
}
