import { ReadableStream } from 'node:stream/web';
import { describe, expect, it } from 'vitest';
import { RecordingPublisher, TOPICS } from '../src/publisher.ts';
import { ReplyCapture, captureLlmStream } from '../src/replyCapture.ts';

/** An LLM stream that yields `chunks` one by one, and records whether it was cancelled. */
function llmStream(chunks: string[]) {
  const state = { cancelled: false, pulled: 0 };
  const stream = new ReadableStream<string>({
    async pull(controller) {
      await new Promise((r) => setTimeout(r, 1));
      if (state.cancelled) return;
      if (state.pulled === chunks.length) controller.close();
      else controller.enqueue(chunks[state.pulled++]!);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

async function readN(stream: ReadableStream<unknown>, n: number) {
  const reader = stream.getReader();
  for (let i = 0; i < n; i++) await reader.read();
  return reader;
}

describe('ReplyCapture', () => {
  it('captures the reply without mood tags and passes chunks through', async () => {
    const { stream } = llmStream(['[mood:happy] Hello', ' there', '!']);
    const reply = new ReplyCapture();
    const out: unknown[] = [];
    for await (const chunk of captureLlmStream(stream, reply)) out.push(chunk);
    expect(out).toEqual(['[mood:happy] Hello', ' there', '!']);
    expect(await reply.complete()).toBe('Hello there!');
  });

  it('cancels the LLM when the speech is interrupted', async () => {
    const { stream, state } = llmStream(['a', 'b', 'c', 'd']);
    const reply = new ReplyCapture();
    const reader = await readN(captureLlmStream(stream, reply), 1);
    await reader.cancel();
    await reply.complete();
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(4);
  });

  it('keeps generating a kept reply after the speech is stopped', async () => {
    const { stream, state } = llmStream(['one', ' two', ' three']);
    const reply = new ReplyCapture();
    const reader = await readN(captureLlmStream(stream, reply), 1);
    reply.keep();
    await reader.cancel();
    expect(reply.done).toBe(false); // the speech is torn down without waiting for the LLM
    expect(await reply.complete()).toBe('one two three');
    expect(state.cancelled).toBe(false);
  });

  it('streams the text so far and the rest to a follower', async () => {
    const reply = new ReplyCapture();
    reply.append('Hi');
    const publisher = new RecordingPublisher();
    const writer = publisher.fullReply('msg-1');
    reply.follow(
      (text) => writer.write(text),
      () => writer.close(),
    );
    reply.append(' there');
    reply.finish();
    expect(publisher.events).toEqual([
      { topic: TOPICS.reply, payload: { target: 'msg-1', text: 'Hi there', closed: true } },
    ]);
  });

  it('holds a fixed text', async () => {
    expect(await ReplyCapture.of('[mood:happy] Welcome!').complete()).toBe('Welcome!');
  });
});
