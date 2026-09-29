import { stt } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';
import { ReadableStream } from 'node:stream/web';
import { describe, expect, it, vi } from 'vitest';
import { type InputSession, InputModeController, SttTap, isInputMode } from '../src/inputMode.ts';

const { START_OF_SPEECH, END_OF_SPEECH, FINAL_TRANSCRIPT } = stt.SpeechEventType;

function fakeSession() {
  const calls: string[] = [];
  const session: InputSession = {
    interrupt: () => calls.push('interrupt'),
    clearUserTurn: () => calls.push('clear'),
    commitUserTurn: () => calls.push('commit'),
    updateOptions: (o) => calls.push(`turnDetection:${String(o.turnHandling?.turnDetection)}`),
    input: { setAudioEnabled: (on) => calls.push(on ? 'audio:on' : 'audio:off') },
  };
  return { session, calls };
}

const fast = { autoTurnDetection: 'vad' as const, settleMs: 5, transcriptTimeoutMs: 200 };

describe('isInputMode', () => {
  it('accepts the two modes only', () => {
    expect(isInputMode('always')).toBe(true);
    expect(isInputMode('ptt')).toBe(true);
    expect(isInputMode('vad')).toBe(false);
  });
});

describe('InputModeController', () => {
  it('switches turn detection and the microphone input with the mode', () => {
    const { session, calls } = fakeSession();
    const ctl = new InputModeController(session, new SttTap(), fast);
    ctl.setMode('ptt');
    ctl.setMode('ptt');
    ctl.setMode('always');
    expect(calls).toEqual(['turnDetection:manual', 'clear', 'audio:off', 'turnDetection:vad', 'audio:on']);
  });

  it('refuses push-to-talk turns in always-on mode', () => {
    const ctl = new InputModeController(fakeSession().session, new SttTap(), fast);
    expect(() => ctl.startTurn()).toThrow(/not enabled/);
  });

  it('interrupts the agent on press and commits once the transcript is in', async () => {
    const { session, calls } = fakeSession();
    const tap = new SttTap();
    const ctl = new InputModeController(session, tap, fast);
    ctl.setMode('ptt');
    calls.length = 0;

    ctl.startTurn();
    expect(calls).toEqual(['interrupt', 'clear', 'audio:on']);
    tap.observe(START_OF_SPEECH);
    const ended = ctl.endTurn();
    setTimeout(() => tap.observe(END_OF_SPEECH), 20);
    setTimeout(() => tap.observe(FINAL_TRANSCRIPT), 40);
    await expect(ended).resolves.toBe('committed');
    expect(calls.slice(3)).toEqual(['audio:off', 'commit']);
  });

  it('clears the turn when nothing was said', async () => {
    const { session, calls } = fakeSession();
    const ctl = new InputModeController(session, new SttTap(), fast);
    ctl.setMode('ptt');
    ctl.startTurn();
    calls.length = 0;
    await expect(ctl.endTurn()).resolves.toBe('empty');
    expect(calls).toEqual(['audio:off', 'clear']);
  });

  it('gives up waiting for a transcript that never comes', async () => {
    const { session, calls } = fakeSession();
    const tap = new SttTap();
    const ctl = new InputModeController(session, tap, fast);
    ctl.setMode('ptt');
    ctl.startTurn();
    tap.observe(START_OF_SPEECH);
    tap.observe(END_OF_SPEECH);
    calls.length = 0;
    await expect(ctl.endTurn()).resolves.toBe('empty');
    expect(calls).toEqual(['audio:off', 'clear']);
  });

  it('ignores a release that a new press has overtaken', async () => {
    const { session, calls } = fakeSession();
    const tap = new SttTap();
    const ctl = new InputModeController(session, tap, fast);
    ctl.setMode('ptt');
    ctl.startTurn();
    tap.observe(START_OF_SPEECH);
    const ended = ctl.endTurn();
    ctl.startTurn();
    calls.length = 0;
    tap.observe(END_OF_SPEECH);
    tap.observe(FINAL_TRANSCRIPT);
    await expect(ended).resolves.toBe('superseded');
    expect(calls).not.toContain('commit');
  });
});

describe('SttTap', () => {
  it('passes audio through and appends silence in the same format', async () => {
    const tap = new SttTap();
    const frame = new AudioFrame(new Int16Array(480).fill(1000), 24000, 1, 480);
    let push!: (f: AudioFrame) => void;
    const source = new ReadableStream<AudioFrame>({ start: (c) => void (push = (f) => c.enqueue(f)) });
    const reader = tap.wrapAudio(source).getReader();

    expect(tap.injectSilence(100)).toBe(false);
    push(frame);
    expect((await reader.read()).value).toBe(frame);
    expect(tap.injectSilence(100)).toBe(true);
    const silence = [];
    for (let i = 0; i < 5; i++) silence.push((await reader.read()).value!);
    expect(silence.every((f) => f.sampleRate === 24000 && f.samplesPerChannel === 480)).toBe(true);
    expect(silence.every((f) => f.data.every((s) => s === 0))).toBe(true);
    await reader.cancel();
  });

  it('tracks speech and transcription progress from STT events', async () => {
    const tap = new SttTap();
    const events = new ReadableStream<stt.SpeechEvent>({
      start(c) {
        for (const type of [START_OF_SPEECH, END_OF_SPEECH]) c.enqueue({ type });
        c.close();
      },
    });
    const seen = [];
    for await (const ev of tap.watchEvents(events)) seen.push(ev);
    expect(seen).toHaveLength(2);
    expect(tap.busy).toBe(true);
    const idle = tap.waitUntilIdle(1000);
    tap.observe(FINAL_TRANSCRIPT);
    await expect(idle).resolves.toBe(true);
    expect(tap.finals).toBe(1);
  });

  it('reports a timeout while still busy', async () => {
    vi.useFakeTimers();
    const tap = new SttTap();
    tap.observe(START_OF_SPEECH);
    const idle = tap.waitUntilIdle(500);
    vi.advanceTimersByTime(500);
    await expect(idle).resolves.toBe(false);
    vi.useRealTimers();
  });
});
