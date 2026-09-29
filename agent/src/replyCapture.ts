import type { FlushSentinel, llm } from '@livekit/agents';
import { ReadableStream } from 'node:stream/web';
import { MoodFilter } from './mood.ts';

type LlmChunk = llm.ChatChunk | string | FlushSentinel;

/**
 * The text of one reply as it is generated, independent of how far it has been spoken. Lets the
 * user stop the voice while the rest of the reply still appears on screen.
 */
export class ReplyCapture {
  #text = '';
  #done = false;
  #kept = false;
  readonly #followers = new Set<{ onText: (text: string) => void; onDone: () => void }>();

  /** Reply text so far, without mood tags (as in the transcript). */
  get text(): string {
    return this.#text;
  }

  get done(): boolean {
    return this.#done;
  }

  /** True once the reply should be generated to the end even if its speech is interrupted. */
  get kept(): boolean {
    return this.#kept;
  }

  keep(): void {
    this.#kept = true;
  }

  append(text: string): void {
    if (!text || this.#done) return;
    this.#text += text;
    for (const f of this.#followers) f.onText(text);
  }

  finish(): void {
    if (this.#done) return;
    this.#done = true;
    for (const f of this.#followers) f.onDone();
    this.#followers.clear();
  }

  /** Calls `onText` with the text so far and then with every new piece; `onDone` when complete. */
  follow(onText: (text: string) => void, onDone: () => void): void {
    if (this.#text) onText(this.#text);
    if (this.#done) {
      onDone();
      return;
    }
    this.#followers.add({ onText, onDone });
  }

  /** Resolves with the complete text once the reply is done. */
  complete(): Promise<string> {
    return new Promise((resolve) => this.follow(() => {}, () => resolve(this.#text)));
  }

  /** A reply whose text is known up front, such as `session.say`. */
  static of(text: string): ReplyCapture {
    const reply = new ReplyCapture();
    reply.append(stripMoods(text));
    reply.finish();
    return reply;
  }
}

function stripMoods(text: string): string {
  const filter = new MoodFilter();
  return filter.push(text) + filter.flush();
}

function chunkText(chunk: LlmChunk): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk && typeof chunk === 'object' && 'delta' in chunk) return chunk.delta?.content ?? '';
  return '';
}

/**
 * Tees an LLM stream into `reply`. When the returned stream is cancelled (the speech was
 * interrupted) the LLM is cancelled too, unless the reply was kept: then it runs to the end.
 */
export function captureLlmStream(stream: ReadableStream<LlmChunk>, reply: ReplyCapture): ReadableStream<LlmChunk> {
  const [out, side] = stream.tee();
  const sideReader = side.getReader();
  const outReader = out.getReader();
  const moods = new MoodFilter();

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await sideReader.read();
        if (done) break;
        const text = chunkText(value);
        if (text) reply.append(moods.push(text));
      }
      reply.append(moods.flush());
    } catch {
      // The LLM failed or was cancelled; keep what was generated.
    } finally {
      reply.finish();
    }
  })();

  return new ReadableStream<LlmChunk>({
    async pull(controller) {
      const { done, value } = await outReader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      // A tee branch's cancel settles only once both branches are cancelled, so don't wait for it.
      outReader.cancel(reason).catch(() => {});
      if (!reply.kept && !reply.done) await sideReader.cancel(reason);
    },
  });
}
