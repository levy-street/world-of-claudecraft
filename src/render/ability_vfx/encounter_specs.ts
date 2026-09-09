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
import {
  NYTHRAXIS_GRAVEBREAKER_CAST_ID,
  NYTHRAXIS_SHUDDERING_STOMP_CAST_ID,
} from '../../sim/encounters/nythraxis';
import { DUNGEON_MINIBOSS_STOMP_ABILITY_ID } from '../../sim/mob/dungeon_miniboss_stomp';
import {
  NYTHRAXIS_SIGIL_CAST_ID,
  NYTHRAXIS_UNBOUND_CAST_ID,
} from '../../sim/nythraxis_binding_sigil';
import { NYTHRAXIS_BONE_SPIKE_CAST_ID } from '../../sim/nythraxis_bone_spike';
import {
  NYTHRAXIS_BONE_SLAM_CAST_ID,
  NYTHRAXIS_BONE_STORM_CAST_ID,
  NYTHRAXIS_BONE_STORM_RADIUS,
} from '../../sim/nythraxis_bone_storm';
import { NYTHRAXIS_DREAD_CURSE_CAST_ID } from '../../sim/nythraxis_dread_curse';
import { NYTHRAXIS_CROWN_ENDURES_CAST_ID } from '../../sim/nythraxis_enrage_clock';
import {
  NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_FLAME_CAST_ID,
} from '../../sim/nythraxis_grave_eruption';
import { NYTHRAXIS_GRAVEFIRE_CAST_ID } from '../../sim/nythraxis_gravefire';
import { NYTHRAXIS_KINGS_WRATH_AURA_NAME } from '../../sim/nythraxis_kings_wrath';
import { NYTHRAXIS_SOULFIRE_CAST_ID } from '../../sim/nythraxis_soulfire';
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
    c: '#9a5df0',
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
    c: '#8a5cf0',
    p: 'shadow',
    pw: 0.7,
    sp: 6,
    sm: 1,
    li: 0.5,
    lg: 2,
    a: 'dot',
  },
  [NYTHRAXIS_SOULFIRE_CAST_ID]: {
    c: '#c84fff',
    // 'blood' maps to the fire school's orange light pulse (SCHOOL_BY_PALETTE):
    // 'shadow' keeps the impact light purple without touching that shared map.
    p: 'shadow',
    pw: 0.65,
    sp: 5,
    li: 0.4,
    lg: 2,
    a: 'dot',
  },
  [NYTHRAXIS_GRAVEFIRE_CAST_ID]: {
    c: '#a06cff',
    p: 'shadow',
    pw: 1.15,
    sp: 10,
    sm: 1,
    li: 1.2,
    lg: 1.2,
    a: 'beam',
  },
  [NYTHRAXIS_SIGIL_CAST_ID]: {
    c: '#7fc0ff',
    p: 'arcane',
    pw: 0.9,
    sp: 8,
    rg: 1,
    li: 0.7,
    lg: 2,
    a: 'nova',
  },
  [NYTHRAXIS_UNBOUND_CAST_ID]: {
    c: '#a06cff',
    p: 'shadow',
    pw: 1.8,
    sp: 54,
    rg: 1.5,
    vr: 1,
    sm: 1,
    li: 3.2,
    lg: 3,
    a: 'nova',
  },
  [NYTHRAXIS_BONE_STORM_CAST_ID]: {
    c: '#a879ff',
    // 'physical' maps to a pale-gold light pulse (SCHOOL_BY_PALETTE): 'shadow'
    // keeps the impact light purple. The debris burst stays keyed on the
    // impact.debris flag and the ability's own tint, not this field, and the
    // sim's dealDamage school (physical) is untouched.
    p: 'shadow',
    pw: 1.9,
    sp: 60,
    rg: NYTHRAXIS_BONE_STORM_RADIUS / 4,
    vr: 1,
    db: 1,
    sm: 1,
    li: 3.4,
    lg: 12,
    a: 'nova',
  },
  [NYTHRAXIS_BONE_SLAM_CAST_ID]: {
    c: '#c79bff',
    p: 'shadow',
    pw: 1.7,
    sp: 48,
    rg: NYTHRAXIS_BONE_STORM_RADIUS / 4,
    vr: 1,
    db: 1,
    sm: 1,
    li: 3,
    a: 'nova',
  },
  [NYTHRAXIS_KINGS_WRATH_AURA_NAME]: {
    c: '#8f54d8',
    p: 'shadow',
    pw: 2,
    sp: 64,
    rg: 3,
    vr: 1,
    sm: 1,
    li: 4,
    lg: 3,
    a: 'nova',
  },
  [NYTHRAXIS_CROWN_ENDURES_CAST_ID]: {
    c: '#5b268f',
    p: 'shadow',
    pw: 2.4,
    sp: 72,
    rg: 4.5,
    vr: 1,
    sm: 1,
    li: 4.8,
    lg: 5,
    a: 'nova',
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
  // Gravebreaker and Shuddering Stomp are boss self-anchored cues (their
  // spellfx event carries no travel: sourceId === targetId === boss.id), not
  // scripted casts, so they stay quiet bursts rather than novas.
  [NYTHRAXIS_GRAVEBREAKER_CAST_ID]: {
    c: '#b48cff',
    p: 'shadow',
    pw: 1.3,
    sp: 16,
    li: 1.6,
    a: 'burst',
  },
  [NYTHRAXIS_SHUDDERING_STOMP_CAST_ID]: {
    c: '#9a5df0',
    p: 'shadow',
    pw: 1.6,
    sp: 24,
    rg: 2,
    vr: 1,
    sm: 1,
    li: 2.2,
    a: 'burst',
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
    rim: '#9a5df0',
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
  // Soulfire ticks stay quiet and purple because the persistent patch owns the
  // actionable read. This is only the small damage confirmation at its feet.
  // Palette is 'shadow' (not 'blood') so the impact light pulse stays purple;
  // 'blood' maps to the fire school's orange light through SCHOOL_BY_PALETTE.
  [NYTHRAXIS_SOULFIRE_CAST_ID]: {
    archetype: 'dot',
    palette: 'shadow',
    power: 0.65,
    filler: true,
    dot: { drip: 'rise' },
    linger: 2,
    tint: '#c84fff',
    rim: '#e8b8ff',
    impact: {
      flipbook: false,
      ring: false,
      vRing: false,
      debris: false,
      sparks: 5,
      smoke: false,
      light: 0.4,
    },
  },
  // The cast cue is a short shadow beam toward the chosen line direction. The
  // reconnect-safe floor strip carries the persistent threat after ignition.
  [NYTHRAXIS_GRAVEFIRE_CAST_ID]: {
    archetype: 'beam',
    palette: 'shadow',
    power: 1.15,
    filler: true,
    beam: { dur: 0.8, ticks: 1 },
    linger: 1.2,
    tint: '#a06cff',
    rim: '#d9b8ff',
    impact: {
      flipbook: false,
      ring: false,
      vRing: false,
      debris: false,
      sparks: 10,
      smoke: true,
      light: 1.2,
    },
  },
  // The stateful floor painter owns the countdown. This cue gives the cast a
  // matching blue rune inscription without competing with that timer.
  [NYTHRAXIS_SIGIL_CAST_ID]: {
    archetype: 'nova',
    palette: 'arcane',
    power: 0.9,
    filler: true,
    windupStyle: 'runes',
    nova: { radius: 4 },
    decal: 'rune',
    linger: 2,
    tint: '#7fc0ff',
    rim: '#cfe8ff',
    impact: {
      flipbook: false,
      ring: 1,
      vRing: false,
      debris: false,
      sparks: 8,
      smoke: false,
      light: 0.7,
    },
  },
  [NYTHRAXIS_UNBOUND_CAST_ID]: {
    archetype: 'nova',
    palette: 'shadow',
    power: 1.8,
    windupStyle: 'compression',
    motifs: ['fissure', 'pillars'],
    motifAt: 'caster',
    motifR: 10,
    nova: { radius: 10 },
    linger: 3,
    tint: '#7040b0',
    rim: '#d9b8ff',
    screenFx: true,
    impact: {
      flipbook: false,
      ring: 1.5,
      vRing: true,
      debris: true,
      sparks: 54,
      smoke: true,
      light: 3.2,
    },
  },
  // Bone Storm fills the nine-yard whirl with a purple cyclone (the
  // offensive-VFX purple pass; the bone-shard motif and debris shape are
  // driven by the motif list and impact.debris, not this palette, so they
  // stay physical). Palette is 'shadow' (not 'physical') so the impact light
  // pulse stays purple instead of SCHOOL_BY_PALETTE's pale-gold physical read;
  // the sim's dealDamage school is untouched. Its caster motif keeps the
  // storm centered while Nythraxis charges.
  [NYTHRAXIS_BONE_STORM_CAST_ID]: {
    archetype: 'nova',
    palette: 'shadow',
    power: 1.9,
    motifs: ['bladestorm', 'orbitals'],
    motifAt: 'caster',
    motifR: NYTHRAXIS_BONE_STORM_RADIUS,
    nova: { radius: NYTHRAXIS_BONE_STORM_RADIUS },
    linger: 12,
    tint: '#a879ff',
    rim: '#e6d4ff',
    impact: {
      flipbook: false,
      ring: NYTHRAXIS_BONE_STORM_RADIUS / 4,
      vRing: true,
      debris: true,
      sparks: 60,
      smoke: true,
      light: 3.4,
    },
  },
  [NYTHRAXIS_BONE_SLAM_CAST_ID]: {
    archetype: 'nova',
    palette: 'shadow',
    power: 1.7,
    motifs: ['fissure'],
    motifAt: 'caster',
    motifR: NYTHRAXIS_BONE_STORM_RADIUS,
    nova: { radius: NYTHRAXIS_BONE_STORM_RADIUS },
    tint: '#c79bff',
    rim: '#f0e0ff',
    impact: {
      flipbook: false,
      ring: NYTHRAXIS_BONE_STORM_RADIUS / 4,
      vRing: true,
      debris: true,
      sparks: 48,
      smoke: true,
      light: 3,
    },
  },
  [NYTHRAXIS_KINGS_WRATH_AURA_NAME]: {
    archetype: 'nova',
    palette: 'shadow',
    power: 2,
    windupStyle: 'ascend',
    motifs: ['pillars', 'orbitals'],
    motifAt: 'caster',
    motifR: 12,
    nova: { radius: 12 },
    linger: 3,
    tint: '#8f54d8',
    rim: '#d8b4ff',
    screenFx: true,
    impact: {
      flipbook: true,
      ring: 3,
      vRing: true,
      debris: false,
      sparks: 64,
      smoke: true,
      light: 4,
    },
  },
  [NYTHRAXIS_CROWN_ENDURES_CAST_ID]: {
    archetype: 'nova',
    palette: 'shadow',
    power: 2.4,
    windupStyle: 'compression',
    motifs: ['pillars', 'implosion', 'orbitals'],
    motifAt: 'caster',
    motifR: 18,
    nova: { radius: 18 },
    linger: 5,
    tint: '#5b268f',
    rim: '#efc7ff',
    screenFx: true,
    impact: {
      flipbook: true,
      ring: 4.5,
      vRing: true,
      debris: true,
      sparks: 72,
      smoke: true,
      light: 4.8,
    },
  },
  // Dread Curse: dread made visible on the tank, the curse_of_agony read with
  // chains for the stacking swap call. drip:'rise' (not 'fall'): a 'fall' drip
  // bursts in the hardcoded blood-red kind (fx.ts), which would force red on
  // an otherwise-purple curse the moment its dot linger ever wired the drip.
  [NYTHRAXIS_DREAD_CURSE_CAST_ID]: {
    archetype: 'dot',
    palette: 'shadow',
    power: 1.2,
    dot: { drip: 'rise' },
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
  // Gravebreaker: a charged auto-attack splash, not a scripted cast. Quiet and
  // focused so it never reads as an area attack: the real shape is an 11yd
  // frontal arc off the landed swing, not a ring from the boss. filler:true
  // is load-bearing: without it usesCrescendoScale (spectacle.ts) treats any
  // non-filler burst as a marquee crescendo and plays the full release
  // explosion/vertical halo/afterglow regardless of impact.ring being false.
  [NYTHRAXIS_GRAVEBREAKER_CAST_ID]: {
    archetype: 'burst',
    palette: 'shadow',
    power: 1.3,
    filler: true,
    burst: { style: 'ground' },
    tint: '#b48cff',
    rim: '#d9b8ff',
    impact: {
      flipbook: false,
      ring: false,
      vRing: false,
      debris: false,
      sparks: 16,
      smoke: false,
      light: 1.6,
      focused: true,
    },
  },
  // Shuddering Stomp: the phase-one-to-two transition slam that stuns the
  // whole room. Genuinely room-wide (unlike Gravebreaker's frontal arc), so a
  // small ring is honest here; still quiet, since the CC read carries the
  // moment - filler:true keeps it out of the marquee crescendo the same way
  // it does for Gravebreaker above. The cast id is a render-only routing id,
  // not the display string (see the constant's own comment: an unrelated
  // ogre mid-boss names its own stomp mechanic 'Shuddering Stomp' too).
  [NYTHRAXIS_SHUDDERING_STOMP_CAST_ID]: {
    archetype: 'burst',
    palette: 'shadow',
    power: 1.6,
    filler: true,
    burst: { style: 'ground' },
    tint: '#9a5df0',
    rim: '#d9b8ff',
    impact: {
      flipbook: false,
      ring: 2,
      vRing: true,
      debris: false,
      sparks: 24,
      smoke: true,
      light: 2.2,
    },
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
