import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

// Emberkin's signature shot: a compact, high-contrast fel projectile that
// stays readable beside the Warlock's much larger Ruin spenders.
export const EMBERKIN_FELBOLT_VFX_SPEC = {
  c: '#67ff3f',
  p: 'venom',
  pw: 1.05,
  sp: 30,
  rg: 0.7,
  vr: 1,
  sm: 1,
  li: 1.15,
  b: { v: 30, h: 1.05, co: 1 },
  lg: 1.1,
  a: 'bolt',
} satisfies AbilityVfxSpec;

export const EMBERKIN_FELBOLT_VFX_FULL_SPEC = {
  archetype: 'bolt',
  palette: 'venom',
  tint: '#67ff3f',
  accent: '#d7ff65',
  rim: '#b8ff8a',
  power: 1.05,
  filler: true,
  bolt: {
    speed: 30,
    headScale: 1.05,
    style: 'felLance',
    core: '#09220b',
    accent: '#d7ff65',
    coils: true,
    tracer: true,
  },
  windupStyle: 'orb',
  decal: 'scorch',
  linger: 1.1,
  screenFx: false,
  impact: {
    focused: true,
    flipbook: true,
    ring: 0.7,
    vRing: true,
    sparks: 30,
    debris: false,
    smoke: true,
    light: 1.15,
    liteAudio: true,
  },
} satisfies AbilityVfxFullSpec;

// Gloomshade's pull pairs a live shadow ribbon (the beam event) with this
// target-side chain/implosion beat (the tick event). It is forceful without
// looking like a player capstone or obscuring the enemy being repositioned.
export const GLOOMSHADE_ABYSSAL_CHAIN_VFX_SPEC = {
  c: '#7562ff',
  p: 'shadow',
  pw: 1.2,
  sp: 28,
  rg: 0.85,
  vr: 1,
  sm: 1,
  li: 1.25,
  lg: 1.6,
  a: 'burst',
} satisfies AbilityVfxSpec;

export const GLOOMSHADE_ABYSSAL_CHAIN_VFX_FULL_SPEC = {
  archetype: 'burst',
  palette: 'shadow',
  tint: '#7562ff',
  accent: '#61dbe8',
  rim: '#b8f5ff',
  power: 1.2,
  burst: { style: 'link' },
  motifs: ['chains', 'implosion'],
  motifAt: 'target',
  motifR: 1.5,
  decal: 'portal',
  linger: 1.6,
  screenFx: false,
  impact: {
    focused: true,
    flipbook: false,
    ring: 0.85,
    vRing: true,
    sparks: 28,
    debris: true,
    smoke: true,
    light: 1.25,
    liteAudio: true,
  },
} satisfies AbilityVfxFullSpec;
