// Encounter-owned additions to the generated player-ability VFX catalog.
// Boss casts use display ids on the wire, so they live beside the painter
// instead of being written into the generated class-ability tables.

import {
  IGNIVAR_FORGE_WAVE_CAST_ID,
  IGNIVAR_FRONTAL_CAST_ID,
  IGNIVAR_JUDGMENT_CAST_ID,
  IGNIVAR_LAST_INFERNO_AURA_ID,
  IGNIVAR_SKYFIRE_CAST_ID,
} from '../../sim/encounters/ignivar';
import { DUNGEON_MINIBOSS_STOMP_ABILITY_ID } from '../../sim/mob/dungeon_miniboss_stomp';
import { NYTHRAXIS_BONE_SPIKE_CAST_ID } from '../../sim/nythraxis_bone_spike';
import { NYTHRAXIS_DREAD_CURSE_CAST_ID } from '../../sim/nythraxis_dread_curse';
import {
  NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_FLAME_CAST_ID,
} from '../../sim/nythraxis_grave_eruption';
import type { AbilityVfxFullSpec, AbilityVfxSpec } from '../ability_vfx_core';
import { abilityVfxFullSpec, abilityVfxSpec } from '../ability_vfx_registry';

const ENCOUNTER_VFX_SPECS: Readonly<Record<string, AbilityVfxSpec>> = {
  [DUNGEON_MINIBOSS_STOMP_ABILITY_ID]: {
    c: '#ff8a26',
    p: 'fire',
    pw: 1.35,
    sp: 30,
    rg: 1,
    vr: 1,
    sm: 1,
    li: 2.2,
    a: 'burst',
  },
  [IGNIVAR_FRONTAL_CAST_ID]: {
    c: '#ff4a12',
    p: 'fire',
    pw: 1.6,
    sp: 60,
    rg: 0,
    vr: 1,
    sm: 1,
    li: 3.2,
    a: 'burst',
  },
  [IGNIVAR_SKYFIRE_CAST_ID]: {
    c: '#ff5210',
    p: 'fire',
    pw: 1.75,
    sp: 54,
    rg: 0,
    vr: 1,
    sm: 1,
    li: 3.4,
    a: 'burst',
  },
  [IGNIVAR_FORGE_WAVE_CAST_ID]: {
    c: '#ff6a14',
    p: 'fire',
    pw: 1.8,
    sp: 60,
    rg: 0,
    vr: 1,
    sm: 1,
    li: 3.8,
    a: 'burst',
  },
  [IGNIVAR_JUDGMENT_CAST_ID]: {
    c: '#ff6814',
    p: 'fire',
    pw: 1.9,
    sp: 64,
    rg: 0,
    vr: 1,
    sm: 1,
    li: 4,
    a: 'burst',
  },
  [IGNIVAR_LAST_INFERNO_AURA_ID]: {
    c: '#ff3b0a',
    p: 'fire',
    pw: 1.6,
    sp: 36,
    vr: 1,
    sm: 1,
    li: 2.8,
    lg: 45,
    a: 'buff',
  },
  // Nythraxis (shadow school throughout): the bone spike that pins a raider,
  // the grave eruption under its telegraph circles, the ground fire it leaves,
  // and the stacking curse on the tank.
  [NYTHRAXIS_BONE_SPIKE_CAST_ID]: {
    c: '#b48cff',
    p: 'shadow',
    pw: 1.5,
    sp: 36,
    rg: 0,
    vr: 1,
    sm: 1,
    li: 2.4,
    a: 'burst',
  },
  [NYTHRAXIS_GRAVE_ERUPTION_CAST_ID]: {
    c: '#6dff4f',
    p: 'shadow',
    pw: 1.7,
    sp: 48,
    rg: 0,
    vr: 1,
    sm: 1,
    li: 3,
    a: 'burst',
  },
  [NYTHRAXIS_GRAVE_FLAME_CAST_ID]: {
    c: '#8cff6a',
    p: 'shadow',
    pw: 0.7,
    sp: 6,
    sm: 1,
    li: 0.5,
    lg: 2,
    a: 'dot',
  },
  [NYTHRAXIS_DREAD_CURSE_CAST_ID]: {
    c: '#8a6ab8',
    p: 'shadow',
    pw: 1.2,
    sp: 14,
    sm: 1,
    li: 1,
    lg: 4,
    a: 'dot',
  },
};

