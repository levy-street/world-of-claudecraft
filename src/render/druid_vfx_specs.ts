import { ABILITY_VFX_ART_PROFILES } from './ability_vfx_art_profiles';
import type { AbilityVfxFullSpec } from './ability_vfx_core';

export const DRUID_VFX_FULL_SPECS: Record<string, AbilityVfxFullSpec> = {
  moonkin_form: {
    ...ABILITY_VFX_ART_PROFILES.moonkin_form,
    spirit: null,
    decal: undefined,
    windup: 0.15,
    windupStyle: 'none',
    motifs: ['crescents'],
    buff: {
      style: 'morph',
      orbit: 'leaves',
      persist: true,
      o: { size: 0.18, span: 1.1, density: 4, up: 0.25, spread: 0.5 },
    },
    ritual: {
      shape: 'moon',
      radius: 2.5,
      height: 3.2,
      width: 0.13,
      strands: 4,
      beats: [0, 0.16],
      duration: 0.35,
      twist: 0.3,
      anchor: 'caster',
    },
    impact: {
      ring: false,
      vRing: false,
      flipbook: false,
      sparks: 16,
      debris: false,
      smoke: false,
      light: 1.4,
    },
  },
};
