import { ABILITY_VFX_ART_PROFILES } from './ability_vfx_art_profiles';
import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';
import { ABILITY_VFX_SPECS } from './ability_vfx_specs';

// Water gathers around the healed body. It never draws binding chains or a
// damaging floor footprint. The real heal events own targets and chain hops.
const waterImpact = {
  flipbook: false,
  ring: false,
  vRing: false,
  sparks: 7,
  debris: false,
  smoke: false,
  light: 0.7,
};
export const SHAMAN_VFX_FULL_SPECS: Record<string, AbilityVfxFullSpec> = {
  lightning_shield: {
    ...ABILITY_VFX_ART_PROFILES.lightning_shield,
    windupStyle: 'conduction',
    chargeStreams: 1,
    decal: undefined,
    motifs: [],
    buff: {
      style: 'raise',
      persist: true,
      orbit: 'wardCharges',
      o: { tex: 'trace', n: 3, size: 0.22, radius: 0.7, up: 0.65, rate: 1.8 },
    },
    ritual: {
      shape: 'storm',
      radius: 1.6,
      height: 2.4,
      width: 0.085,
      strands: 3,
      beats: [0, 0.12],
      duration: 0.28,
      twist: 0.2,
      anchor: 'caster',
    },
    impact: { ring: false, vRing: false, flipbook: false, sparks: 12, light: 0.9 },
  },
  elemental_mastery: {
    ...ABILITY_VFX_ART_PROFILES.elemental_mastery,
    archetype: 'buff',
    palette: 'nature',
    tint: '#71cce9',
    accent: '#e4ffff',
    buff: {
      style: 'raise',
      persist: true,
      weaponAura: '#9deaff',
      orbit: 'conduction',
      o: { tex: 'trace', n: 4, size: 0.24, radius: 0.65, up: 0.65, rate: 1.8 },
    },
    motifs: [],
  },
  healing_wave: {
    archetype: 'heal',
    palette: 'frost',
    tint: '#319cac',
    accent: '#bbeee8',
    rim: '#e4ffef',
    power: 0.95,
    windupStyle: 'ascend',
    motifs: [],
    healStyle: 'water',
    shaft: false,
    screenFx: false,
    impact: waterImpact,
  },
  chain_heal: {
    archetype: 'heal',
    palette: 'frost',
    tint: '#319cac',
    accent: '#bbeee8',
    rim: '#e4ffef',
    power: 1.15,
    windupStyle: 'ascend',
    motifs: [],
    healStyle: 'water',
    motifAt: 'target',
    shaft: false,
    screenFx: false,
    impact: waterImpact,
  },
  ghost_wolf: {
    archetype: 'buff',
    palette: 'moon',
    tint: '#6b91c7',
    accent: '#c6e8f2',
    rim: '#b7d8fa',
    power: 0.85,
    windupStyle: 'vortex',
    chargeStreams: 3,
    screenFx: false,
    buff: {
      style: 'morph',
      ceremony: 'spiritCoils',
      shellDur: 0.65,
      orbit: 'speedlines',
      o: { rate: 0.9, tickEvery: 3.5, n: 3, size: 0.12 },
    },
    impact: { flipbook: false, ring: false, sparks: 10, smoke: false, light: 0.65 },
  },
};
export const SHAMAN_VFX_SPECS: Record<string, AbilityVfxSpec> = {
  healing_wave: { c: '#319cac', p: 'frost', pw: 0.95, sp: 7, li: 0.7, a: 'heal' },
  chain_heal: { c: '#319cac', p: 'frost', pw: 1.15, sp: 7, li: 0.7, a: 'heal' },
  ghost_wolf: { c: '#6b91c7', p: 'moon', pw: 0.85, sp: 10, li: 0.65, bo: 'speedlines', a: 'buff' },
};
// Lightning keeps its branching flight and Stormstrike its paired weapon
// contacts; neither releases a spherical spell explosion around the caster.
for (const id of ['lightning_bolt', 'stormstrike']) {
  const base = ABILITY_VFX_ART_PROFILES[id];
  SHAMAN_VFX_FULL_SPECS[id] = {
    ...base,
    finisher: false,
    filler: true,
    chargeStreams: 1,
    impact: { ...base.impact, flipbook: false, ring: false, vRing: false, sparks: 12 },
  };
  SHAMAN_VFX_SPECS[id] = { ...ABILITY_VFX_SPECS[id], fin: undefined, rg: 0, vr: undefined, sp: 12 };
}
