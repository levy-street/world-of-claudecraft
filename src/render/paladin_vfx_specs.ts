import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

// Hammer of Grace arrived after the gallery projection. Keep its identity in
// the Paladin-owned registry layer so regenerating the gallery cannot erase it.
// It reuses the pooled rock-head bolt and gavel motif: a compact sky-blue and
// gold thrown mace, visibly distinct from Hammer of Wrath's larger execute.
export const HAMMER_OF_GRACE_VFX_SPEC = {
  c: '#9fe8ff',
  p: 'holy',
  pw: 1.05,
  sp: 20,
  rg: 1.15,
  vr: 1,
  li: 1.1,
  b: { v: 28, h: 1.05 },
  lg: 1,
  a: 'bolt',
} satisfies AbilityVfxSpec;

export const HAMMER_OF_GRACE_VFX_FULL_SPEC = {
  archetype: 'bolt',
  palette: 'holy',
  power: 1.05,
  bolt: {
    speed: 28,
    headScale: 1.05,
    style: 'rock',
    coils: false,
    jagged: false,
    forkEvery: 0,
    tracer: true,
  },
  windupStyle: 'none',
  motifs: ['gavel'],
  motifAt: 'target',
  tint: '#9fe8ff',
  accent: '#fff0a8',
  linger: 1,
  rim: '#d7f7ff',
  impact: {
    ring: 1.15,
    vRing: true,
    sparks: 20,
    flipbook: false,
    debris: false,
    smoke: false,
    light: 1.1,
  },
} satisfies AbilityVfxFullSpec;
