// Ballistics and material for the stuff a giant throws off the ground.
//
// Three/DOM/i18n-free and deterministic, so a Vitest drives it directly and the
// RENDER_PURE_CORES purity sweep in tests/architecture.test.ts covers it. The Three half
// (balgath_debris.ts) owns one pooled Points cloud and does nothing but call into here.
//
// The whole reason this exists as a separate layer from the ground rings: a ring tells you
// WHERE the blast was, and debris tells you what the ground is MADE of. A slam into a reed
// bank and a slam into open water are the same mechanic and should not look remotely alike,
// and the surface classifier the footsteps already use (world_audio.ts footstepSurfaceAt)
// knows the difference, so this reads from the same source rather than guessing from a
// zone id.
import type { Surface } from './audio_sink';
import { excavatedPuffColor } from './ground_puff_color_core';

/** One flying particle. Plain data so the pool can live in typed arrays. */
export interface DebrisParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds lived, against `life`. */
  age: number;
  life: number;
  size: number;
  color: number;
  /** Ground height under this particle, so it can die on landing rather than fall forever. */
  floor: number;
  /** Per-second velocity retention, carried from the profile so the pool stays one array. */
  drag: number;
  /**
   * Multiplier on DEBRIS_GRAVITY. Soil and stone use 1; the aura motes use 0 or a small
   * negative so they hang and drift upward, which is what separates "thrown" from "given
   * off" without a second particle system existing to maintain.
   */
  gravity: number;
  /** Optional attractor: motes drawn INTO the boss carry his chest here. */
  pull?: [number, number, number];
  /** Attraction strength, yards per second squared. */
  pullK: number;
}

/**
 * How a surface behaves when something enormous hits it.
 *
 * `size` is in WORLD UNITS and is per particle, which needs the custom point shader in
 * balgath_debris.ts to mean anything: on a thirteen-unit body seen from a raid's distance,
 * uniform half-unit dots read as grit rather than as the ground coming up.
 */
export interface DebrisProfile {
  /** Particles at power 1. */
  count: number;
  /** Initial outward speed, yards/sec. */
  out: number;
  /** Initial upward speed, yards/sec. Water goes up; soil goes out. */
  lift: number;
  /** Per-second velocity retention. Light material hangs, heavy material drops. */
  drag: number;
  /** Seconds before the particle fades out regardless of where it is. */
  life: number;
  size: number;
  /** Two tones, mixed per particle, so a burst is never one flat colour. */
  colors: [number, number];
  /** Chance a particle is the second tone (grass flecks in soil, foam in water). */
  accent: number;
}

export const DEBRIS_GRAVITY = 21;

/**
 * Splash, rather than dust.
 *
 * Water throws far more particles far higher and lets them hang, because that is what
 * reads as a column of water from sixty yards away. It is also the only profile whose
 * particles are lighter than air is generous about: drag near 1 keeps the crown up long
 * enough to be seen at all.
 */
const WATER: DebrisProfile = {
  count: 64,
  out: 8,
  lift: 14,
  drag: 0.86,
  life: 1.25,
  size: 0.8,
  colors: [0xcfe4ef, 0x7fa8bd],
  accent: 0.45,
};

/** Turf: wet fen soil with the grass still in it. Goes OUT more than up, and lands. */
const TURF: DebrisProfile = {
  count: 54,
  out: 12,
  lift: 9,
  drag: 0.7,
  life: 1.6,
  size: 0.95,
  colors: [0x6f5a3c, 0x6f8442],
  accent: 0.38,
};

/** Stone chips: fewer, faster, smaller, and they do not hang about. */
const STONE: DebrisProfile = {
  count: 34,
  out: 15,
  lift: 7.5,
  drag: 0.6,
  life: 1.2,
  size: 0.6,
  colors: [0x8e8c86, 0xb4b1a8],
  accent: 0.4,
};

/**
 * The material a surface throws.
 *
 * Grass, dirt and snow all collapse onto the turf profile with the shipped puff colour
 * mixed in, so the debris matches the footstep dust the renderer already emits on that
 * exact ground instead of being a second, disagreeing opinion about it.
 */
export function debrisProfileFor(surface: Surface): DebrisProfile {
  if (surface === 'water') return WATER;
  if (surface === 'stone' || surface === 'wood') return { ...STONE };
  const dug = excavatedPuffColor(surface);
  return dug === null ? TURF : { ...TURF, colors: [dug, TURF.colors[1]] };
}

/**
 * Bearing for particle `i` of `count`, spread by the golden angle.
 *
 * Not random, and not an even fan either. An even fan reads as a wheel of spokes, and
 * random clumps visibly at these counts; the golden angle fills the circle evenly at every
 * prefix, which is exactly the property a pooled emitter needs when a budget cuts the
 * burst short partway through.
 */
export function debrisBearing(i: number): number {
  return i * 2.399963229728653;
}

/**
 * A drifting aura mote: slow, buoyant, long-lived, and nothing like thrown material.
 *
 * Shares the pool and the integrator with the debris on purpose. One emitter, one draw
 * call, one lifetime rule; the only thing that differs is that these have no weight.
 */
export const MOTE_PROFILE: DebrisProfile = {
  count: 1,
  out: 1.1,
  lift: 1.6,
  drag: 0.55,
  life: 2.1,
  size: 0.55,
  colors: [0xffffff, 0xffffff],
  accent: 0,
};

/** Speed falloff for particle `i`, so a burst has a fast front and a slow tail. */
export function debrisSpeedScale(i: number, count: number): number {
  const t = count <= 1 ? 0 : i / (count - 1);
  return 0.45 + 0.55 * (1 - t * t);
}

/**
 * Advance one particle. Returns false once it is spent, by age or by landing.
 *
 * Drag is applied as a per-second retention raised to dt, so the curve is identical at any
 * frame rate rather than being quietly stronger on a slow machine.
 */
export function stepDebrisParticle(p: DebrisParticle, dt: number): boolean {
  p.age += dt;
  if (p.age >= p.life) return false;
  const keep = p.drag ** dt;
  if (p.pull) {
    // Drawn toward a point rather than thrown from one. Normalised so a mote a long way
    // out does not accelerate absurdly, and killed on arrival so an attractor cannot
    // collect a permanent halo of particles orbiting inside the body.
    const dx = p.pull[0] - p.x;
    const dy = p.pull[1] - p.y;
    const dz = p.pull[2] - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.35) return false;
    const k = (p.pullK * dt) / d;
    p.vx += dx * k;
    p.vy += dy * k;
    p.vz += dz * k;
  }
  p.vx *= keep;
  p.vz *= keep;
  p.vy = (p.vy - DEBRIS_GRAVITY * p.gravity * dt) * keep;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  // Landing kills it, but only for something that actually falls: a buoyant mote drifting
  // along just above the ground must not be culled the instant it dips.
  return !(p.gravity > 0 && p.vy < 0 && p.y <= p.floor);
}

/** Fade curve: full through the first third of life, then out. */
export function debrisAlpha(p: DebrisParticle): number {
  const t = p.age / p.life;
  return t < 0.34 ? 1 : Math.max(0, 1 - (t - 0.34) / 0.66);
}
