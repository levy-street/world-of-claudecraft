import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';
import { EMBERKIN_FELBOLT_VFX_FULL_SPEC, EMBERKIN_FELBOLT_VFX_SPEC } from './warlock_pet_vfx_specs';

// Bone Mage keeps Emberkin's compact fel-lance silhouette and timing, retinted
// violet so its shadow-school projectile reads as Necromancy at a glance.
export const BONE_MAGE_SHADOW_BOLT_VFX_SPEC = {
  ...EMBERKIN_FELBOLT_VFX_SPEC,
  c: '#8f4dff',
  p: 'shadow',
} satisfies AbilityVfxSpec;

export const BONE_MAGE_SHADOW_BOLT_VFX_FULL_SPEC = {
  ...EMBERKIN_FELBOLT_VFX_FULL_SPEC,
  palette: 'shadow',
  tint: '#8f4dff',
  accent: '#d8b0ff',
  rim: '#c998ff',
  bolt: {
    ...EMBERKIN_FELBOLT_VFX_FULL_SPEC.bolt,
    core: '#18072f',
    accent: '#d8b0ff',
  },
} satisfies AbilityVfxFullSpec;

// Powerful VFX prompt:
// "Tear open a towering black-violet ossuary portal in front of the
// Necromancer. Build its rim from rotating bone runes and broken chains,
// compress cold soul-fire into a starless membrane, then drive three distinct
// spectral emergence lanes through it for the Warrior, Bone Mage, and
// Gravewing. The floor seal cracks outward as void pillars flare, bone debris
// is dragged toward the threshold, and the portal snaps shut by implosion.
// Keep the doorway readable in reduced motion and shed only ornaments on low
// quality."
export const ARMY_OF_THE_DEAD_VFX_SPEC = {
  c: '#7937c7',
  p: 'shadow',
  pw: 1.9,
  sp: 60,
  vr: 1,
  db: 1,
  sm: 1,
  li: 2,
  lg: 3.4,
  wu: 1.5,
  fin: 1,
  a: 'summon',
} satisfies AbilityVfxSpec;

export const ARMY_OF_THE_DEAD_VFX_FULL_SPEC = {
  archetype: 'summon',
  palette: 'shadow',
  tint: '#7937c7',
  accent: '#83e2dc',
  rim: '#eadcff',
  hot: 0.12,
  power: 1.9,
  finisher: true,
  windup: 1.5,
  windupStyle: 'runes',
  motifs: ['chains', 'implosion', 'pillars'],
  motifAt: 'target',
  decal: 'portal',
  screenFx: true,
  linger: 3.4,
  spirit: null,
  impact: {
    flipbook: true,
    ring: false,
    vRing: 1.8,
    sparks: 60,
    debris: true,
    smoke: true,
    light: 2,
    sample: 'imp_shadow',
  },
} satisfies AbilityVfxFullSpec;

// Necromancy-owned override for the existing Essence Reap filler. It borrows
// Soul Lance's ivory-tipped spectral spear language, but stays shorter,
// smaller, dimmer and impact-light enough for a frequently cast generator.
export const ESSENCE_REAP_VFX_SPEC = {
  c: '#6f42b5',
  p: 'shadow',
  pw: 0.88,
  sp: 20,
  sm: 1,
  li: 0.9,
  b: { v: 26, h: 1, co: 1 },
  lg: 0.65,
  wu: 1.8,
  a: 'bolt',
} satisfies AbilityVfxSpec;

export const ESSENCE_REAP_VFX_FULL_SPEC = {
  archetype: 'bolt',
  palette: 'shadow',
  tint: '#6f42b5',
  accent: '#80d8d2',
  rim: '#d8d0ea',
  power: 0.88,
  filler: true,
  chargeStreams: 2,
  bolt: {
    speed: 26,
    headScale: 1,
    style: 'essenceLance',
    core: '#25143a',
    accent: '#80d8d2',
    coils: true,
    jagged: false,
    forkEvery: 0,
    tracer: false,
  },
  windup: 1.8,
  windupStyle: 'compression',
  screenFx: false,
  linger: 0.45,
  impact: {
    focused: true,
    flipbook: false,
    ring: false,
    vRing: 0.5,
    sparks: 20,
    debris: false,
    smoke: true,
    light: 0.9,
    liteAudio: true,
  },
} satisfies AbilityVfxFullSpec;

