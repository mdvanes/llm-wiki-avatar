import {
  APIConnectionError,
  type APIConnectOptions,
  APIStatusError,
  AudioByteStream,
  shortuuid,
  tts,
} from '@livekit/agents';
import type { AudioFrame } from '@livekit/rtc-node';

const SAMPLE_RATE = 24000;
const CHANNELS = 1;

export interface SpeachesVoice {
  /** OpenAI-compatible base URL, e.g. `http://speaches:8000/v1`. */
  baseURL: string;
  model: string;
  voice: string;
}

export interface SpeachesTTSOptions extends SpeachesVoice {
  apiKey?: string;
  speed?: number;
}

/**
 * TTS for Speaches (or any OpenAI-compatible `/audio/speech` endpoint).
 *
 * Unlike the stock OpenAI plugin this asks the server to resample to 24 kHz (`sample_rate`), which
 * matters for Piper voices (22.05 kHz natively), streams the PCM response as it arrives, and lets
 * the voice (and even the server) be switched per language at runtime.
 */
export class SpeachesTTS extends tts.TTS {
  label = 'speaches.TTS';
  #opts: Required<SpeachesTTSOptions>;
  #abort = new AbortController();

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
    const { baseURL, model, voice } = this.#opts;
    return { baseURL, model, voice };
  }

  updateOptions(opts: Partial<SpeachesTTSOptions>): void {
    this.#opts = { ...this.#opts, ...opts };
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
}

class SpeachesChunkedStream extends tts.ChunkedStream {
  label = 'speaches.ChunkedStream';
  #opts: Required<SpeachesTTSOptions>;
  #signal: AbortSignal | undefined;

  constructor(
    ttsInstance: SpeachesTTS,
    text: string,
    opts: Required<SpeachesTTSOptions>,
    connOptions?: APIConnectOptions,
    signal?: AbortSignal,
  ) {
    super(text, ttsInstance, connOptions, signal);
    this.#opts = opts;
    this.#signal = signal;
  }

  protected async run(): Promise<void> {
    const requestId = shortuuid();
    try {
      let res: Response;
      try {
        res = await fetch(`${this.#opts.baseURL.replace(/\/$/, '')}/audio/speech`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.#opts.apiKey}`,
          },
          body: JSON.stringify({
            model: this.#opts.model,
            voice: this.#opts.voice,
            input: this.inputText,
            response_format: 'pcm',
            sample_rate: SAMPLE_RATE,
            speed: this.#opts.speed,
          }),
          signal: this.#signal ?? null,
        });
      } catch (err) {
        if (isAbort(err)) return;
        throw new APIConnectionError({ message: `Speaches TTS request failed: ${String(err)}` });
      }
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        throw new APIStatusError({
          message: `Speaches TTS error ${res.status}: ${body.slice(0, 300)}`,
          options: { statusCode: res.status },
        });
      }

      const bytes = new AudioByteStream(SAMPLE_RATE, CHANNELS);
      let lastFrame: AudioFrame | undefined;
      const send = (frame: AudioFrame) => {
        if (lastFrame) this.queue.put({ requestId, segmentId: requestId, frame: lastFrame, final: false });
        lastFrame = frame;
      };
      let carry: Uint8Array | undefined;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        // Keep 16-bit samples aligned across network chunks.
        let data = carry ? concat(carry, chunk) : chunk;
        carry = undefined;
        if (data.byteLength % 2 === 1) {
          carry = data.slice(-1);
          data = data.slice(0, -1);
        }
        for (const frame of bytes.write(data)) send(frame);
      }
      for (const frame of bytes.flush()) send(frame);
      if (lastFrame) this.queue.put({ requestId, segmentId: requestId, frame: lastFrame, final: true });
    } catch (err) {
      if (isAbort(err)) return;
      throw err;
    } finally {
      this.queue.close();
    }
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
