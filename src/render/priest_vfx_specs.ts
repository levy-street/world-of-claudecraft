import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

// The curse appears on the victim at cast completion, without a travelling bolt.
export const VAMPIRIC_TOUCH_VFX_SPEC = {
  c: '#a66cf1',
  p: 'shadow',
  pw: 0.85,
  sp: 12,
  li: 0.45,
  bo: 'sparks',
  lg: 1.2,
  wu: 1.5,
  a: 'dot',
} satisfies AbilityVfxSpec;

export const VAMPIRIC_TOUCH_VFX_FULL_SPEC = {
  archetype: 'dot',
  palette: 'shadow',
  tint: '#a66cf1',
  accent: '#e55786',
  rim: '#dcc7ff',
  power: 0.85,
  filler: true,
  windup: 1.5,
  windupStyle: 'runes',
  dot: { drip: 'rise' },
  debuff: {
    orbit: 'sparks',
    o: { n: 3, size: 0.16, rate: 0.6, weave: 0.08, radius: 0.65, incline: 0.18 },
  },
  linger: 1.2,
  impact: { focused: true, ring: false, vRing: false, sparks: 12, light: 0.45 },
} satisfies AbilityVfxFullSpec;
