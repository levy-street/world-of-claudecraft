// Course runtime state: the few registries a parkour course keeps OUTSIDE the
// closed-form clock math, because they record what bodies DID rather than what
// time it is. Crumble decks remember when they were stood on; ropes carry a
// physical oscillator driven by their load; checkpoint braziers remember who
// lit them.
//
// All state is keyed by an opaque per-instance string (`instKey`). The caller
// owns the format; nothing here parses it. On the server the sim writes these
// registries and the wire mirrors them to clients (deck-state events, snapshot
// catch-up); offline the one process is both writer and reader. Everything is
// deterministic: same inputs at the same clock produce the same state on every
// host, which is what lets the renderer draw collapse and sway from the same
// registries the floor query reads.

import type { CourseDuty } from './motion';

// ---------------------------------------------------------------------------
// Crumble decks. Solid until stood on, shaking for their delay, then gone
// until respawn seconds after arming. Per-(instance, deck) armed times.
// ---------------------------------------------------------------------------

export type CourseCrumblePhase = 'solid' | 'shaking' | 'gone';

export interface CourseCrumbleSpec {
  delay: number;
  respawn: number;
}

const crumbleArmedAt = new Map<string, number>();

const crumbleKey = (instKey: string, deckIndex: number): string => `${instKey}#${deckIndex}`;

/** Arm a crumble deck (a body stood on it). True the first time only. */
export function armCourseCrumble(instKey: string, deckIndex: number, t: number): boolean {
  const key = crumbleKey(instKey, deckIndex);
  if (crumbleArmedAt.has(key)) return false;
  crumbleArmedAt.set(key, t);
  return true;
}

/** When a crumble deck was armed, or undefined while it stands untouched. */
export function courseCrumbleArmedAt(instKey: string, deckIndex: number): number | undefined {
  return crumbleArmedAt.get(crumbleKey(instKey, deckIndex));
}

/** A crumble deck's phase at clock time t. Prunes respawned entries on read,
 *  so a deck that re-hung is indistinguishable from one never stood on. */
export function courseCrumblePhase(
  spec: CourseCrumbleSpec,
  instKey: string,
  deckIndex: number,
  t: number,
): CourseCrumblePhase {
  const key = crumbleKey(instKey, deckIndex);
  const armed = crumbleArmedAt.get(key);
  if (armed === undefined) return 'solid';
  // A chase run arms decks with FUTURE times (the wave has not reached them
  // yet): those stand solid, not shaking, until their moment comes.
  if (t < armed) return 'solid';
  if (t < armed + spec.delay) return 'shaking';
  if (t < armed + spec.delay + spec.respawn) return 'gone';
  crumbleArmedAt.delete(key);
  return 'solid';
}

/** Keep a fallen deck 'gone' while a body is still falling through its
 *  column: re-hanging a deck INTO a falling body would catch them mid-air
 *  on geometry that visibly was not there. */
export function deferCourseCrumbleRehang(
  spec: CourseCrumbleSpec,
  instKey: string,
  deckIndex: number,
  t: number,
): void {
  const key = crumbleKey(instKey, deckIndex);
  const armed = crumbleArmedAt.get(key);
  if (armed === undefined) return;
  if (t + 0.6 >= armed + spec.delay + spec.respawn) {
    crumbleArmedAt.set(key, t + 0.6 - spec.delay - spec.respawn);
  }
}

// ---------------------------------------------------------------------------
// Collapse-chase runs. Crossing a trigger line arms a whole run of crumble
// decks with staggered delays, so the floor falls BEHIND a sprinting body.
// Implemented entirely on the crumble registry: the chase is just a batch of
// arms whose delays grow with distance from the trigger.
// ---------------------------------------------------------------------------

/** Arm every deck of a chase run at once, delay growing along the run.
 *  `spacings` is each deck's distance from the trigger in run order; the wave
 *  reaches deck i at t + spacings[i] / waveSpeed (its own crumble delay then
 *  runs on top, which is the shake telegraph). True if this call armed it. */
export function armCourseChase(
  instKey: string,
  deckIndices: readonly number[],
  spacings: readonly number[],
  waveSpeed: number,
  t: number,
): boolean {
  let any = false;
  for (let i = 0; i < deckIndices.length; i++) {
    const at = t + (spacings[i] ?? 0) / Math.max(0.5, waveSpeed);
    const key = crumbleKey(instKey, deckIndices[i]);
    if (!crumbleArmedAt.has(key)) {
      crumbleArmedAt.set(key, at);
      any = true;
    }
  }
  return any;
}

