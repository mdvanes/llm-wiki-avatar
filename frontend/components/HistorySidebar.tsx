'use client';

import { useMemo } from 'react';
import type { Strings } from '@/lib/language';
import { type Conversation, type HistoryGroup, groupHistory } from '@/lib/history';

interface Props {
  conversations: Conversation[];
  /** The conversation of the running session, highlighted in the list. */
  activeId?: string;
  strings: Strings;
  language: string;
  onSelect: (conversation: Conversation) => void;
  onClear: () => void;
  onHide: () => void;
}

function groupLabel(group: HistoryGroup, strings: Strings, language: string, now: Date): string {
  switch (group.kind) {
    case 'today':
      return strings.today;
    case 'yesterday':
      return strings.yesterday;
    case 'week':
      return strings.previous7Days;
    case 'month':
      return new Date(group.year, group.month, 1).toLocaleDateString(language, {
        month: 'long',
        ...(group.year === now.getFullYear() ? {} : { year: 'numeric' }),
      });
  }
}

/** Left column listing saved conversations, grouped by date. */
export function HistorySidebar({ conversations, activeId, strings, language, onSelect, onClear, onHide }: Props) {
  const now = new Date();
  const groups = useMemo(() => groupHistory(conversations, Date.now()), [conversations]);

  return (
    <aside className="hidden h-full w-64 md:flex shrink-0 flex-col border-r border-border bg-panel" aria-label={strings.history}>
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold">{strings.history}</h2>
        <button
          type="button"
          onClick={onHide}
          title={strings.hideHistory}
          aria-label={strings.hideHistory}
          className="rounded-md p-1 text-muted hover:bg-panel-2 hover:text-fg"
        >
          <SidebarIcon />
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && <p className="px-2 text-xs text-muted">{strings.noHistory}</p>}
        {groups.map(({ key, group, conversations: items }) => (
          <section key={key} className="mb-3">
            <h3 className="px-2 pb-1 text-xs text-muted">{groupLabel(group, strings, language, now)}</h3>
            <ul>
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    title={c.title}
                    aria-current={c.id === activeId ? 'true' : undefined}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-panel-2 ${
                      c.id === activeId ? 'bg-panel-2 text-fg' : 'text-fg/85'
                    }`}
                  >
                    {c.id === activeId && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
                    <span className="truncate">{c.title || strings.untitled}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted">
        <span>{strings.historyNote}</span>
        {conversations.length > 0 && (
          <button
            type="button"
            onClick={() => window.confirm(strings.confirmClear) && onClear()}
            className="shrink-0 hover:text-danger"
          >
            {strings.clearHistory}
          </button>
        )}
      </footer>
    </aside>
  );
}

export function SidebarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function ShowHistoryButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="hidden rounded-md p-1 text-muted hover:bg-panel-2 hover:text-fg md:block"
    >
      <SidebarIcon />
    </button>
  );
}
