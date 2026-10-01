import {
  APIConnectionError,
  type APIConnectOptions,
  APIStatusError,
  AudioByteStream,
  log,
  shortuuid,
  tts,
} from '@livekit/agents';
import type { AudioFrame } from '@livekit/rtc-node';
import type { WordSegment, WordTiming } from './publisher.ts';

const SAMPLE_RATE = 24000;
const CHANNELS = 1;
/** After Kokoro-FastAPI fails, use the fallback voice for this long before trying again. */
const CAPTIONED_RETRY_MS = 30_000;

export interface SpeachesVoice {
  /** OpenAI-compatible base URL, e.g. `http://speaches:8000/v1`. */
  baseURL: string;
  model: string;
  voice: string;
  /**
   * Use Kokoro-FastAPI's captioned speech (`/dev/captioned_speech`), which also returns word timings. `baseURL` is
   * then the Kokoro-FastAPI server (with or without `/v1`).
   */
  wordTimings?: boolean;
  /** Voice used when the word-timings server cannot be reached. */
  fallback?: SpeachesVoice;
}

export interface SpeachesTTSOptions extends SpeachesVoice {
  apiKey?: string;
  speed?: number;
  /** Receives the word timings of `wordTimings` voices, per segment, before the audio they belong to. */
  onWords?: (segment: WordSegment) => void;
}

type Options = SpeachesTTSOptions & { apiKey: string; speed: number };

/**
 * TTS for Speaches (or any OpenAI-compatible `/audio/speech` endpoint).
 *
 * Unlike the stock OpenAI plugin this asks the server to resample to 24 kHz (`sample_rate`), which
 * matters for Piper voices (22.05 kHz natively), streams the PCM response as it arrives, and lets
 * the voice (and even the server) be switched per language at runtime.
 */
export class SpeachesTTS extends tts.TTS {
  label = 'speaches.TTS';
  #opts: Options;
  #abort = new AbortController();
  #captionedDownUntil = 0;

  constructor(opts: SpeachesTTSOptions) {
    super(SAMPLE_RATE, CHANNELS, { streaming: false });
    this.#opts = { apiKey: 'speaches', speed: 1, ...opts };
  }

  override get model(): string {
    return this.#opts.model;
  }

