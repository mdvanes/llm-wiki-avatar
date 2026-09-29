import { afterEach, describe, expect, it, vi } from 'vitest';
import { missingAvatarHelp } from '@/lib/avatar-models';
import {
  PRESENTATIONS,
  avatarOf,
  isPresentation,
  loadPresentation,
  presentationForVoice,
  savePresentation,
  voiceOf,
} from '@/lib/presentation';
import { avatarSettings } from '@/lib/server-config';

describe('presentation', () => {
  it('maps each option to a voice and an avatar', () => {
    expect(PRESENTATIONS.map((p) => [p, voiceOf(p), avatarOf(p)])).toEqual([
      ['off', 'off', null],
      ['voice-female', 'female', null],
      ['voice-male', 'male', null],
      ['avatar-female', 'female', 'female'],
      ['avatar-male', 'male', 'male'],
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

describe('avatarSettings', () => {
  it('defaults to the female and male samples', () => {
    const s = avatarSettings({});
    expect(s.models).toEqual({
      female: { url: '/avatars/mpfb.glb', body: 'F' },
      male: { url: '/avatars/avatarsdk.glb', body: 'M' },
    });
    expect(s).toMatchObject({ view: 'head', cameraY: null, cameraDistance: 0, defaultPresentation: 'avatar-female' });
  });

  it('uses the per-gender URLs', () => {
    const s = avatarSettings({ AVATAR_FEMALE_URL: '/avatars/vroid.glb', AVATAR_MALE_URL: 'https://x/m.glb' });
    expect(s.models.female.url).toBe('/avatars/vroid.glb');
    expect(s.models.male.url).toBe('https://x/m.glb');
  });

  it('puts the older AVATAR_URL in the slot given by AVATAR_BODY', () => {
    expect(avatarSettings({ AVATAR_URL: '/avatars/brunette.glb' }).models.female.url).toBe('/avatars/brunette.glb');
    const male = avatarSettings({ AVATAR_URL: '/avatars/custom.glb', AVATAR_BODY: 'm' }).models;
    expect(male.male.url).toBe('/avatars/custom.glb');
    expect(male.female.url).toBe('/avatars/mpfb.glb');
  });

  it('starts with the presentation that matches DEFAULT_VOICE', () => {
    expect(avatarSettings({ DEFAULT_VOICE: 'male' }).defaultPresentation).toBe('avatar-male');
    expect(avatarSettings({ DEFAULT_VOICE: 'off' }).defaultPresentation).toBe('off');
    expect(avatarSettings({ DEFAULT_VOICE: 'x' }).defaultPresentation).toBe('avatar-female');
  });
});

describe('missingAvatarHelp', () => {
  it('gives the fetch command for known samples', () => {
    expect(missingAvatarHelp('/avatars/avatarsdk.glb', 'male')).toEqual({
      gender: 'male',
      url: '/avatars/avatarsdk.glb',
      envVar: 'AVATAR_MALE_URL',
      command: 'npm run fetch-avatar -- avatarsdk',
      nonCommercial: true,
    });
    expect(missingAvatarHelp('/avatars/mpfb.glb', 'female')).toMatchObject({
      command: 'npm run fetch-avatar',
      nonCommercial: false,
      envVar: 'AVATAR_FEMALE_URL',
    });
  });

  it('points at the setting for other models', () => {
    for (const url of ['/avatars/mine.glb', 'https://cdn.example.com/avatarsdk.glb']) {
      const help = missingAvatarHelp(url, 'male');
      expect(help.command).toBeUndefined();
      expect(help.envVar).toBe('AVATAR_MALE_URL');
    }
  });
});
