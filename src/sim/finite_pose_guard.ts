// Last-finite-pose guard for the player body.
//
// A non-finite player pose is a freeze, not a glitch: a NaN position matches
// nothing in the interest scope, so the server stops sending that player the
// world while chat keeps flowing on the same socket, and the mirrored camera
// goes NaN on the client, where the maze camera-lift indexed GARDEN_MAZE[NaN]
// and threw every frame (the v0.43.0 freeze, source fixed in PR 4079: opposed
// movement keys normalized a zero vector). Whatever the NEXT source is, the
// player body must never carry a non-finite pose into the rest of the tick.
//
// Restore source: prevPos / prevFacing. The entity prologue (entity_roster.ts)
// copies pos into prevPos every tick and every teleport re-stamps it, so it is
// the freshest finite pose there is; the prologue skips the copy while pos is
// non-finite, which keeps prevPos finite by construction. The client
// prediction re-stamps prevPos from pos before every predicted step, so the
// same rule holds there. No private history: the guard reads and writes only
// Entity fields the sim already owns, so nothing new reaches the wire, the
// save blob, or the parity pins, and a fresh process recovers exactly like a
// warm one.
//
// Two call sites: the end of stepPlayerMotion (same-tick catch for the
// integrator, which is also the client prediction path) and the entity
// prologue for every player (runs ahead of movement, after the respawn and
// ground-effect phases: anything a forced locomotion arm, a knockback, or a
// teleport left behind since the last step is restored there, one tick late
// at worst, and those earlier phases only compare against the NaN, they never
// index by it). A restore deliberately forfeits in-flight momentum and the
// accumulated fall (a Disengage arc, an air-steer, a long drop): a broken pose
// most likely came from a broken velocity, and a body that lands is
// recoverable while a NaN one is not.
//
// Reporting: a dev-channel console.warn naming the entity and the input it
// held, so a log can attribute the next source. This is the first per-tick
// warn site in src/sim, so it is throttled per entity (first restore, then
// every Nth): a persistent source restores 20 times a second per player while
// a bad input is held. The counters hang off the HOST object (the deps of a
// kernel caller, the SimContext of the prologue) in a WeakMap, so two Sims in
// one process never share them and they free with their owner; they gate the
// log line only and never feed sim state, so the recovery itself stays
// deterministic (no rng, no clock).

import type { Entity, MoveInput } from './types';

/** Throttle for the warning: first restore, then every Nth (10 s at 20 Hz). */
export const NON_FINITE_WARN_EVERY = 200;

/** Host hook for a restored pose: the entity and the input it was holding, if any. */
export type NonFinitePoseHook = (p: Entity, inp: MoveInput | undefined) => void;

export function isPosFinite(pos: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
}

/** True when every integrator-owned pose component is a finite number. */
export function isPoseFinite(p: Entity): boolean {
  return (
    isPosFinite(p.pos) &&
    Number.isFinite(p.facing) &&
    Number.isFinite(p.vx) &&
    Number.isFinite(p.vz) &&
    Number.isFinite(p.vy) &&
    Number.isFinite(p.fallStartY)
  );
}

/**
 * Restores whatever is non-finite and returns whether anything was. Position
 * comes back as one consistent point (prevPos, else the broken axes zeroed:
 * a wrong-but-finite pose is recoverable, a NaN one is not), facing from
 * prevFacing, momentum is forfeited when position or velocity broke, and
 * fallStartY follows the restored height.
 */
export function guardFinitePose(p: Entity): boolean {
  if (isPoseFinite(p)) return false;
  const posBroken = !isPosFinite(p.pos);
  if (posBroken) {
    if (p.prevPos && isPosFinite(p.prevPos)) {
      p.pos.x = p.prevPos.x;
      p.pos.y = p.prevPos.y;
      p.pos.z = p.prevPos.z;
    } else {
      if (!Number.isFinite(p.pos.x)) p.pos.x = 0;
      if (!Number.isFinite(p.pos.y)) p.pos.y = 0;
      if (!Number.isFinite(p.pos.z)) p.pos.z = 0;
    }
  }
  if (!Number.isFinite(p.facing)) p.facing = Number.isFinite(p.prevFacing) ? p.prevFacing : 0;
  const velBroken = !Number.isFinite(p.vx) || !Number.isFinite(p.vz) || !Number.isFinite(p.vy);
  if (posBroken || velBroken) {
    p.vx = 0;
    p.vz = 0;
    p.vy = 0;
  }
  if (posBroken || !Number.isFinite(p.fallStartY)) p.fallStartY = p.pos.y;
  return true;
}

// Restores seen per entity id, per host, for the log throttle only. Keyed by
// id inside a host because the client prediction steps a fresh state object
// per frame (and replays up to 128 of them per snapshot).
const restoresByHost = new WeakMap<object, Map<number, number>>();

function countRestore(host: object, id: number): number {
  let byId = restoresByHost.get(host);
  if (!byId) {
    byId = new Map();
    restoresByHost.set(host, byId);
  }
  const n = (byId.get(id) ?? 0) + 1;
  byId.set(id, n);
  return n;
}

/**
 * Default report: a dev-channel line naming the entity and the input it held,
 * on the first restore for that entity under this host and then every
 * NON_FINITE_WARN_EVERY-th. The client prediction steps a bare motion state
 * (id only), so the label degrades to the id there.
 */
export function warnNonFinitePose(host: object, p: Entity, inp: MoveInput | undefined): void {
  const n = countRestore(host, p.id);
  if (n !== 1 && n % NON_FINITE_WARN_EVERY !== 0) return;
  const label = [p.kind, p.id, p.name].filter((v) => v !== undefined).join(' ');
  const held = inp ? JSON.stringify(inp) : 'none (between steps)';
  console.warn(`[sim] non-finite pose restored for ${label} (restore ${n}): input=${held}`);
}

/**
 * The guard plus its report: the one line each call site needs. `host` is the
 * object whose lifetime scopes the throttle (a caller's deps, a SimContext).
 */
export function guardAndReportPose(
  host: object,
  p: Entity,
  inp?: MoveInput,
  hook?: NonFinitePoseHook,
): void {
  if (!guardFinitePose(p)) return;
  if (hook) hook(p, inp);
  else warnNonFinitePose(host, p, inp);
}
