'use client';

import { useTextStream } from '@livekit/components-react';
import { useMemo } from 'react';
import type { MoodEvent } from '@/hooks/useAvatarDriver';
import { isLanguage, type Language } from '@/lib/language';
import {
  type AgentError,
  type Answer,
  type Source,
  type SourcesUpdate,
  TOPICS,
  isAgentError,
  isMood,
  parseJson,
} from '@/lib/protocol';

export interface AnswerEvent extends Answer {
  id: string;
  timestamp: number;
}

/** Side-channel data the agent publishes next to its replies: mood, on-screen answers, sources, language, errors. */
export function useWikiStreams() {
  const { textStreams: moodStreams } = useTextStream(TOPICS.mood);
  const { textStreams: answerStreams } = useTextStream(TOPICS.answer);
  const { textStreams: sourceStreams } = useTextStream(TOPICS.sources);
  const { textStreams: languageStreams } = useTextStream(TOPICS.language);
  const { textStreams: errorStreams } = useTextStream(TOPICS.error);

  const mood = useMemo<MoodEvent | undefined>(() => {
    const last = moodStreams.at(-1);
    return last && isMood(last.text) ? { mood: last.text, seq: moodStreams.length } : undefined;
  }, [moodStreams]);

  const answers = useMemo<AnswerEvent[]>(
    () =>
      answerStreams.flatMap((s) => {
        const answer = parseJson<Answer>(s.text);
        return answer?.markdown
          ? [{ ...answer, id: s.streamInfo.id, timestamp: s.streamInfo.timestamp }]
          : [];
      }),
    [answerStreams],
  );

  const sources = useMemo<Source[]>(() => {
    const updates = sourceStreams.flatMap((s) => parseJson<SourcesUpdate>(s.text) ?? []);
    const latest = updates.at(-1);
    return latest ? updates.filter((u) => u.turn === latest.turn).at(-1)!.sources : [];
  }, [sourceStreams]);

  const agentLanguage = useMemo<Language | undefined>(() => {
    const last = languageStreams.at(-1)?.text;
    return isLanguage(last) ? last : undefined;
  }, [languageStreams]);

  const agentError = useMemo<AgentError | undefined>(() => {
    for (let i = errorStreams.length - 1; i >= 0; i--) {
      const error = parseJson<unknown>(errorStreams[i]!.text);
      if (isAgentError(error)) return error;
    }
    return undefined;
  }, [errorStreams]);

  return { mood, answers, sources, agentLanguage, agentError };
}