// ---------------------------------------------------------------------------
// Checkpoint braziers. Lighting one moves rift deaths' respawn to it. Keyed
// per (instance, player): a checkpoint is personal progress, not party state,
// so one runner's brazier never teleports a lagging party mate forward.
// ---------------------------------------------------------------------------

const checkpoints = new Map<string, number>();

const checkpointKey = (instKey: string, pid: number): string => `${instKey}@${pid}`;

/** Record that `pid` lit brazier `index`. True when this raised their best. */
export function lightCourseCheckpoint(instKey: string, pid: number, index: number): boolean {
  const key = checkpointKey(instKey, pid);
  const prev = checkpoints.get(key);
  if (prev !== undefined && prev >= index) return false;
  checkpoints.set(key, index);
  return true;
}

/** The highest brazier `pid` has lit in this instance, or null. */
export function courseCheckpointFor(instKey: string, pid: number): number | null {
  return checkpoints.get(checkpointKey(instKey, pid)) ?? null;
}

// ---------------------------------------------------------------------------
// Gem circuits. Collected gem indices per (instance, player). Personal, like
// checkpoints: the bonus is earned by the body that made the jumps.
// ---------------------------------------------------------------------------

const gems = new Map<string, Set<number>>();

/** Record gem pickup. True when newly collected. */
export function collectCourseGem(instKey: string, pid: number, index: number): boolean {
  const key = checkpointKey(instKey, pid);
  let held = gems.get(key);
  if (!held) {
    held = new Set();
    gems.set(key, held);
  }
  if (held.has(index)) return false;
  held.add(index);
  return true;
}

/** How many gems `pid` holds in this instance. */
export function courseGemCount(instKey: string, pid: number): number {
  return gems.get(checkpointKey(instKey, pid))?.size ?? 0;
}

/** Has `pid` collected gem `index`? The renderer hides YOUR collected gems. */
export function courseGemCollected(instKey: string, pid: number, index: number): boolean {
  return gems.get(checkpointKey(instKey, pid))?.has(index) === true;
}

// ---------------------------------------------------------------------------
// Tightropes. A damped harmonic oscillator per rope whose forcing is the load
// standing on it: one steady walker barely disturbs it; a second body arriving
// out of phase pumps the same mode and the span starts throwing people.
// Ported intact from the Blackspan pit course.
// ---------------------------------------------------------------------------

export interface CourseRope {
  id: string;
  x1: number;
  z1: number;
  y1: number;
  x2: number;
  z2: number;
  y2: number;
  halfWidth: number;
  sag: number;
  sway: number;
}

const ROPE_K = 5.2;
const ROPE_C = 1.15;
const ROPE_COUPLE = 2.1;
const ROPE_DRIVE = 1.15;

const ropeStates = new Map<string, { offset: number; vel: number }>();

const ropeKey = (instKey: string, ropeId: string): string => `${instKey}~${ropeId}`;

/** The rope's current lateral offset at midspan (renderer + floor query). */
export function courseRopeOffset(instKey: string, ropeId: string): number {
  return ropeStates.get(ropeKey(instKey, ropeId))?.offset ?? 0;
}

/** A point along the rope at parameter s in [0, 1], with the live sway
 *  offset applied on the bow profile sin(pi * s): midspan has all the sway,
 *  the anchors none. */
export function courseRopePointAt(
  rope: CourseRope,
  s: number,
  offset: number,
): { x: number; z: number; y: number } {
  const bow = Math.sin(Math.PI * s);
  const dx = rope.x2 - rope.x1;
  const dz = rope.z2 - rope.z1;
  const len = Math.hypot(dx, dz) || 1;
  const px = -dz / len;
  const pz = dx / len;
  return {
    x: rope.x1 + dx * s + px * offset * bow,
    z: rope.z1 + dz * s + pz * offset * bow,
    y: rope.y1 + (rope.y2 - rope.y1) * s - rope.sag * bow,
  };
}

function ropeProject(rope: CourseRope, lx: number, lz: number): { s: number; perp: number } {
  const dx = rope.x2 - rope.x1;
  const dz = rope.z2 - rope.z1;
  const lenSq = dx * dx + dz * dz || 1;
  const s = ((lx - rope.x1) * dx + (lz - rope.z1) * dz) / lenSq;
  const len = Math.sqrt(lenSq);
  const perp = ((lx - rope.x1) * -dz + (lz - rope.z1) * dx) / len;
  return { s, perp };
}

