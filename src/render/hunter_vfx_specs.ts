import { ABILITY_VFX_ART_PROFILES } from './ability_vfx_art_profiles';
import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';
import { ABILITY_VFX_SPECS } from './ability_vfx_specs';

export const HUNTER_VFX_FULL_SPECS: Record<string, AbilityVfxFullSpec> = {};
export const HUNTER_VFX_SPECS: Record<string, AbilityVfxSpec> = {};
HUNTER_VFX_FULL_SPECS.shellskin = {
  ...ABILITY_VFX_ART_PROFILES.shellskin,
  presentation: 'dedicated',
  spirit: undefined,
  impact: { ring: false, vRing: false, sparks: 0, flipbook: false },
};
// Preserve the actual arrow, interrupt and raining-volley choreography.
// A ranged weapon has a narrow launch and contact, not a caster-sized halo.
for (const id of ['aimed_shot', 'counter_shot', 'concussive_shot', 'volley']) {
  const base = ABILITY_VFX_ART_PROFILES[id];
  HUNTER_VFX_FULL_SPECS[id] = {
    ...base,
    finisher: false,
    filler: true,
    chargeStreams: 1,
    impact: {
      ...base.impact,
      flipbook: false,
      vRing: false,
      ring: id === 'volley' ? 0.7 : false,
      sparks: id === 'volley' ? 18 : 9,
    },
  };
  HUNTER_VFX_SPECS[id] = {
    ...ABILITY_VFX_SPECS[id],
    fin: undefined,
    vr: undefined,
    rg: id === 'volley' ? 0.7 : 0,
    sp: 9,
  };
}
