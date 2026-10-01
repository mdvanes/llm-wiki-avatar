import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRESENTATIONS,
  avatarOf,
  isPresentation,
  lipsyncOf,
  loadPresentation,
  presentationForVoice,
  savePresentation,
  voiceOf,
} from '@/lib/presentation';
import { defaultPresentation } from '@/lib/server-config';

describe('presentation', () => {
  it('maps each option to a voice and an avatar', () => {
    expect(PRESENTATIONS.map((p) => [p, voiceOf(p), avatarOf(p), lipsyncOf(p)])).toEqual([
      ['off', 'off', null, 'audio'],
      ['voice-female', 'female', null, 'audio'],
      ['voice-male', 'male', null, 'audio'],
      ['avatar-female', 'female', 'female', 'audio'],
      ['avatar-female-premium', 'female', 'female', 'words'],
      ['avatar-male', 'male', 'male', 'audio'],
    ]);
  });

  it('validates values', () => {
    expect(isPresentation('avatar-male')).toBe(true);
    expect(isPresentation('avatar')).toBe(false);
    expect(isPresentation(null)).toBe(false);
  });

  it('picks the avatar option that matches a voice', () => {
    expect(presentationForVoice('off')).toBe('off');
    expect(presentationForVoice('male')).toBe('avatar-male');
  });

  describe('storage', () => {
    afterEach(() => vi.unstubAllGlobals());

    function stubStorage(initial: Record<string, string> = {}) {
      const data = new Map(Object.entries(initial));
      vi.stubGlobal('window', {
        localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) },
      });
      return data;
    }

    it('falls back on the server side and for invalid stored values', () => {
      expect(loadPresentation('voice-male')).toBe('voice-male');
      stubStorage({ 'llm-wiki-avatar.presentation': 'hologram' });
      expect(loadPresentation()).toBe('avatar-female');
    });

    it('remembers the choice', () => {
      stubStorage();
      savePresentation('voice-female');
      expect(loadPresentation()).toBe('voice-female');
    });
  });
});

describe('defaultPresentation', () => {
  it('starts with the presentation that matches DEFAULT_VOICE', () => {
    expect(defaultPresentation({})).toBe('avatar-female');
    expect(defaultPresentation({ DEFAULT_VOICE: 'male' })).toBe('avatar-male');
    expect(defaultPresentation({ DEFAULT_VOICE: 'off' })).toBe('off');
    expect(defaultPresentation({ DEFAULT_VOICE: 'x' })).toBe('avatar-female');
  });
});
