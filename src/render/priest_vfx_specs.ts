import { ABILITY_VFX_ART_PROFILES } from './ability_vfx_art_profiles';
import type { AbilityVfxFullSpec } from './ability_vfx_core';

// Keep the fear wave and its actual controlled victims readable through contact.
export const PRIEST_VFX_FULL_SPECS: Record<string, AbilityVfxFullSpec> = {
  psychic_scream: {
    ...ABILITY_VFX_ART_PROFILES.psychic_scream,
    impact: { ...ABILITY_VFX_ART_PROFILES.psychic_scream.impact, vRing: false },
  },
};
