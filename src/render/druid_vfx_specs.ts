import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

// Wildfang kit pass 2 (Pin, Lunge, Takedown) placeholder identities.
// Every spec here is a clearly labelled PLACEHOLDER borrowed from the nearest
// shipped druid read (Bruin Rush's dash, Slinkstrike's claw strike, Hobbling
// Cut's victim-worn speedlines) so the new actions are not silent while the
// VFX retune pass, which owns their final visuals, replaces them. They land in
// this class-owned module and resolve through ability_vfx_registry.ts, never
// in the generated gallery tables (src/render/ability_vfx/CLAUDE.md).
//
// VFX retune pending: the Pin snare worn by the Bruin Rush victim. Mirrors the
// Hobbling Cut victim read (dragging ankle speedlines for the snare's 4 sec);
// the aura id is the bare `pin`, so the band resolves by exact id rather than
// the `_slow` suffix map.
export const PIN_VFX_SPEC = {
  c: '#dfe6ee',
  p: 'physical',
  pw: 0.8,
  sp: 6,
  sm: 1,
  li: 0.3,
  lg: 1,
  bo: 'speedlines',
  a: 'cc',
} satisfies AbilityVfxSpec;

// VFX retune pending: Lunge, the out-of-stealth Slinkstrike. Bruin Rush's
// dash (no spectral bear, the cat is its own body) into Slinkstrike's claw
// strike at the landing.
export const LUNGE_VFX_SPEC = {
  c: '#b4a8e0',
  p: 'moon',
  pw: 0.95,
  sp: 10,
  rg: 1.2,
  sm: 1,
  li: 0.4,
  lg: 1,
  a: 'dash',
} satisfies AbilityVfxSpec;

export const LUNGE_VFX_FULL_SPEC = {
  archetype: 'dash',
  palette: 'moon',
  power: 0.95,
  windupStyle: 'none',
  strike: { swings: 1, arc: 'claws', stars: false },
  impact: { flipbook: false, ring: 1.2, sparks: 8, debris: true, smoke: true, light: 0.4 },
  linger: 1,
} satisfies AbilityVfxFullSpec;

// VFX retune pending: Takedown (id hamstring_bite), the Cat control finisher. Slinkstrike's
// claw strike (stars on, the stun read Concuss and Low Blow share).
export const HAMSTRING_BITE_VFX_SPEC = {
  c: '#d41f2e',
  p: 'blood',
  pw: 1,
  sp: 8,
  vr: 1,
  sm: 1,
  li: 0.4,
  lg: 1.5,
  a: 'strike',
} satisfies AbilityVfxSpec;

export const HAMSTRING_BITE_VFX_FULL_SPEC = {
  archetype: 'strike',
  palette: 'blood',
  power: 1,
  windupStyle: 'none',
  strike: { swings: 1, arc: 'bite', bleed: true, stars: true },
  impact: {
    flipbook: false,
    ring: false,
    vRing: true,
    sparks: 8,
    debris: false,
    smoke: true,
    light: 0.4,
  },
  linger: 1.5,
} satisfies AbilityVfxFullSpec;

export const PIN_VFX_FULL_SPEC = {
  archetype: 'cc',
  palette: 'physical',
  power: 0.8,
  windupStyle: 'none',
  impact: { flipbook: false, ring: false, sparks: 6, debris: true, smoke: true, light: 0.3 },
  debuff: { orbit: 'speedlines', o: { n: 3, rate: 1.5, size: 0.2, radius: 1.15 } },
  linger: 1,
} satisfies AbilityVfxFullSpec;