/** Integrate one instance's ropes one step. `bodies` are course-local
 *  positions and velocities of everything that might be standing on a rope
 *  this tick; the caller owns the entity walk. Semi-implicit Euler, damped,
 *  capped at each rope's authored sway; parks exactly at rest when unloaded
 *  so an idle course serializes stably. */
export function stepCourseRopes(
  ropes: readonly CourseRope[],
  instKey: string,
  bodies: ReadonlyArray<{ x: number; z: number; y: number; vx: number; vz: number }>,
  dt: number,
): void {
  for (const rope of ropes) {
    const key = ropeKey(instKey, rope.id);
    let state = ropeStates.get(key);
    let force = 0;
    let loaded = false;
    for (const b of bodies) {
      const { s, perp } = ropeProject(rope, b.x, b.z);
      if (s < 0 || s > 1) continue;
      const line = rope.y1 + (rope.y2 - rope.y1) * s - rope.sag * Math.sin(Math.PI * s);
      if (b.y < line - 1.2 || b.y > line + 2.6) continue;
      const offset = state?.offset ?? 0;
      const bow = Math.sin(Math.PI * s);
      if (Math.abs(perp - offset * bow) > rope.halfWidth + 0.9) continue;
      loaded = true;
      const dx = rope.x2 - rope.x1;
      const dz = rope.z2 - rope.z1;
      const len = Math.hypot(dx, dz) || 1;
      const lateralV = (b.vx * -dz) / len + (b.vz * dx) / len;
      force += bow * (ROPE_COUPLE * (perp - offset * bow) + ROPE_DRIVE * lateralV);
    }
    if (!state) {
      if (!loaded) continue;
      state = { offset: 0, vel: 0 };
      ropeStates.set(key, state);
    }
    state.vel += (force - ROPE_K * state.offset - ROPE_C * state.vel) * dt;
    state.offset += state.vel * dt;
    if (state.offset > rope.sway) {
      state.offset = rope.sway;
      state.vel = Math.min(0, state.vel);
    } else if (state.offset < -rope.sway) {
      state.offset = -rope.sway;
      state.vel = Math.max(0, state.vel);
    }
    if (!loaded && Math.abs(state.offset) < 1e-4 && Math.abs(state.vel) < 1e-4) {
      ropeStates.delete(key);
    }
  }
}

/** Standing height on a rope at a course-local point, or null off the strip.
 *  The strip is the LIVE (swayed) rope line, so a heavily pumped span really
 *  does move out from under a careless foot. */
export function courseRopeFloorAt(
  ropes: readonly CourseRope[],
  instKey: string,
  lx: number,
  lz: number,
): number | null {
  let best: number | null = null;
  for (const rope of ropes) {
    const { s, perp } = ropeProject(rope, lx, lz);
    if (s < 0 || s > 1) continue;
    const offset = courseRopeOffset(instKey, rope.id);
    const bow = Math.sin(Math.PI * s);
    if (Math.abs(perp - offset * bow) > rope.halfWidth) continue;
    const y = rope.y1 + (rope.y2 - rope.y1) * s - rope.sag * bow;
    if (best === null || y > best) best = y;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Resets.
// ---------------------------------------------------------------------------

/** Clear ONE instance's course state (its run ended or its slot was freed). */
export function resetCourseStateFor(instKey: string): void {
  const deckPrefix = `${instKey}#`;
  for (const key of crumbleArmedAt.keys()) {
    if (key.startsWith(deckPrefix)) crumbleArmedAt.delete(key);
  }
  const bodyPrefix = `${instKey}@`;
  for (const key of checkpoints.keys()) {
    if (key.startsWith(bodyPrefix)) checkpoints.delete(key);
  }
  for (const key of gems.keys()) {
    if (key.startsWith(bodyPrefix)) gems.delete(key);
  }
  const ropePrefix = `${instKey}~`;
  for (const key of ropeStates.keys()) {
    if (key.startsWith(ropePrefix)) ropeStates.delete(key);
  }
}

/** Test/suite seam: clears ALL course state. */
export function resetCourseState(): void {
  crumbleArmedAt.clear();
  checkpoints.clear();
  gems.clear();
  ropeStates.clear();
}