// Powerful VFX: three soul streams compress between the caster's hands into
// an ivory-tipped spectral bone spear. The head remains directional through
// the whole flight, while a violet shaft, swept bone fins and cold cyan wisps
// distinguish it from Ruinbolt's toxic fel projectile.
export const SOUL_LANCE_VFX_SPEC = {
  c: '#7b42c3',
  p: 'shadow',
  pw: 1.45,
  sp: 42,
  rg: 1.15,
  vr: 1,
  db: 1,
  sm: 1,
  li: 1.45,
  b: { v: 26, h: 1.55, co: 1 },
  lg: 2.6,
  wu: 1.6,
  fin: 1,
  a: 'bolt',
} satisfies AbilityVfxSpec;

export const SOUL_LANCE_VFX_FULL_SPEC = {
  archetype: 'bolt',
  palette: 'shadow',
  tint: '#7b42c3',
  accent: '#8ce7ed',
  rim: '#f2f0ff',
  hot: 0.16,
  power: 1.45,
  finisher: true,
  chargeStreams: 3,
  bolt: {
    speed: 26,
    headScale: 1.55,
    style: 'soulLance',
    core: '#25123d',
    accent: '#8ce7ed',
    coils: true,
    jagged: false,
    forkEvery: 0,
    tracer: true,
  },
  windup: 1.6,
  windupStyle: 'compression',
  motifs: ['chains'],
  motifAt: 'target',
  decal: 'rune',
  screenFx: true,
  linger: 2.6,
  impact: {
    focused: true,
    flipbook: true,
    ring: 1.15,
    vRing: 0.8,
    sparks: 42,
    debris: true,
    smoke: true,
    light: 1.45,
    sample: 'imp_shadow',
  },
} satisfies AbilityVfxFullSpec;

// The application is a restrained ossuary seal. Its unsuffixed hostile aura
// wears a five-rune cage for the full storage window, with no friendly ground
// disc or buff swirl on the victim.
export const OSSUARY_MARK_VFX_SPEC = {
  c: '#6730a6',
  p: 'shadow',
  pw: 0.95,
  sp: 18,
  vr: 1,
  sm: 1,
  li: 0.85,
  bo: 'runes',
  lg: 1.4,
  wu: 0.22,
  a: 'cc',
} satisfies AbilityVfxSpec;

export const OSSUARY_MARK_VFX_FULL_SPEC = {
  archetype: 'cc',
  palette: 'shadow',
  tint: '#6730a6',
  accent: '#8ce7ed',
  rim: '#d9c9ff',
  power: 0.95,
  windup: 0.22,
  windupStyle: 'runes',
  motifs: ['chains'],
  motifAt: 'target',
  decal: 'rune',
  linger: 1.4,
  debuff: {
    orbit: 'runes',
    o: {
      n: 5,
      size: 0.3,
      tex: 'paw',
      rate: 0.65,
      weave: 0.05,
      radius: 1.05,
      incline: 0.08,
    },
  },
  impact: {
    focused: true,
    flipbook: false,
    ring: 0.75,
    vRing: 0.55,
    sparks: 18,
    debris: false,
    smoke: true,
    light: 0.85,
    liteAudio: true,
  },
} satisfies AbilityVfxFullSpec;

// Powerful VFX: the cage collapses inward before the stored souls erupt into
// a violet-white ossuary blast. The same identity drives manual, expiry and
// death detonations; a death event additionally carries the authoritative
// six-yard area ring.
export const OSSUARY_MARK_DETONATE_VFX_SPEC = {
  c: '#8a49d8',
  p: 'shadow',
  pw: 1.65,
  sp: 54,
  rg: 1.65,
  vr: 1,
  db: 1,
  sm: 1,
  li: 1.75,
  lg: 3.2,
  wu: 0.12,
  fin: 1,
  a: 'nova',
} satisfies AbilityVfxSpec;

export const OSSUARY_MARK_DETONATE_VFX_FULL_SPEC = {
  archetype: 'nova',
  palette: 'shadow',
  tint: '#8a49d8',
  accent: '#8ce7ed',
  rim: '#f2f0ff',
  hot: 0.12,
  power: 1.65,
  finisher: true,
  windup: 0.12,
  windupStyle: 'vortex',
  motifs: ['implosion', 'chains', 'pillars'],
  motifAt: 'target',
  nova: { radius: 6 },
  decal: 'rune',
  screenFx: true,
  linger: 3.2,
  impact: {
    flipbook: true,
    ring: 1.65,
    vRing: 1.25,
    sparks: 54,
    debris: true,
    smoke: true,
    light: 1.75,
    sample: 'imp_shadow',
  },
} satisfies AbilityVfxFullSpec;

