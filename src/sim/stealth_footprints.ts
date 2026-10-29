// Stealth Rework, footprints. A stealthed player who moves leaves faint prints
// on the ground that ENEMY players can read, but only prints at least
// FOOTPRINT_LAG seconds old: the trail says where the stealther was and which
// way they went, never where they stand now. Standing still leaves nothing.
// Vanish and Greater Invisibility leave no trail: both are full escapes.
//
// Recording runs from updateAuras (the per-tick owner of the stealth flag),
// one stride check per stealthed player; the trail lives on the Entity as a
// bounded ring (FOOTPRINT_MAX) that expires after FOOTPRINT_LIFETIME. It is
// presentation-only state: it never feeds a gameplay decision, draws no rng,
// and is never persisted.
//
// Reading is two steps so a host pays the viewer-independent part ONCE:
// footprintSourceViews (per tick offline, per broadcast pass on the server)
// keeps each trail's readable prints and their bounding box, then
// forEachVisibleFootprint rejects a far trail by that box BEFORE the hostility
// check and walks only the prints of nearby enemies. Both worlds project
// through it, so a viewer reads the same prints offline and online.

import type { Entity } from './types';

/** Yards walked between two prints. */
export const FOOTPRINT_STRIDE = 1.5;
/** The newest print an enemy can read is at least this many seconds old. */
export const FOOTPRINT_LAG = 2;
/** A print fades out completely after this many seconds. */
export const FOOTPRINT_LIFETIME = 10;
/** Ring capacity per stealther (a full-speed Stalk fills it in about 7 sec). */
export const FOOTPRINT_MAX = 32;
/** An enemy reads prints only within this many yards of themselves. */
export const FOOTPRINT_READ_RADIUS = 25;
/** Hard cap on the prints shipped to, or drawn for, one viewer. */
export const FOOTPRINT_VIEW_CAP = 64;

export interface StealthFootprint {
  x: number;
  /** The stealther's feet height, so a print on a bridge or a deck sits on it. */
  y: number;
  z: number;
  /** The stealther's facing when the print was left (the toe direction). */
  facing: number;
  /** Sim time the print was left. */
  t: number;
  /** 0 = left foot, 1 = right foot (offset either side of the path). */
  foot: 0 | 1;
}

export interface StealthTrail {
  prints: StealthFootprint[];
  /** Where the last print was left (the stride is measured from here). */
  lastX: number;
  lastZ: number;
  nextFoot: 0 | 1;
}

/** One print as a viewer sees it. `bornAt` is the sim time it was left and
 *  `age` the seconds since, at the moment the list was produced. */
export interface VisibleFootprint {
  x: number;
  y: number;
  z: number;
  facing: number;
  bornAt: number;
  age: number;
  foot: 0 | 1;
}

// The escapes that leave no trail. Kept here rather than imported, so the
// footprints stand on their own: Smokefade (the vanish id) and Greater
// Invisibility, whose tooltip reads "Vanish for 20 sec".
const NO_TRAIL_STEALTH_IDS: ReadonlySet<string> = new Set(['vanish', 'greater_invisibility']);

function leavesNoTrail(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'stealth' && NO_TRAIL_STEALTH_IDS.has(a.id));
}

function pruneExpired(trail: StealthTrail, now: number): void {
  let drop = 0;
  while (drop < trail.prints.length && now - trail.prints[drop].t > FOOTPRINT_LIFETIME) drop++;
  if (drop > 0) trail.prints.splice(0, drop);
}

/** Per-tick recorder, called for every entity from updateAuras. */
export function recordStealthFootprints(e: Entity, now: number): void {
  if (e.kind !== 'player') return;
  const trail = e.stealthTrail;
  const leaving = e.stealthed && !e.dead && !leavesNoTrail(e);
  if (!leaving) {
    if (!trail) return;
    pruneExpired(trail, now);
    if (trail.prints.length === 0) e.stealthTrail = undefined;
    else trail.lastX = Number.NaN; // the next stealth starts a fresh stride
    return;
  }
  const { x, y, z } = e.pos;
  // A non-finite pose never becomes a print, so no host can ever ship NaN.
  if (![x, y, z, e.facing].every(Number.isFinite)) return;
  if (!trail || Number.isNaN(trail.lastX)) {
    const prints = trail?.prints ?? [];
    e.stealthTrail = { prints, lastX: x, lastZ: z, nextFoot: trail?.nextFoot ?? 0 };
    return;
  }
  pruneExpired(trail, now);
  const dx = x - trail.lastX;
  const dz = z - trail.lastZ;
  if (dx * dx + dz * dz < FOOTPRINT_STRIDE * FOOTPRINT_STRIDE) return;
  trail.prints.push({ x, y, z, facing: e.facing, t: now, foot: trail.nextFoot });
  if (trail.prints.length > FOOTPRINT_MAX) trail.prints.shift();
  trail.lastX = x;
  trail.lastZ = z;
  trail.nextFoot = trail.nextFoot === 0 ? 1 : 0;
}

export interface FootprintWorld {
  readonly time: number;
  isHostileTo(viewer: Entity, other: Entity): boolean;
}

