import { concat } from './audio';

// Runs on the audio thread: buffers microphone samples while recording and hands them over on `stop`.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buffer = new Float32Array(8192);
    this.length = 0;
    this.limit = Infinity;
    this.port.onmessage = ({ data }) => {
      if (data === 'start' || data === 'stream') {
        this.length = 0;
        this.limit = data === 'stream' ? 1024 : Infinity;
        this.recording = true;
      } else if (data === 'stop') {
        this.recording = false;
        this.flush();
        this.port.postMessage(null);
      }
    };
  }
  flush() {
    if (this.length === 0) return;
    this.port.postMessage(this.buffer.slice(0, this.length));
    this.length = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (this.recording && channel) {
      if (this.length + channel.length > this.buffer.length) this.flush();
      this.buffer.set(channel, this.length);
      this.length += channel.length;
      if (this.length >= this.limit) this.flush();
    }
    return true;
  }
}
registerProcessor('capture', Capture);
`;

export interface Recording {
  samples: Float32Array;
  sampleRate: number;
}

/** Records the (unpublished) microphone track at its own sample rate, one push-to-talk turn at a time. */
export class MicRecorder {
  readonly #context: AudioContext;
  readonly #node: AudioWorkletNode;
  readonly #source: MediaStreamAudioSourceNode;
  #chunks: Float32Array[] = [];
  #stopped: ((chunks: Float32Array[]) => void) | undefined;
  #recording = false;
  readonly #track: MediaStreamTrack;
  #onFrame: ((frame: Float32Array) => void) | undefined;

  private constructor(
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    node: AudioWorkletNode,
    track: MediaStreamTrack,
  ) {
    this.#track = track;
    this.#context = context;
    this.#source = source;
    this.#node = node;
    node.port.onmessage = ({ data }: MessageEvent<Float32Array | null>) => {
      if (data) {
        if (this.#onFrame) this.#onFrame(data);
        else this.#chunks.push(data);
        return;
      }
      const chunks = this.#chunks;
      this.#chunks = [];
      this.#stopped?.(chunks);
      this.#stopped = undefined;
    };
  }

  static async open(track: MediaStreamTrack): Promise<MicRecorder> {
    const context = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(context, 'capture', { numberOfInputs: 1, numberOfOutputs: 1 });
    // Some browsers only render nodes that lead to the destination; the zero gain keeps the mic off the speakers.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(context.destination);
    return new MicRecorder(context, source, node, track);
  }

  get recording(): boolean {
    return this.#recording;
  }

  async start(): Promise<void> {
    // Created outside the click handler, so the context may start suspended.
    if (this.#context.state === 'suspended') await this.#context.resume();
    this.#chunks = [];
    this.#recording = true;
    this.#node.port.postMessage('start');
  }

  /** Continuous capture: hands every ~20 ms frame to `onFrame` until `stopStreaming`. */
  async startStreaming(onFrame: (frame: Float32Array) => void): Promise<void> {
    if (this.#context.state === 'suspended') await this.#context.resume();
    this.#onFrame = onFrame;
    this.#recording = true;
    this.#node.port.postMessage('stream');
  }

  stopStreaming(): void {
    this.#onFrame = undefined;
    this.#recording = false;
    this.#chunks = [];
    this.#node.port.postMessage('stop');
  }

  get mediaStreamTrack(): MediaStreamTrack {
    return this.#track;
  }

  get sampleRate(): number {
    return this.#context.sampleRate;
  }

  resume(): Promise<void> {
    return this.#context.resume();
  }

  stop(): Promise<Recording> {
    this.#recording = false;
    return new Promise((resolve) => {
      this.#stopped = (chunks) => resolve({ samples: concat(chunks), sampleRate: this.#context.sampleRate });
      this.#node.port.postMessage('stop');
    });
  }

  close(): void {
    this.#source.disconnect();
    this.#node.disconnect();
    void this.#context.close();
  }
}