// A fresh Echo is readable state, not a generic death puff: the soul folds
// inward into a cold violet floor seal that the persistent ground painter
// then holds until it expires or Corpse Explosion consumes it.
export const DEATH_ECHO_VFX_SPEC = {
  c: '#7640b8',
  p: 'shadow',
  pw: 1.08,
  sp: 26,
  rg: 0.8,
  vr: 1,
  sm: 1,
  li: 1,
  lg: 1.8,
  wu: 0.08,
  a: 'nova',
} satisfies AbilityVfxSpec;

export const DEATH_ECHO_VFX_FULL_SPEC = {
  archetype: 'nova',
  palette: 'shadow',
  tint: '#7640b8',
  accent: '#85e6df',
  rim: '#e9dcff',
  power: 1.08,
  windup: 0.08,
  windupStyle: 'vortex',
  motifs: ['implosion'],
  motifAt: 'target',
  nova: { radius: 2.1 },
  decal: 'rune',
  linger: 1.8,
  impact: {
    focused: true,
    flipbook: false,
    ring: 0.8,
    vRing: 0.65,
    sparks: 26,
    debris: false,
    smoke: true,
    light: 1,
    liteAudio: true,
  },
} satisfies AbilityVfxFullSpec;

// Powerful VFX: the selected Echo implodes first, then the grave tears open
// across the full damage radius with bone debris, cold soul-fire pillars and
// a lingering rune-scar. This is the active payoff of the spatial resource.
export const CORPSE_EXPLOSION_VFX_SPEC = {
  c: '#9b49dc',
  p: 'shadow',
  pw: 1.62,
  sp: 52,
  rg: 1.7,
  vr: 1,
  db: 1,
  sm: 1,
  li: 1.7,
  lg: 3.2,
  wu: 0.1,
  fin: 1,
  a: 'nova',
} satisfies AbilityVfxSpec;

export const CORPSE_EXPLOSION_VFX_FULL_SPEC = {
  archetype: 'nova',
  palette: 'shadow',
  tint: '#9b49dc',
  accent: '#81e0d7',
  rim: '#f2eaff',
  hot: 0.1,
  power: 1.62,
  finisher: true,
  windup: 0.1,
  windupStyle: 'vortex',
  motifs: ['implosion', 'fissure', 'pillars'],
  motifAt: 'target',
  nova: { radius: 8 },
  decal: 'rune',
  screenFx: true,
  linger: 3.2,
  impact: {
    flipbook: true,
    ring: 1.7,
    vRing: 1.3,
    sparks: 52,
    debris: true,
    smoke: true,
    light: 1.7,
    sample: 'imp_shadow',
  },
} satisfies AbilityVfxFullSpec;

// Powerful VFX: every servant answers with the same command sigil, while its
// own attack silhouette remains intact. Melee undead tear violet fissures at
// the victim; a Bone Mage launches the matching chained shadow fang.
export const REAPING_COMMAND_VFX_SPEC = {
  c: '#7e3cc1',
  p: 'shadow',
  pw: 1.38,
  sp: 38,
  rg: 1.05,
  vr: 1,
  db: 1,
  sm: 1,
  li: 1.35,
  b: { v: 22, h: 1.25, co: 1 },
  lg: 2.2,
  wu: 0.1,
  fin: 1,
  a: 'strike',
} satisfies AbilityVfxSpec;

export const REAPING_COMMAND_VFX_FULL_SPEC = {
  archetype: 'strike',
  palette: 'shadow',
  tint: '#7e3cc1',
  accent: '#82ddd5',
  rim: '#e6d7ff',
  power: 1.38,
  finisher: true,
  windup: 0.1,
  windupStyle: 'runes',
  motifs: ['chains', 'fissure'],
  motifAt: 'target',
  decal: 'rune',
  linger: 2.2,
  bolt: {
    speed: 22,
    headScale: 1.25,
    style: 'shadowFang',
    core: '#241137',
    accent: '#82ddd5',
    coils: true,
    jagged: false,
    forkEvery: 0,
    tracer: true,
  },
  impact: {
    trail: 'overhead',
    focused: true,
    flipbook: true,
    ring: 1.05,
    vRing: 0.8,
    sparks: 38,
    debris: true,
    smoke: true,
    light: 1.35,
    sample: 'imp_shadow',
  },
} satisfies AbilityVfxFullSpec;
