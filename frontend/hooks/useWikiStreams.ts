'use client';

import { useTextStream } from '@livekit/components-react';
import { useMemo } from 'react';
import type { MoodEvent } from '@/components/CartoonAvatar';
import { isLanguage, type Language } from '@/lib/language';
import {
  type Answer,
  REPLY_TARGET_ATTRIBUTE,
  type Source,
  type SourcesUpdate,
  TOPICS,
  isMood,
  parseJson,
} from '@/lib/protocol';
import type { FullReply } from '@/lib/reply';

export interface AnswerEvent extends Answer {
  id: string;
  timestamp: number;
}

/** Side-channel data the agent publishes next to its voice: mood, on-screen answers, sources, language, stopped replies. */
export function useWikiStreams() {
  const { textStreams: moodStreams } = useTextStream(TOPICS.mood);
  const { textStreams: answerStreams } = useTextStream(TOPICS.answer);
  const { textStreams: sourceStreams } = useTextStream(TOPICS.sources);
  const { textStreams: languageStreams } = useTextStream(TOPICS.language);
  const { textStreams: replyStreams } = useTextStream(TOPICS.reply);

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

  const replies = useMemo<FullReply[]>(
    () =>
      replyStreams.map((s) => ({
        id: s.streamInfo.id,
        target: s.streamInfo.attributes?.[REPLY_TARGET_ATTRIBUTE] ?? '',
        text: s.text,
        timestamp: s.streamInfo.timestamp,
      })),
    [replyStreams],
  );

  return { mood, answers, sources, agentLanguage, replies };
}
