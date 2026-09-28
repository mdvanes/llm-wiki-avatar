'use client';

import { useEffect, useState } from 'react';
import { Markdown } from './Markdown';

export type PageRef = { path: string } | { name: string };

interface Page {
  path: string;
  title: string;
  markdown: string;
}

interface Props {
  page: PageRef;
  closeLabel: string;
  onClose: () => void;
  onNavigate: (page: PageRef) => void;
}

/** Modal that shows a wiki page, with wikilinks navigating inside the viewer. */
export function PageViewer({ page, closeLabel, onClose, onNavigate }: Props) {
  const [state, setState] = useState<{ page?: Page; error?: string }>({});
  const query = 'path' in page ? `path=${encodeURIComponent(page.path)}` : `name=${encodeURIComponent(page.name)}`;

  useEffect(() => {
    const controller = new AbortController();
    setState({});
    fetch(`/api/wiki?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        setState(res.ok ? { page: body as Page } : { error: body.error ?? res.statusText });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ error: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{state.page?.title ?? ('name' in page ? page.name : page.path)}</h2>
            {state.page && <p className="truncate text-xs text-muted">{state.page.path}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted hover:text-fg">
            {closeLabel} ✕
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4 text-sm">
          {state.error && <p className="text-danger">{state.error}</p>}
          {!state.page && !state.error && <p className="text-muted">…</p>}
          {state.page && <Markdown onWikiLink={(name) => onNavigate({ name })}>{state.page.markdown}</Markdown>}
        </div>
      </div>
    </div>
  );
}
