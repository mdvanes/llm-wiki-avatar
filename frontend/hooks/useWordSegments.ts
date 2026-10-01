'use client';

import { useSessionContext } from '@livekit/components-react';
import { useEffect, useRef } from 'react';
import { TOPICS, type WordSegment, isWordSegment, parseJson } from '@/lib/protocol';

/** Calls `onSegment` for each piece of word timings the agent sends for the premium avatar's lip-sync. */
export function useWordSegments(onSegment: (segment: WordSegment) => void): void {
  const { room } = useSessionContext();
  const callback = useRef(onSegment);
  callback.current = onSegment;
  useEffect(() => {
    room.registerTextStreamHandler(TOPICS.words, async (reader) => {
      const segment = parseJson<unknown>(await reader.readAll());
      if (isWordSegment(segment)) callback.current(segment);
    });
    return () => room.unregisterTextStreamHandler(TOPICS.words);
  }, [room]);
}