const ENCOUNTER_VFX_FULL_SPECS: Readonly<Record<string, AbilityVfxFullSpec>> = {
  [IGNIVAR_FRONTAL_CAST_ID]: {
    archetype: 'burst',
    palette: 'fire',
    power: 1.6,
    windupStyle: 'vortex',
    motifs: ['fissure', 'pillars'],
    motifAt: 'target',
    motifR: 2.4,
    burst: { style: 'ground' },
    impact: {
      flipbook: true,
      ring: false,
      vRing: true,
      sparks: 60,
      smoke: true,
      light: 3.2,
    },
    screenFx: true,
    rim: '#ff7a24',
  },
  [IGNIVAR_SKYFIRE_CAST_ID]: {
    archetype: 'burst',
    palette: 'fire',
    power: 1.75,
    windupStyle: 'vortex',
    motifs: ['fissure', 'pillars'],
    motifAt: 'target',
    motifR: 2.8,
    burst: { style: 'ground' },
    impact: {
      flipbook: true,
      ring: false,
      vRing: true,
      sparks: 54,
      smoke: true,
      light: 3.4,
    },
    screenFx: true,
    rim: '#ff9a32',
  },
  [IGNIVAR_FORGE_WAVE_CAST_ID]: {
    archetype: 'burst',
    palette: 'fire',
    power: 1.8,
    windupStyle: 'vortex',
    motifs: ['pillars'],
    motifAt: 'caster',
    motifR: 2.8,
    burst: { style: 'ground' },
    impact: {
      flipbook: true,
      ring: false,
      vRing: true,
      sparks: 60,
      smoke: true,
      light: 3.8,
    },
    screenFx: true,
    rim: '#ffc15a',
  },
  [IGNIVAR_JUDGMENT_CAST_ID]: {
    archetype: 'burst',
    palette: 'fire',
    power: 1.9,
    windupStyle: 'ascend',
    motifs: ['fissure', 'pillars'],
    motifAt: 'target',
    motifR: 3.1,
    burst: { style: 'ground' },
    impact: {
      flipbook: true,
      ring: false,
      vRing: true,
      sparks: 64,
      smoke: true,
      light: 4,
    },
    screenFx: true,
    rim: '#ffc05a',
  },
  [IGNIVAR_LAST_INFERNO_AURA_ID]: {
    archetype: 'buff',
    palette: 'fire',
    power: 1.6,
    windupStyle: 'ascend',
    motifs: ['orbitals', 'pillars'],
    motifAt: 'caster',
    motifR: 2.8,
    buff: {
      style: 'raise',
      orbit: 'halo',
      o: { n: 8, size: 1.4, radius: 2.8, rate: 1.8 },
    },
    impact: {
      flipbook: true,
      ring: false,
      vRing: true,
      sparks: 36,
      smoke: true,
      light: 2.8,
    },
    screenFx: true,
    rim: '#ff6a1a',
  },
  // Bone Spike: one spike punches up under a single raider, so the read stays
  // concentrated on the victim (focused impact, a tight pillar motif).
  [NYTHRAXIS_BONE_SPIKE_CAST_ID]: {
    archetype: 'burst',
    palette: 'shadow',
    power: 1.5,
    windupStyle: 'runes',
    motifs: ['pillars'],
    motifAt: 'target',
    motifR: 0.9,
    burst: { style: 'ground' },
    impact: {
      flipbook: false,
      ring: false,
      vRing: true,
      sparks: 36,
      smoke: true,
      light: 2.4,
      focused: true,
    },
    rim: '#8d5cff',
  },
  // Grave Eruption: skeletal hands burst up through the flagstones across the
  // whole 3 yd circle (fissure plus pillars at the authored radius); the
  // telegraph ring itself is mage_ground_fx.ts, this is the landing.
  [NYTHRAXIS_GRAVE_ERUPTION_CAST_ID]: {
    archetype: 'burst',
    palette: 'shadow',
    power: 1.7,
    windupStyle: 'runes',
    motifs: ['fissure', 'pillars'],
    motifAt: 'target',
    motifR: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
    burst: { style: 'ground' },
    impact: {
      flipbook: false,
      ring: false,
      vRing: true,
      sparks: 48,
      smoke: true,
      light: 3,
    },
    rim: '#6dff4f',
  },
  // Grave Flame: a one-second tick for standing in the patch. Quiet on purpose
  // (the patch painter owns the read); a filler so the ticks never crescendo.
  [NYTHRAXIS_GRAVE_FLAME_CAST_ID]: {
    archetype: 'dot',
    palette: 'shadow',
    power: 0.7,
    filler: true,
    dot: { drip: 'rise' },
    linger: 2,
    impact: {
      flipbook: false,
      ring: false,
      vRing: false,
      debris: false,
      sparks: 6,
      smoke: true,
      light: 0.5,
    },
  },
  // Dread Curse: dread made visible on the tank, the curse_of_agony read with
  // chains for the stacking swap call.
  [NYTHRAXIS_DREAD_CURSE_CAST_ID]: {
    archetype: 'dot',
    palette: 'shadow',
    power: 1.2,
    dot: { drip: 'fall' },
    linger: 4,
    motifs: ['chains'],
    motifAt: 'target',
    impact: {
      flipbook: false,
      ring: false,
      vRing: false,
      debris: false,
      sparks: 14,
      smoke: true,
      light: 1,
    },
    decal: 'rune',
  },
};

// Fall back through the bespoke class registry, never the raw generated
// tables: class-owned premium identities (destruction, necromancy, warlock
// pets) must keep routing even when the painter resolves via this overlay.
export function abilityVfxSpecFor(abilityId: string): AbilityVfxSpec | undefined {
  return ENCOUNTER_VFX_SPECS[abilityId] ?? abilityVfxSpec(abilityId);
}

export function abilityVfxFullSpecFor(abilityId: string): AbilityVfxFullSpec | undefined {
  return ENCOUNTER_VFX_FULL_SPECS[abilityId] ?? abilityVfxFullSpec(abilityId);
}
