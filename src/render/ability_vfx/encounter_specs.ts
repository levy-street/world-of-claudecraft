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
