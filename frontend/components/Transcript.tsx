'use client';

import type { ReceivedMessage } from '@livekit/components-react';
import { useEffect, useRef } from 'react';
import { Markdown } from './Markdown';

interface Props {
  messages: ReceivedMessage[];
  emptyText: string;
  thinking: boolean;
  /** Shown as a placeholder user message while the user's speech is being heard or transcribed. */
  pendingSpeech?: string;
  onWikiLink?: (target: string) => void;
}

function isFromUser(message: ReceivedMessage): boolean {
  if (message.type === 'userTranscript') return true;
  if (message.type === 'agentTranscript') return false;
  return message.from?.isLocal ?? false;
}

export function Transcript({ messages, emptyText, thinking, pendingSpeech, onWikiLink }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, thinking, pendingSpeech]);

  if (messages.length === 0 && !pendingSpeech) {
    return <p className="p-4 text-sm text-muted">{emptyText}</p>;
  }
  return (
    <ol className="flex flex-col gap-3 p-4">
      {messages.map((m) => {
        const user = isFromUser(m);
        return (
          <li key={m.id} className={`flex ${user ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                user ? 'rounded-br-sm bg-accent/20 text-fg' : 'rounded-bl-sm bg-panel-2 text-fg'
              }`}
            >
              {user ? m.message : <Markdown onWikiLink={onWikiLink}>{m.message}</Markdown>}
            </div>
          </li>
        );
      })}
      {pendingSpeech && (
        <li className="flex justify-end" aria-label="pending speech">
          <div className="flex items-center gap-2 rounded-2xl rounded-br-sm border border-dashed border-accent/50 bg-accent/10 px-3.5 py-2 text-sm italic text-muted">
            <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            {pendingSpeech}
          </div>
        </li>
      )}
      {thinking && (
        <li className="flex justify-start" aria-label="thinking">
          <div className="flex gap-1 rounded-2xl rounded-bl-sm bg-panel-2 px-3.5 py-3">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        </li>
      )}
      <div ref={endRef} />
    </ol>
  );
}
