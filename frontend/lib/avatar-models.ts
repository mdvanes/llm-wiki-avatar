import type { AvatarGender } from './presentation';

/** TalkingHead sample avatars that `npm run fetch-avatar` can download (see scripts/fetch-avatar.mjs). */
export const AVATAR_SAMPLES: Record<string, { nonCommercial: boolean }> = {
  mpfb: { nonCommercial: false },
  avatarsdk: { nonCommercial: true },
  brunette: { nonCommercial: true },
  avaturn: { nonCommercial: true },
  vroid: { nonCommercial: true },
};

export const AVATAR_URL_ENV: Record<AvatarGender, string> = {
  female: 'AVATAR_FEMALE_URL',
  male: 'AVATAR_MALE_URL',
};

export interface MissingAvatarHelp {
  gender: AvatarGender;
  url: string;
  /** The .env setting that points at the model. */
  envVar: string;
  /** Command that downloads the model; absent for models that are not a known sample. */
  command?: string;
  nonCommercial: boolean;
}

/** What to tell the user when the avatar model file is missing. */
export function missingAvatarHelp(url: string, gender: AvatarGender): MissingAvatarHelp {
  const envVar = AVATAR_URL_ENV[gender];
  const sample = /^\/avatars\/([a-z0-9_-]+)\.glb$/i.exec(url)?.[1];
  if (!sample || !(sample in AVATAR_SAMPLES)) return { gender, url, envVar, nonCommercial: false };
  return {
    gender,
    url,
    envVar,
    command: sample === 'mpfb' ? 'npm run fetch-avatar' : `npm run fetch-avatar -- ${sample}`,
    nonCommercial: AVATAR_SAMPLES[sample]!.nonCommercial,
  };
}
