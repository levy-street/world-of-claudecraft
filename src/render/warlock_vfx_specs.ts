import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

// Powerful VFX prompt contract:
// "Open a colossal black-violet singularity across an eight-yard battlefield
// circle. Crack the ground toward its center, drag violet chains and debris
// inward, erupt a cold void column and stagger two shock fronts, then leave a
// luminous portal scar before the space snaps shut. Keep the exact area ring
// readable, preserve reduced-motion clarity, and reserve screen distortion
// and finisher audio for the full-quality local view."
//
// The shared pooled sequencer supplies every phase: implosion at release,
// chains plus a caster-to-rift fissure and five staggered pillars at impact,
// a void flipbook, horizontal and vertical rings, debris, smoke, light,
// portal decal, camera distortion and finisher aftermath.
export const ABYSSAL_RIFT_VFX_SPEC = {
  c: '#5d24a8',
  p: 'shadow',
  pw: 1.85,
  sp: 60,
  rg: 0.43,
  vr: 1,
  db: 1,
  sm: 1,
  li: 1.9,
  lg: 4.2,
  wu: 0.18,
  fin: 1,
  a: 'nova',
} satisfies AbilityVfxSpec;

export const ABYSSAL_RIFT_VFX_FULL_SPEC = {
  archetype: 'nova',
  palette: 'shadow',
  tint: '#5d24a8',
  accent: '#c07aff',
  rim: '#f0dcff',
  hot: 0.08,
  power: 1.85,
  finisher: true,
  windup: 0.18,
  windupStyle: 'vortex',
  motifs: ['implosion', 'chains', 'fissure', 'pillars'],
  motifAt: 'target',
  motifR: 8,
  nova: { radius: 8 },
  decal: 'portal',
  screenFx: true,
  linger: 4.2,
  impact: {
    flipbook: true,
    // The sequencer also scales nova rings by radius and power. This authored
    // multiplier keeps the final wavefront at the authoritative eight yards.
    ring: 0.43,
    vRing: 1.5,
    sparks: 60,
    debris: true,
    smoke: true,
    light: 1.9,
    sample: 'imp_shadow',
  },
} satisfies AbilityVfxFullSpec;
