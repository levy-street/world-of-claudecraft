import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

// Brutok Skullsmasher's Skull Smash: the ground-slam read for his aoePulse.
//
// The sim stamps this id onto the pulse's own spellfx (aoePulse.ability,
// src/sim/mob/locomotion.ts fireAoePulse), so the painter claims the nova and
// stages this sequence at the mob. The windup CLIP cue (same id, fx 'windup')
// is claimed by the painter's windup arm, whose whole job is triggerAttack, so
// the authored Slam one-shot still plays; and playerGestureRelease early-returns
// for mob sources, so the nova arm never double-triggers the rig.
//
// Read: an earthshaker, not a spell. Stone palette, a wide double shock ring
// sized to the REAL 10yd danger radius (tests pin it to the template so the
// ring can never lie about the zone), a ground fissure + crack scuff where the
// maul lands, kicked dust and debris. Deliberately NO cc-star band: the slam
// hits hard but does not stun, and a stun read on a non-stun would train
// players wrong.
export const BRUTOK_SKULL_SMASH_VFX_SPEC = {
  c: '#cfc4ae',
  p: 'physical',
  pw: 1.25,
  rg: 1.8,
  vr: 1,
  db: 1,
  sm: 1,
  li: 1.1,
  lg: 1.4,
  a: 'nova',
} satisfies AbilityVfxSpec;

export const BRUTOK_SKULL_SMASH_VFX_FULL_SPEC = {
  archetype: 'nova',
  palette: 'physical',
  tint: '#cfc4ae',
  accent: '#e8dfc8',
  rim: '#8a7a5c',
  power: 1.25,
  // the mechanic's actual radius (zone3.ts aoePulse.radius): the ring IS the
  // danger-zone telegraph, so it must match the yards the sim resolves
  nova: { radius: 10 },
  // the boom is staged to the CLIP, not the cue: the Slam's maul impact sits
  // 1.73s into the authored clip, played at 1.6x = 1.08s after the cue, and
  // the painter's mob arm honors this delay uncapped so ground-crack, dust and
  // shock ring land WITH the maul. The sim's damage stays on the cue (numbers
  // lead the boom, as mob melee already does); the immediate ring from
  // spawnRing still marks the danger zone at cue time.
  windup: 1.08,
  windupStyle: 'stance',
  motifs: ['fissure'],
  decal: 'crack',
  linger: 1.4,
  impact: {
    ring: 1.8,
    vRing: true,
    sparks: 26,
    debris: true,
    smoke: true,
    light: 1.1,
    flipbook: false,
  },
} satisfies AbilityVfxFullSpec;
