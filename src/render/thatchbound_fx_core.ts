// Thatchbound's visual plan, the pure half (no Three, no DOM): where a puppet's eyes burn,
// how its violet sigil spins, how the cast's sigil grows under each chosen victim, how the
// curse's shockwave rolls out, and the dark swirl of straw and crow feathers that wraps
// its body. thatchbound_fx.ts owns the objects and reads these. Sim:
// src/sim/seasonal/scarecrow_puppet.ts. Nothing hangs over the puppet's head (owner note
// 2026-10-18: no marionette strings, no control bar).
//
// Fairness: who is a puppet is actionable information (allies must find and free them),
// so the eyes and the ground sigil draw at every graphics tier (and the body itself is
// the scarecrow or crow look); only the swirl of straw and feathers thins under reduced
// motion.

export const PUPPET_ABILITY = 'mob_thatchgrin_puppet';
export const STRAWLING_PUPPET_AURA = 'thatchbound_strawling';
export const CROW_PUPPET_AURA = 'thatchbound_crow';
export const PUPPET_AURA_IDS: ReadonlySet<string> = new Set([
  STRAWLING_PUPPET_AURA,
  CROW_PUPPET_AURA,
]);

/** Puppets drawn at once (a cast takes two; two casts can overlap at the edges). */
export const PUPPET_CAP = 4;
/** The cast's marks at once (one per chosen victim): a sigil grows under each. */
export const CAST_MARK_CAP = 4;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The body's head height over its feet: the little scarecrow stands, the crow hovers low. */
export interface PuppetBody {
  head: number;
}

/** Each look's body. */
export function puppetBody(auraId: string): PuppetBody {
  return auraId === CROW_PUPPET_AURA ? { head: 1.9 } : { head: 1.75 };
}

/** The two burning eyes: just in front of the head, a hand apart. */
export function puppetEyes(pos: Vec3Like, facing: number, body: PuppetBody): [Vec3Like, Vec3Like] {
  const lx = Math.cos(facing);
  const lz = -Math.sin(facing);
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  const y = pos.y + body.head - 0.05;
  const fwd = 0.32;
  const apart = 0.13;
  return [
    { x: pos.x + fx * fwd + lx * apart, y, z: pos.z + fz * fwd + lz * apart },
    { x: pos.x + fx * fwd - lx * apart, y, z: pos.z + fz * fwd - lz * apart },
  ];
}

/** The eyes' size pulse (world yards). */
export function eyeSize(time: number, phase: number): number {
  return 0.2 + 0.05 * Math.sin(time * 5 + phase);
}

/** The ground sigil's spin (radians) and its glow. */
export function sigilState(time: number, phase: number): { spin: number; glow: number } {
  return { spin: time * 0.9 + phase, glow: 0.75 + 0.25 * Math.sin(time * 3 + phase) };
}

/** The cast's sigil under a chosen victim: how far it has grown, 0..1 over the cast,
 *  eased in (full size the moment the curse lands). */
export function castGrow(elapsed: number, duration: number): number {
  const t = Math.max(0, Math.min(1, elapsed / Math.max(0.05, duration)));
  return 1 - (1 - t) * (1 - t);
}

/** The curse's shockwave: its radius and its brightness `age` seconds after the landing. */
export const SHOCK_SEC = 0.9;
export function shockwave(age: number): { radius: number; glow: number } {
  const t = Math.max(0, Math.min(1, age / SHOCK_SEC));
  return { radius: 0.6 + 3.6 * (1 - (1 - t) ** 3), glow: (1 - t) ** 1.6 };
}

/** Straw and feathers the swirl throws per second, by motion preference: a dense dark
 *  wrap that carries the curse's weight now that nothing hangs above the body. */
export function swirlRate(reducedMotion: boolean): number {
  return reducedMotion ? 8 : 48;
}

/** How high the swirl climbs (yards over the feet): it wraps the body and stops at the
 *  shoulders, never over the head. */
export const SWIRL_TOP = 1.9;

/** A point on the swirl round the puppet: a tightening helix climbing its body. `spin` is
 *  +1 or -1: two bands wind opposite ways, so the wrap reads as a churning cage. */
export function swirlPoint(pos: Vec3Like, t: number, k: number, spin = 1): Vec3Like {
  const a = spin * (t * 5.5 + k * 2.39996);
  const h = ((t * 0.8 + k * 0.37) % 1) * SWIRL_TOP;
  const r = (spin > 0 ? 1.2 : 0.85) - h * 0.22;
  return { x: pos.x + Math.cos(a) * r, y: pos.y + 0.15 + h, z: pos.z + Math.sin(a) * r };
}
