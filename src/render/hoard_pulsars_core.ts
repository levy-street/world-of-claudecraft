// How Nyxaris's Bound Pulsars LOOK, as pure functions: the dormant hover, the
// activation that carries an orb off his shoulder to its station, the strain its
// wounds show, the death and the reforming. No Three.js, no DOM: a Vitest imports
// this directly, and the adapter beside it (hoard_pulsars.ts) only copies these
// numbers onto meshes. WHERE the orbs and beams are is the shared sim core
// (src/sim/rift/hoard_pulsars_core.ts).

import { PULSARS } from '../sim/rift/hoard_pulsars_core';

export const PULSAR_LOOK = Object.freeze({
  core: 0xbfe6ff,
  glow: 0x2f8bff,
  deep: 0x0b3fd6,
  // Pale crystal, not dark armour: dark plates read in game as opaque navy
  // blocks hiding the core (playtest).
  shell: 0x9cc6f7,
  rune: 0x2a4d9c,
  hurt: 0xffffff,
  /** An orb riding the boss is this much of its full, activated size. */
  dormantScale: 0.8,
  activeScale: 1.7,
  /** The ring a dying orb throws, in yards, and the ward's when it collapses. */
  novaRadius: 7,
  wardCollapseSec: 0.7,
  /** Seconds a destroyed orb takes to collapse, burst and clear. */
  deathSec: 0.95,
  /** Seconds a returning orb takes to gather and close. */
  reformSec: 1.7,
  /** Floor samples kept behind the beam's aim point. */
  trailSamples: 18,
  trailEverySec: 0.045,
});

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

export interface OrbEnergy {
  /** How far from dormant (0) to fully lit (1). */
  charge: number;
  /** How far along the flight from the shoulder (0) to the station (1). */
  travel: number;
  /** Multiplier on every part's turn. */
  spin: number;
  /** The energy joining orb and boss: 0 none, 1 full. */
  link: number;
  /** 1 on the beat the ward closes, decaying: the controlled pulse. */
  pulse: number;
  /** How far the armour plates stand off the nucleus (1 closed, up to ~1.5). */
  open: number;
}

/** The activation, beat by beat (the brief's own timeline, scaled to the cast):
 *  the rings quicken, the nucleus brightens, the arcs rise, energy joins orb and
 *  boss, and one pulse marks the ward closing. `elapsed` is the orb cue's age. */
export function activationEnergy(elapsed: number, out: OrbEnergy): OrbEnergy {
  const cast = PULSARS.activationCastSec;
  const t = clamp01(elapsed / cast);
  out.charge = smooth((t - 0.15) / 0.5);
  out.travel = smooth((t - 0.35) / 0.6);
  out.spin = 1 + 3.2 * smooth(t / 0.7);
  out.link = smooth((t - 0.62) / 0.3);
  const since = elapsed - cast;
  out.pulse = since >= 0 ? Math.max(0, 1 - since / 0.6) : 0;
  out.open = 1 + 0.32 * out.charge;
  return out;
}

export function dormantEnergy(out: OrbEnergy): OrbEnergy {
  out.charge = 0;
  out.travel = 0;
  out.spin = 1;
  out.link = 0;
  out.pulse = 0;
  out.open = 1;
  return out;
}

// Per health tier (steady, restless, cracked, critical): tables, never built per call.
const STRAIN_SHAKE = [0, 0.015, 0.045, 0.11] as const;
const STRAIN_FLICKER_HZ = [0, 3, 7, 15] as const;
const STRAIN_FLICKER_DEPTH = [0, 0.12, 0.3, 0.55] as const;
const STRAIN_CRACKS = [0, 0.25, 0.7, 1] as const;

export interface OrbStrain {
  /** 0 steady, up to 1 at the point of death. */
  instability: number;
  /** Yards the orb shudders. */
  shake: number;
  /** How often its light gutters, in hertz, and how deep. */
  flickerHz: number;
  flickerDepth: number;
  /** How bright the cracks in its armour burn. */
  cracks: number;
}

/** What an orb's wounds look like, so progress reads without the health bar:
 *  steady above 70 percent, restless to 40, cracked and guttering to 15, and
 *  surging, shaking apart below that. */
export function orbStrain(healthFraction: number, out: OrbStrain): OrbStrain {
  const hp = clamp01(healthFraction);
  const tier = hp > 0.7 ? 0 : hp > 0.4 ? 1 : hp > 0.15 ? 2 : 3;
  out.instability = tier === 0 ? 0 : tier === 1 ? 0.3 : tier === 2 ? 0.62 : 1;
  out.shake = STRAIN_SHAKE[tier];
  out.flickerHz = STRAIN_FLICKER_HZ[tier];
  out.flickerDepth = STRAIN_FLICKER_DEPTH[tier];
  out.cracks = STRAIN_CRACKS[tier];
  return out;
}

export interface OrbDeath {
  /** The nucleus: it swells, collapses inward, then is gone. */
  coreScale: number;
  /** The burst's light: 0, a spike, then a fade. */
  flash: number;
  /** The ring it throws: 0 to 1 across its spread. */
  nova: number;
  /** How far the armour plates have been thrown, in orb radii, and how faded. */
  scatter: number;
  fade: number;
  done: boolean;
}

/** A destroyed orb: destabilise, collapse inward for a beat, burst, scatter. */
export function orbDeath(age: number, out: OrbDeath): OrbDeath {
  const t = clamp01(age / PULSAR_LOOK.deathSec);
  const collapse = clamp01(t / 0.22);
  out.coreScale =
    t < 0.22 ? 1 + 0.25 * Math.sin(collapse * Math.PI) - 0.75 * collapse * collapse : 0;
  out.flash = t < 0.22 ? 0.2 * collapse : Math.max(0, 1 - (t - 0.22) / 0.4);
  out.nova = t < 0.22 ? 0 : smooth((t - 0.22) / 0.5);
  out.scatter = t < 0.22 ? -0.12 * collapse : 3.4 * smooth((t - 0.22) / 0.78);
  out.fade = t < 0.22 ? 1 : 1 - smooth((t - 0.4) / 0.6);
  out.done = t >= 1;
  return out;
}

export interface OrbReform {
  /** Motes gathering at the anchor before anything is solid. */
  gather: number;
  /** The plates closing in from outside: 1 far out, 0 seated. */
  plates: number;
  /** The nucleus kindling. */
  core: number;
  done: boolean;
}

/** A returning orb: light gathers at the shoulder, the plates close round it,
 *  the nucleus kindles, and it settles dormant. */
export function orbReform(age: number, out: OrbReform): OrbReform {
  const t = clamp01(age / PULSAR_LOOK.reformSec);
  out.gather = Math.sin(Math.PI * clamp01(t / 0.7));
  out.plates = 1 - smooth((t - 0.25) / 0.5);
  out.core = smooth((t - 0.55) / 0.4);
  out.done = t >= 1;
  return out;
}

/** The boss's frame to the world: `right`/`up`/`forward` in yards off his feet. */
export function bossLocalToWorld(
  bossX: number,
  bossY: number,
  bossZ: number,
  facing: number,
  right: number,
  up: number,
  forward: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  // Forward is (sin f, cos f); his right is (cos f, -sin f).
  out.x = bossX + cos * right + sin * forward;
  out.y = bossY + up;
  out.z = bossZ - sin * right + cos * forward;
  return out;
}
