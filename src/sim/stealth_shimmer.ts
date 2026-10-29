// Stealth Rework, shimmer band. An ENEMY stealther just past the detection
// cone's spot radius (threat.ts pvpStealthDetectionRadius), out to
// SHIMMER_BAND_MULT times it, is not seen but shimmers: the viewer is told that
// someone is there and roughly where, nothing more. A shimmer carries no id, no
// name, no class and no facing; its position is rounded to whole yards (feet
// height to half a yard) and its strength to SHIMMER_FADE_STEPS steps, so a
// modified client learns no more than an honest one draws. It cannot be
// targeted or clicked: it is not an entity. Vanish and Greater Invisibility
// never shimmer (both are full escapes), and an enemy the viewer already sees
// never shimmers on top of its body.
//
// Like the footprints, reading is two steps so a host pays the
// viewer-independent part once per pass: shimmerSources walks the player
// roster for stealthed players (none, the common case, allocates nothing),
// then forEachShimmer judges each source against one viewer. Pure: no clock,
// no rng, no Sim state; presentation only.

import {
  hasPvpEscapeStealth,
  PVP_STEALTH_DETECTION_BASE,
  pvpStealthDetectionRadius,
  withinPvpStealthDetection,
} from './threat';
import type { Entity } from './types';

/** The band reaches this many times the spot radius at the stealther's arc. */
export const SHIMMER_BAND_MULT = 2;
/** No shimmer reaches farther than this (the largest spot radius, at the
 *  level multiplier's 1.0 ceiling, times the band): a cheap first reject. */
export const SHIMMER_MAX_REACH = SHIMMER_BAND_MULT * PVP_STEALTH_DETECTION_BASE;
/** Hard cap on the shimmers shipped to, or drawn for, one viewer. */
export const SHIMMER_VIEW_CAP = 8;
/** The fade is sent in this many steps (1 at the spot radius, falling outward). */
export const SHIMMER_FADE_STEPS = 4;
/** A viewer's list moves at most once per this many ticks (twice a second);
 *  a shimmer that must disappear is sent at once. */
export const SHIMMER_SEND_INTERVAL_TICKS = 10;

/** One shimmer as a viewer receives it: a rounded position and a fade in
 *  (0, 1], 1 nearest the spot radius. */
export interface StealthShimmer {
  x: number;
  y: number;
  z: number;
  fade: number;
}

export interface ShimmerWorld {
  isHostileTo(viewer: Entity, other: Entity): boolean;
}

export interface ShimmerRoster {
  readonly players: ReadonlyMap<number, { entityId: number }>;
  readonly entities: ReadonlyMap<number, Entity>;
}

const NO_SOURCES: readonly Entity[] = Object.freeze([]);

// The cached flag first (updateAuras keeps it), so a roster of unstealthed
// players costs one read each.
function canShimmer(e: Entity): boolean {
  return (
    e.stealthed && !e.dead && e.auras.some((a) => a.kind === 'stealth') && !hasPvpEscapeStealth(e)
  );
}

/** The viewer-independent half: every living stealthed player that may
 *  shimmer. Walks the player roster, never every entity. */
export function shimmerSources(world: ShimmerRoster): readonly Entity[] {
  let out: Entity[] | null = null;
  for (const meta of world.players.values()) {
    const e = world.entities.get(meta.entityId);
    if (!e || !canShimmer(e)) continue;
    out ??= [];
    out.push(e);
  }
  return out ?? NO_SOURCES;
}

/** The shimmer `src` makes for `viewer` by distance alone, or null beyond the
 *  band. Hostility and "already seen" are the caller's (forEachShimmer). */
export function shimmerFor(viewer: Entity, src: Entity): StealthShimmer | null {
  const r = pvpStealthDetectionRadius(viewer, src);
  const dx = src.pos.x - viewer.pos.x;
  const dz = src.pos.z - viewer.pos.z;
  const d = Math.hypot(dx, dz);
  // Written so a non-finite distance is rejected too, never shipped as NaN.
  if (!(r > 0) || !(d <= r * SHIMMER_BAND_MULT)) return null;
  const t = d <= r ? 1 : 1 - (d - r) / (r * (SHIMMER_BAND_MULT - 1));
  return {
    x: Math.round(src.pos.x),
    y: Math.round(src.pos.y * 2) / 2,
    z: Math.round(src.pos.z),
    fade: Math.max(1, Math.ceil(t * SHIMMER_FADE_STEPS)) / SHIMMER_FADE_STEPS,
  };
}

/** Visit the shimmers `viewer` gets, up to SHIMMER_VIEW_CAP: enemies only,
 *  never their own, never for a dead viewer, never one `seen` says the viewer
 *  already sees (online: the entity is in this snapshot; offline: the spot
 *  rule). Distance is judged first, so a stealther across the realm costs a
 *  subtraction, never a hostility check. Returns how many were visited. */
export function forEachShimmer(
  world: ShimmerWorld,
  viewer: Entity,
  sources: Iterable<Entity>,
  seen: (src: Entity) => boolean,
  visit: (shimmer: StealthShimmer, src: Entity) => void,
): number {
  if (viewer.dead) return 0;
  const reachSq = SHIMMER_MAX_REACH * SHIMMER_MAX_REACH;
  let shown = 0;
  for (const src of sources) {
    if (src.id === viewer.id) continue;
    const dx = src.pos.x - viewer.pos.x;
    const dz = src.pos.z - viewer.pos.z;
    if (!(dx * dx + dz * dz <= reachSq)) continue;
    const shimmer = shimmerFor(viewer, src);
    if (!shimmer || !world.isHostileTo(viewer, src) || seen(src)) continue;
    visit(shimmer, src);
    if (++shown >= SHIMMER_VIEW_CAP) return shown;
  }
  return shown;
}

const NO_SHIMMERS: readonly StealthShimmer[] = Object.freeze([]);

// The offline Sim's per-tick memo, the same sanctioned shape as the footprints'
// (stealth_footprints.ts): keyed on the world object, `time` as the revision,
// the output the unmemoized projection itself, never fed back into sim state.
const offlineMemo = new WeakMap<
  object,
  { time: number; viewerId: number; list: readonly StealthShimmer[] }
>();

/** The offline Sim's IWorld read for its primary player. Offline there is no
 *  snapshot, so "already seen" is the spot rule itself. */
export function stealthShimmersSeenBy(
  world: ShimmerWorld & ShimmerRoster & { readonly time: number },
  viewerId: number,
): readonly StealthShimmer[] {
  const memo = offlineMemo.get(world);
  if (memo && memo.time === world.time && memo.viewerId === viewerId) return memo.list;
  const viewer = world.entities.get(viewerId);
  const sources = viewer ? shimmerSources(world) : NO_SOURCES;
  const out: StealthShimmer[] = [];
  if (viewer && sources.length > 0) {
    forEachShimmer(
      world,
      viewer,
      sources,
      (src) => withinPvpStealthDetection(viewer, src),
      (s) => out.push(s),
    );
  }
  const list = out.length === 0 ? NO_SHIMMERS : out;
  offlineMemo.set(world, { time: world.time, viewerId, list });
  return list;
}
