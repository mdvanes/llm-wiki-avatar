export const WHISPER_SAMPLE_RATE = 16_000;

/** RMS of the loudest 50 ms window; below this the recording counts as silence (about -36 dBFS). */
export const SPEECH_RMS = 0.015;

export function loudestRms(samples: Float32Array, sampleRate: number): number {
  const window = Math.max(1, Math.round(sampleRate * 0.05));
  let loudest = 0;
  for (let start = 0; start < samples.length; start += window) {
    const end = Math.min(samples.length, start + window);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    loudest = Math.max(loudest, Math.sqrt(sum / (end - start)));
  }
  return loudest;
}

/** Whisper tends to invent text for silence, so silent recordings are not transcribed at all. */
export function isSilent(samples: Float32Array, sampleRate: number): boolean {
  return loudestRms(samples, sampleRate) < SPEECH_RMS;
}

export function concat(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Whisper wants 16 kHz mono; the microphone usually runs at 44.1 or 48 kHz. */
export async function resampleForWhisper(samples: Float32Array, sampleRate: number): Promise<Float32Array> {
  if (sampleRate === WHISPER_SAMPLE_RATE || samples.length === 0) return samples;
  const length = Math.ceil((samples.length * WHISPER_SAMPLE_RATE) / sampleRate);
  const context = new OfflineAudioContext(1, length, WHISPER_SAMPLE_RATE);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return (await context.startRendering()).getChannelData(0);
}

/** Drops Whisper's non-speech annotations such as `[BLANK_AUDIO]` or `(music)`; empty when nothing is left. */
export function cleanTranscript(text: string): string {
  const cleaned = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : '';
}
