import type { AbilityVfxFullSpec } from './ability_vfx_core';
import { ABILITY_VFX_FULL_SPECS } from './ability_vfx_full_specs';

// Rotation-sized contact lets the authored ultimates keep their contrast.
// This overlay never replaces nested impact, projectile, spirit or motif data.
const ROTATIONAL = new Set([
  'heroic_strike',
  'hamstring',
  'pummel',
  'overpower',
  'sinister_strike',
  'backstab',
  'kick',
  'hemorrhage',
  'ghostly_strike',
  'fireball',
  'frostbolt',
  'arcane_blast',
  'scorch',
  'ice_lance',
  'smite',
  'mind_blast',
  'shadow_word_pain',
  'lightning_bolt',
  'earth_shock',
  'flame_shock',
  'frost_shock',
  'wrath',
  'moonfire',
  'starfire',
  'claw',
  'rake',
  'shred',
  'maul',
  'mangle',
  'arcane_shot',
  'steady_shot',
  'serpent_sting',
  'raptor_strike',
  'crusader_strike',
  'judgement',
  'corruption',
  'curse_of_agony',
]);
const ACCENTS: Record<string, string> = {
  physical: '#e4efff',
  blood: '#ff9986',
  fire: '#ffe5a6',
  frost: '#c4faff',
  storm: '#edeeff',
  arcane: '#ffc6fb',
  shadow: '#ba8eff',
  moon: '#e4ddff',
  holy: '#fff4ca',
  gold: '#fff1ab',
  nature: '#d9ff9e',
  poison: '#d8ff62',
};

export const ABILITY_VFX_ART_PROFILES: Record<string, AbilityVfxFullSpec> = {};
for (const [id, base] of Object.entries(ABILITY_VFX_FULL_SPECS)) {
  const healStyle =
    base.archetype === 'heal'
      ? base.palette === 'nature'
        ? 'bloom'
        : base.palette === 'holy' || base.palette === 'gold'
          ? 'benediction'
          : base.palette === 'arcane'
            ? 'rewind'
            : undefined
      : undefined;
  // Quiet concealment and barriers retain their authored silhouette. A morph
  // releases once at completion; it never holds an extra aura decoration.
  const ceremony =
    base.archetype === 'buff' && !base.barrier
      ? base.buff?.style === 'morph'
        ? 'spiritCoils'
        : base.buff?.style === 'raise' && base.buff.orbit !== 'none'
          ? 'ascend'
          : undefined
      : undefined;
  ABILITY_VFX_ART_PROFILES[id] = {
    ...base,
    accent: base.accent ?? base.rim ?? ACCENTS[base.palette],
    filler: base.filler ?? (ROTATIONAL.has(id) && !base.finisher),
    healStyle,
    ...(ceremony ? { buff: { ...base.buff, ceremony } } : {}),
  };
}
