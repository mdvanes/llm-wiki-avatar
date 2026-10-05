import type { AvatarGender } from '../presentation';

export interface VrmModel {
  name: string;
  url: string;
  /** Credit link required by the CC BY 4.0 license. */
  creditUrl: string;
}

/** The 3D avatars, both by VTubeMe under CC BY 4.0. */
export const VRM_MODELS: Record<AvatarGender, VrmModel> = {
  female: { name: 'Ember', url: '/avatars/ember.vrm', creditUrl: 'https://vtubeme.com' },
  male: { name: 'Nova', url: '/avatars/nova.vrm', creditUrl: 'https://vtubeme.com' },
};
