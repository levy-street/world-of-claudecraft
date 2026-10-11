import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

// Its bespoke pooled sphere owns the charge, flight and impact. The compact
// radius still feeds the immediate gameplay footprint on every graphics tier.
export const SPIRIT_BOMB_VFX_SPEC = {
  c: '#aa55ff',
  p: 'shadow',
  pw: 2.4,
  sp: 54,
  rg: 2,
  li: 2.4,
  wu: 3,
  a: 'nova',
} satisfies AbilityVfxSpec;

export const SPIRIT_BOMB_VFX_FULL_SPEC = {
  archetype: 'nova',
  palette: 'shadow',
  tint: '#aa55ff',
  accent: '#edb9ff',
  rim: '#d9afff',
  power: 2.4,
  windup: 3,
  windupStyle: 'none',
  impact: { ring: 2, sparks: 54, light: 2.4 },
} satisfies AbilityVfxFullSpec;

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

// A victim-anchored fissure, never an area footprint or travelling projectile.
export const VOID_RUPTURE_VFX_SPEC = {
  c: '#ad65ff',
  p: 'shadow',
  pw: 1.3,
  sp: 18,
  li: 0.7,
  a: 'burst',
} satisfies AbilityVfxSpec;
export const VOID_RUPTURE_VFX_FULL_SPEC = {
  archetype: 'burst',
  palette: 'shadow',
  tint: '#ad65ff',
  accent: '#eed2ff',
  power: 1.3,
  windup: 0,
  windupStyle: 'none',
  impact: { focused: true, ring: false, vRing: false, sparks: 18, light: 0.7 },
} satisfies AbilityVfxFullSpec;
