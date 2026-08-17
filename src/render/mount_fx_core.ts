// Ambient mount-effect math: the emission rates and per-particle placement for
// the rock mounts' two effects, kept host-agnostic so a Vitest can drive them
// without a renderer, a scene, or a GPU (tests/mount_fx_core.test.ts).
//
// The renderer owns the particle pool and the clock; this module owns only the
// decisions: how hard to emit at a given speed, and where each mote starts
// relative to the mount. Randomness is INJECTED (a `rand` argument) rather than
// read from Math.random here, so every placement below is reproducible in a
// test while the renderer still passes its own generator at runtime.
//
// Both effects belong to the rift rock mounts (src/sim/content/mounts.ts):
//   grit      the common Pet Rock grinding along the ground, throwing gravel.
//   riftglow  the socketed Shiny Pet Rock, shedding the gold rift light that
//             lit it, the same palette door_portal.ts gives rift_boulder_placed.

/** Ground speed (world units/sec) at which the grind is throwing full grit. */
export const GRIT_FULL_SPEED = 9;
/** Particles per second at full grind. */
export const GRIT_MAX_RATE = 42;
/** Particles per second for the socketed rock while standing still, and while
 *  moving. It glows either way (the mount hovers at idle), just brighter on
 *  the move, which is what makes the epic read as charged rather than painted. */
export const RIFTGLOW_IDLE_RATE = 9;
export const RIFTGLOW_MOVING_RATE = 26;

/** The two gravel tones the grind throws, and the two gold tones the socket sheds. */
export const GRIT_COLORS = [0x8d867a, 0x6b6459] as const;
export const RIFTGLOW_COLORS = [0xffc24a, 0xffe6a8] as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Grit emission rate in particles per second. Zero while stationary: a rock
 * that is not moving is not grinding, and a stationary dust cloud would read as
 * a bug rather than an effect. Ramps with speed so a walk scuffs and a full
 * mounted run throws a proper spray.
 */
export function gritEmitRate(speed: number, moving: boolean): number {
  if (!moving) return 0;
  return GRIT_MAX_RATE * clamp01(Math.abs(speed) / GRIT_FULL_SPEED);
}

/** Rift-glow emission rate: always on, denser while moving. */
export function riftGlowEmitRate(moving: boolean): number {
  return moving ? RIFTGLOW_MOVING_RATE : RIFTGLOW_IDLE_RATE;
}

export interface MountFxMote {
  /** Offset from the mount's ground position, in world units. */
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly color: number;
  readonly size: number;
  readonly lifetime: number;
}

/**
 * One grit mote: kicked out BEHIND the rock along its facing (yaw, with forward
 * = (sin yaw, cos yaw), matching mountExhaust), low to the ground and thrown
 * backwards, so the spray trails the mount instead of haloing it. `rand` must
 * return [0, 1); four draws are taken, in a fixed order, so a seeded generator
 * reproduces a mote exactly.
 */
export function gritMote(yaw: number, speed: number, rand: () => number): MountFxMote {
  const backX = -Math.sin(yaw);
  const backZ = -Math.cos(yaw);
  const spread = (rand() - 0.5) * 0.62;
  const kick = 0.9 + rand() * 1.5 + clamp01(Math.abs(speed) / GRIT_FULL_SPEED) * 1.6;
  const hop = 0.35 + rand() * 0.75;
  const warm = rand() < 0.5;
  return {
    dx: backX * 0.42 + spread,
    dy: 0.06,
    dz: backZ * 0.42 + spread,
    vx: backX * kick + spread * 0.8,
    vy: hop,
    vz: backZ * kick + spread * 0.8,
    color: warm ? GRIT_COLORS[0] : GRIT_COLORS[1],
    size: 0.24 + rand() * 0.2,
    lifetime: 0.55 + rand() * 0.35,
  };
}

/**
 * One rift-glow mote: drifts UP off the rock's crown in a loose ring, so the
 * socketed stone reads as shedding light rather than trailing exhaust. Rises
 * regardless of facing (the light is the rock's own, not a wake), which is why
 * this takes no yaw.
 */
export function riftGlowMote(rand: () => number): MountFxMote {
  const angle = rand() * Math.PI * 2;
  const radius = 0.3 + rand() * 0.45;
  const hot = rand() < 0.4;
  return {
    dx: Math.cos(angle) * radius,
    dy: 0.5 + rand() * 0.5,
    dz: Math.sin(angle) * radius,
    vx: Math.cos(angle) * 0.16,
    vy: 0.5 + rand() * 0.42,
    vz: Math.sin(angle) * 0.16,
    color: hot ? RIFTGLOW_COLORS[0] : RIFTGLOW_COLORS[1],
    size: 0.28 + rand() * 0.22,
    lifetime: 0.8 + rand() * 0.5,
  };
}