export interface FootprintRoster {
  readonly players: ReadonlyMap<number, { entityId: number }>;
  readonly entities: ReadonlyMap<number, Entity>;
}

/** One stealther's readable prints right now (inside the lag/lifetime window,
 *  oldest first) and their bounding box. */
export interface FootprintSourceView {
  src: Entity;
  prints: StealthFootprint[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const NO_VIEWS: readonly FootprintSourceView[] = Object.freeze([]);

/** The viewer-independent half: every trail with a readable print. Walks the
 *  player roster, never every entity, and allocates nothing when no player
 *  carries a trail (the common case). */
export function footprintSourceViews(
  world: FootprintWorld & FootprintRoster,
): readonly FootprintSourceView[] {
  let out: FootprintSourceView[] | null = null;
  for (const meta of world.players.values()) {
    const src = world.entities.get(meta.entityId);
    const trail = src?.stealthTrail;
    if (!src || !trail || trail.prints.length === 0) continue;
    let view: FootprintSourceView | null = null;
    for (const p of trail.prints) {
      const age = world.time - p.t;
      if (age < FOOTPRINT_LAG || age > FOOTPRINT_LIFETIME) continue;
      if (!view) view = { src, prints: [], minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z };
      view.prints.push(p);
      if (p.x < view.minX) view.minX = p.x;
      if (p.x > view.maxX) view.maxX = p.x;
      if (p.z < view.minZ) view.minZ = p.z;
      if (p.z > view.maxZ) view.maxZ = p.z;
    }
    if (view) {
      out ??= [];
      out.push(view);
    }
  }
  return out ?? NO_VIEWS;
}

/** Visit the prints `viewer` can read, oldest first per trail, stopping at
 *  FOOTPRINT_VIEW_CAP: enemies only, never their own, within the read radius,
 *  never for a dead viewer. A trail whose box is out of reach costs four
 *  comparisons and no hostility check. Returns how many were visited. Pure:
 *  no clock, no rng. */
export function forEachVisibleFootprint(
  world: FootprintWorld,
  viewer: Entity,
  views: Iterable<FootprintSourceView>,
  visit: (print: StealthFootprint, view: FootprintSourceView, index: number) => void,
): number {
  if (viewer.dead) return 0;
  const r = FOOTPRINT_READ_RADIUS;
  const vx = viewer.pos.x;
  const vz = viewer.pos.z;
  let shown = 0;
  for (const view of views) {
    if (view.src.id === viewer.id) continue;
    if (vx < view.minX - r || vx > view.maxX + r || vz < view.minZ - r || vz > view.maxZ + r) {
      continue;
    }
    if (!world.isHostileTo(viewer, view.src)) continue;
    for (let i = 0; i < view.prints.length; i++) {
      const p = view.prints[i];
      const dx = p.x - vx;
      const dz = p.z - vz;
      if (dx * dx + dz * dz > r * r) continue;
      visit(p, view, i);
      if (++shown >= FOOTPRINT_VIEW_CAP) return shown;
    }
  }
  return shown;
}

/** The prints `viewer` can read as a fresh list (see forEachVisibleFootprint). */
export function visibleStealthFootprints(
  world: FootprintWorld,
  viewer: Entity,
  views: readonly FootprintSourceView[],
): VisibleFootprint[] {
  const out: VisibleFootprint[] = [];
  forEachVisibleFootprint(world, viewer, views, (p) => {
    out.push({
      x: p.x,
      y: p.y,
      z: p.z,
      facing: p.facing,
      bornAt: p.t,
      age: world.time - p.t,
      foot: p.foot,
    });
  });
  return out;
}

const NO_FOOTPRINTS: readonly VisibleFootprint[] = Object.freeze([]);

// The offline Sim's per-tick memo. The renderer reads IWorld.stealthFootprints
// every frame, but prints only change when the sim ticks, so one list is built
// per (time, viewer) and handed back by identity until then (the visual skips
// its relay on an unchanged reference). The sanctioned WeakMap memo shape,
// keyed on the world object: `time` is the revision every writer of the inputs
// advances (recording runs inside the tick), the output is the unmemoized
// projection itself, and it never feeds sim state or the save shape.
const offlineMemo = new WeakMap<
  object,
  { time: number; viewerId: number; list: readonly VisibleFootprint[] }
>();

/** The offline Sim's IWorld read for its primary player. */
export function stealthFootprintsSeenBy(
  world: FootprintWorld & FootprintRoster,
  viewerId: number,
): readonly VisibleFootprint[] {
  const memo = offlineMemo.get(world);
  if (memo && memo.time === world.time && memo.viewerId === viewerId) return memo.list;
  const viewer = world.entities.get(viewerId);
  const views = viewer ? footprintSourceViews(world) : NO_VIEWS;
  const seen = viewer && views.length > 0 ? visibleStealthFootprints(world, viewer, views) : [];
  const list = seen.length === 0 ? NO_FOOTPRINTS : seen;
  offlineMemo.set(world, { time: world.time, viewerId, list });
  return list;
}
