'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type Conversation,
  type SavedAnswer,
  type TranscriptEntry,
  conversationTitle,
  isWorthSaving,
} from '@/lib/history';

const SAVE_DELAY_MS = 500;

/**
 * Keeps the current conversation in the history while it happens. Saves are debounced because
 * agent messages stream in word by word, and flushed when the session ends or the page closes.
 */
export function useConversationRecorder({
  id,
  previous,
  messages,
  answers,
  language,
  onSave,
}: {
  id: string;
  previous?: Conversation;
  messages: TranscriptEntry[];
  answers: SavedAnswer[];
  language: string;
  onSave: (conversation: Conversation) => void;
}): void {
  const [startedAt] = useState(() => previous?.startedAt ?? Date.now());
  const pending = useRef<Conversation | undefined>(undefined);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    if (!isWorthSaving(messages)) return;
    pending.current = {
      id,
      title: previous?.title || conversationTitle(messages),
      language,
      startedAt,
      updatedAt: Date.now(),
      messages,
      answers,
    };
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [messages, answers]); // eslint-disable-line react-hooks/exhaustive-deps

  function flush() {
    const conversation = pending.current;
    pending.current = undefined;
    if (conversation) saveRef.current(conversation);
  }

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
