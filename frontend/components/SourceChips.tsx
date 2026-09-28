'use client';

import type { Source } from '@/lib/protocol';
import type { PageRef } from './PageViewer';

interface Props {
  sources: Source[];
  onOpen: (page: PageRef) => void;
  className?: string;
}

export function SourceChips({ sources, onOpen, className }: Props) {
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className ?? ''}`}>
      {sources.map((s) => (
        <li key={s.path}>
          <button
            type="button"
            title={s.path}
            onClick={() => onOpen({ path: s.path })}
            className="rounded-full border border-border bg-panel-2 px-2.5 py-0.5 text-xs text-muted hover:border-accent hover:text-fg"
          >
            📄 {s.title}
          </button>
        </li>
      ))}
    </ul>
  );
}
