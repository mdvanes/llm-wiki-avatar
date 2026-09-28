import { ReadableStream } from 'node:stream/web';

/** A stateful filter that is fed text chunk by chunk (as they stream from the LLM). */
export interface StreamingTextFilter {
  push(chunk: string): string;
  flush(): string;
}

/** Applies a streaming filter to a text stream. Non-string items (e.g. timed strings) pass through unchanged. */
export function filterTextStream<T>(
  input: ReadableStream<T> | AsyncIterable<T>,
  filter: StreamingTextFilter,
): ReadableStream<T | string> {
  return new ReadableStream<T | string>({
    async start(controller) {
      try {
        for await (const chunk of input as AsyncIterable<T>) {
          if (typeof chunk === 'string') {
            const out = filter.push(chunk);
            if (out) controller.enqueue(out);
          } else {
            controller.enqueue(chunk);
          }
        }
        const rest = filter.flush();
        if (rest) controller.enqueue(rest);
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/** Runs a filter over a complete string (handy for tests and non-streaming text). */
export function filterText(text: string, filter: StreamingTextFilter): string {
  return filter.push(text) + filter.flush();
}
