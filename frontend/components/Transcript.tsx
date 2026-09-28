'use client';

import type { ReceivedMessage } from '@livekit/components-react';
import { useEffect, useRef } from 'react';
import { Markdown } from './Markdown';

interface Props {
  messages: ReceivedMessage[];
  emptyText: string;
  thinking: boolean;
  onWikiLink?: (target: string) => void;
}

function isFromUser(message: ReceivedMessage): boolean {
  if (message.type === 'userTranscript') return true;
  if (message.type === 'agentTranscript') return false;
  return message.from?.isLocal ?? false;
}

export function Transcript({ messages, emptyText, thinking, onWikiLink }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, thinking]);

  if (messages.length === 0) {
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