  override get provider(): string {
    try {
      return new URL(this.#opts.baseURL).host;
    } catch {
      return 'speaches';
    }
  }

  get voice(): SpeachesVoice {
    const { baseURL, model, voice, wordTimings, fallback } = this.#opts;
    return { baseURL, model, voice, ...(wordTimings ? { wordTimings, fallback } : {}) };
  }

  updateOptions(opts: Partial<SpeachesTTSOptions>): void {
    this.#opts = { ...this.#opts, ...opts };
  }

  /** Switches to another voice; unlike updateOptions this also clears the word-timings settings of the previous one. */
  setVoice(voice: SpeachesVoice): void {
    this.#opts = { ...this.#opts, wordTimings: false, fallback: undefined, ...voice };
  }

  synthesize(text: string, connOptions?: APIConnectOptions, abortSignal?: AbortSignal): tts.ChunkedStream {
    const signal = abortSignal ? AbortSignal.any([abortSignal, this.#abort.signal]) : this.#abort.signal;
    return new SpeachesChunkedStream(this, text, { ...this.#opts }, connOptions, signal);
  }

  stream(): tts.SynthesizeStream {
    throw new Error('SpeachesTTS does not support streaming input; it is wrapped in a StreamAdapter.');
  }

  override async close(): Promise<void> {
    this.#abort.abort();
  }

  /** @internal */
  get captionedAvailable(): boolean {
    return Date.now() >= this.#captionedDownUntil;
  }

  /** @internal */
  captionedFailed(): void {
    this.#captionedDownUntil = Date.now() + CAPTIONED_RETRY_MS;
  }
}

/** One line of Kokoro-FastAPI's streamed captioned speech. */
interface CaptionedChunk {
  audio?: string;
  timestamps?: Array<{ word: string; start_time: number; end_time: number }> | null;
}

/** The URL of Kokoro-FastAPI's captioned speech endpoint, which is not under `/v1`. */
export function captionedSpeechURL(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')}/dev/captioned_speech`;
}

/** Kokoro's timestamps in ms, without punctuation tokens. */
export function toWordTimings(timestamps: CaptionedChunk['timestamps']): WordTiming[] {
  return (timestamps ?? [])
    .filter((t) => /[\p{L}\p{N}]/u.test(t.word))
    .map((t) => ({ w: t.word, s: Math.round(t.start_time * 1000), e: Math.round(t.end_time * 1000) }));
}

/** Word-timings server problem before any audio arrived; the fallback voice can take over. */
class CaptionedUnavailable extends Error {}

/** Turns PCM bytes into audio frames and queues them, marking the last one final. */
class FrameWriter {
  bytes = 0;
  #stream = new AudioByteStream(SAMPLE_RATE, CHANNELS);
  #last: AudioFrame | undefined;
  #carry: Uint8Array | undefined;
  #put: (frame: AudioFrame, final: boolean) => void;

  constructor(put: (frame: AudioFrame, final: boolean) => void) {
    this.#put = put;
  }

  get durationMs(): number {
    return Math.round((this.bytes / 2 / SAMPLE_RATE) * 1000);
  }

  write(chunk: Uint8Array): void {
    this.bytes += chunk.byteLength;
    // Keep 16-bit samples aligned across network chunks.
    let data = this.#carry ? concat(this.#carry, chunk) : chunk;
    this.#carry = undefined;
    if (data.byteLength % 2 === 1) {
      this.#carry = data.slice(-1);
      data = data.slice(0, -1);
    }
    for (const frame of this.#stream.write(data)) this.#send(frame);
  }

  end(): void {
    for (const frame of this.#stream.flush()) this.#send(frame);
    if (this.#last) this.#put(this.#last, true);
    this.#last = undefined;
  }

  #send(frame: AudioFrame): void {
    if (this.#last) this.#put(this.#last, false);
    this.#last = frame;
  }
}

class SpeachesChunkedStream extends tts.ChunkedStream {
  label = 'speaches.ChunkedStream';
  #tts: SpeachesTTS;
  #opts: Options;
  #signal: AbortSignal | undefined;

  constructor(
    ttsInstance: SpeachesTTS,
    text: string,
    opts: Options,
    connOptions?: APIConnectOptions,
    signal?: AbortSignal,
  ) {
    super(text, ttsInstance, connOptions, signal);
    this.#tts = ttsInstance;
    this.#opts = opts;
    this.#signal = signal;
  }

  protected async run(): Promise<void> {
    const requestId = shortuuid();
    const out = new FrameWriter((frame, final) =>
      this.queue.put({ requestId, segmentId: requestId, frame, final }),
    );
    try {
      const opts = this.#opts;
      if (opts.wordTimings) {
        if (this.#tts.captionedAvailable) {
          try {
            await this.#captioned(requestId, out);
            return;
          } catch (err) {
            if (isAbort(err) || !(err instanceof CaptionedUnavailable)) throw err;
            this.#tts.captionedFailed();
            log().warn({ err: err.message }, 'word-timings TTS unavailable; using the regular voice');
          }
        }
        if (!opts.fallback) throw new APIConnectionError({ message: 'word-timings TTS unavailable and no fallback voice' });
        await this.#speech({ ...opts, ...opts.fallback }, out);
        return;
      }
      await this.#speech(opts, out);
    } catch (err) {
      if (isAbort(err)) return;
      throw err;
    } finally {
      this.queue.close();
    }
  }

  /** Speaches / OpenAI-compatible `/audio/speech`. */
  async #speech(opts: Options, out: FrameWriter): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${opts.baseURL.replace(/\/$/, '')}/audio/speech`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          voice: opts.voice,
          input: this.inputText,
          response_format: 'pcm',
          sample_rate: SAMPLE_RATE,
          speed: opts.speed,
        }),
        signal: this.#signal ?? null,
      });
    } catch (err) {
      if (isAbort(err)) throw err;
      throw new APIConnectionError({ message: `Speaches TTS request failed: ${String(err)}` });
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new APIStatusError({
        message: `Speaches TTS error ${res.status}: ${body.slice(0, 300)}`,
        options: { statusCode: res.status },
      });
    }
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) out.write(chunk);
    out.end();
  }

  /** Kokoro-FastAPI's captioned speech: newline-delimited JSON with base64 PCM and word timings. */
  async #captioned(segment: string, out: FrameWriter): Promise<void> {
    const opts = this.#opts;
    const onWords = opts.onWords ?? (() => {});
    let res: Response;
    try {
      res = await fetch(captionedSpeechURL(opts.baseURL), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: opts.model,
          voice: opts.voice,
          input: this.inputText,
          response_format: 'pcm',
          stream: true,
          return_timestamps: true,
          speed: opts.speed,
        }),
        signal: this.#signal ?? null,
      });
    } catch (err) {
      if (isAbort(err)) throw err;
      throw new CaptionedUnavailable(`request failed: ${String(err)}`);
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new CaptionedUnavailable(`error ${res.status}: ${body.slice(0, 300)}`);
    }

    let started = false;
    const handle = (line: string) => {
      if (!line.trim()) return;
      let chunk: CaptionedChunk;
      try {
        chunk = JSON.parse(line) as CaptionedChunk;
      } catch {
        throw new APIConnectionError({ message: `unexpected captioned speech data: ${line.slice(0, 100)}` });
      }
      const words = toWordTimings(chunk.timestamps);
      if (words.length) onWords({ id: segment, words, final: false });
      if (chunk.audio) out.write(Buffer.from(chunk.audio, 'base64'));
      started = true;
    };
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(part, { stream: true });
        for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
          handle(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      handle(buffer + decoder.decode());
    } catch (err) {
      if (!started && !isAbort(err) && !(err instanceof APIConnectionError)) {
        throw new CaptionedUnavailable(`stream failed: ${String(err)}`);
      }
      throw err;
    } finally {
      if (started) onWords({ id: segment, words: [], final: true, durationMs: out.durationMs });
    }
    out.end();
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
