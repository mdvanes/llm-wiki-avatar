import { llm } from '@livekit/agents';

/** One message of an earlier conversation, as sent by the frontend when a conversation is continued. */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const MAX_RESTORED_TURNS = 40;
const MAX_TURN_CHARS = 4000;

/** Parses and sanitizes the `restore_history` RPC payload; throws on malformed input. */
export function parseHistoryPayload(payload: string): HistoryTurn[] {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    throw new Error('history payload is not valid JSON');
  }
  if (!Array.isArray(data)) throw new Error('history payload must be an array');
  const turns: HistoryTurn[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const { role, text } = item as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') continue;
    const trimmed = text.trim().slice(0, MAX_TURN_CHARS);
    if (trimmed) turns.push({ role, text: trimmed });
  }
  return turns.slice(-MAX_RESTORED_TURNS);
}

/**
 * Returns a copy of `chatCtx` with the earlier turns placed after the leading instructions and
 * before anything said in this session (such as the greeting). Assistant turns get a neutral mood
 * tag, so the model keeps following the "every reply starts with a mood tag" rule.
 */
export function withRestoredHistory(chatCtx: llm.ChatContext, turns: HistoryTurn[]): llm.ChatContext {
  const copy = chatCtx.copy();
  const items = copy.items;
  let at = 0;
  while (at < items.length) {
    const item = items[at]!;
    if (item.type !== 'message' || (item.role !== 'system' && item.role !== 'developer')) break;
    at++;
  }
  const restored = turns.map(
    (t) =>
      new llm.ChatMessage({
        role: t.role,
        content: t.role === 'assistant' && !t.text.startsWith('[mood:') ? `[mood:neutral] ${t.text}` : t.text,
        extra: { restored: true },
      }),
  );
  items.splice(at, 0, ...restored);
  copy.items = items;
  return copy;
}
