import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

// Magma Burst (lava_burst), the Elemental Shaman's molten nuke. Before this
// spec it had no authored identity and drew the renderer's generic heavy bolt.
// Prompt contract: "A molten orb swells between the Shaman's hands while
// casting, then flies on three twisting strands of lava that drip as they go;
// the orb lands in a fire flash with sparks, debris, smoke and a scorch, the
// strands drain and crumble, and a ring of fire burns at the target's feet."
//
// The flight and the strands are bespoke (ability_vfx/magma_burst.ts and
// magma_braid.ts ride the pooled projectile); this spec supplies the shared
// sequencer's halves: the 'orb' windup ceremony during the cast and the impact
// stack, which the braid fires at ARRIVAL (the sequence is held for travel).
export const MAGMA_BURST_VFX_SPEC = {
  c: '#ff7a1a',
  p: 'fire',
  pw: 1.3,
  sp: 40,
  rg: 1,
  vr: 1,
  db: 1,
  sm: 1,
  li: 0.9,
  b: { v: 26, h: 1.6 },
  lg: 3,
  wu: 2,
  a: 'bolt',
} satisfies AbilityVfxSpec;

export const MAGMA_BURST_VFX_FULL_SPEC = {
  archetype: 'bolt',
  palette: 'fire',
  tint: '#ff7a1a',
  accent: '#ffd23f',
  power: 1.3,
  windup: 2,
  windupStyle: 'orb',
  hot: 0.35,
  bolt: { speed: 26, headScale: 1.6, coils: false, jagged: false, forkEvery: 0 },
  linger: 3,
  decal: 'scorch',
  impact: {
    flipbook: true,
    ring: true,
    vRing: true,
    sparks: 40,
    debris: true,
    smoke: true,
    light: 0.9,
  },
} satisfies AbilityVfxFullSpec;
