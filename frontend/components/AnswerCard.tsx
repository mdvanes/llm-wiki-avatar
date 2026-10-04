'use client';

import type { AnswerEvent } from '@/hooks/useWikiStreams';
import { Markdown } from './Markdown';
import type { PageRef } from './PageViewer';
import { SourceChips } from './SourceChips';

interface Props {
  answer: AnswerEvent;
  onOpen: (page: PageRef) => void;
}

export function AnswerCard({ answer, onOpen }: Props) {
  return (
    <article className="rounded-xl border border-border bg-panel p-4 text-sm shadow-sm">
      <Markdown onWikiLink={(name) => onOpen({ name, sourceId: answer.sources[0]?.sourceId })}>{answer.markdown}</Markdown>
      {answer.sources.length > 0 && <SourceChips className="mt-3" sources={answer.sources} onOpen={onOpen} />}
    </article>
  );
}
