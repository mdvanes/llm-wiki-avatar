'use client';

import { useEffect, useState } from 'react';
import type { Conversation } from '@/lib/history';
import type { Strings } from '@/lib/language';
import { AnswerCard } from './AnswerCard';
import { PageViewer, type PageRef } from './PageViewer';
import { Transcript } from './Transcript';

interface Props {
  conversation: Conversation;
  strings: Strings;
  language: string;
  /** Not offered while a session is running. */
  onContinue?: () => void;
  /** Not offered for the conversation of the running session. */
  onDelete?: () => void;
  onClose: () => void;
}

/** Read-only view of a saved conversation. */
export function ConversationViewer({ conversation, strings, language, onContinue, onDelete, onClose }: Props) {
  const [page, setPage] = useState<PageRef | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !page && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, page]);

  const when = new Date(conversation.updatedAt).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={conversation.title || strings.untitled}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{conversation.title || strings.untitled}</h2>
            <p className="text-xs text-muted">{when}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted hover:text-fg">
            {strings.close} ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Transcript messages={conversation.messages} emptyText="" onWikiLink={(name) => setPage({ name })} />
          {conversation.answers.length > 0 && (
            <section className="flex flex-col gap-3 border-t border-border p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{strings.onScreen}</h3>
              {conversation.answers.map((a) => (
                <AnswerCard key={a.id} answer={a} onOpen={setPage} />
              ))}
            </section>
          )}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          {onDelete ? (
            <button
              type="button"
              onClick={() => window.confirm(strings.confirmDelete) && onDelete()}
              className="rounded-full border border-danger/60 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
            >
              {strings.deleteConversation}
            </button>
          ) : (
            <span />
          )}
          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg hover:opacity-90"
            >
              {strings.continueConversation}
            </button>
          )}
        </footer>
      </div>
      {page && (
        <div onClick={(e) => e.stopPropagation()}>
          <PageViewer page={page} closeLabel={strings.close} onClose={() => setPage(null)} onNavigate={setPage} />
        </div>
      )}
    </div>
  );
}
