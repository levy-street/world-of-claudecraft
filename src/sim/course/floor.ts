// The course floor query: where can a body stand, right now, at this clock?
//
// A course is a set of elevated decks over a room's REAL floor. Unlike the
// Blackspan pit course this kernel descends from, decks here are NOT part of
// the world heightfield: they resolve through the physics kernel's support
// query (reach-gated, like standable prop tops), so a missed jump drops the
// body to the room floor below rather than into a void, and two decks MAY
// overlap in plan view (a spiral is legal) because a body only ever reads the
// deck within its own reach. That single difference is what makes generated
// courses safe: no generation-time plan-view exclusion proof is needed.
//
// Everything answers at one clock value. A piston's height, a ferry's
// position, a blink tile's existence, a crumble deck's phase: the same
// closed-form functions the renderer animates with, evaluated here for
// collision. What you see is exactly what you stand on.

import {
  blinkSolid,
  type CourseDuty,
  type CourseHazard,
  type CourseMotion,
  type CourseTrack,
  ferryPos,
  pistonLift,
} from './motion';
import {
  type CourseCrumbleSpec,
  type CourseRope,
  courseCrumblePhase,
  courseRopeFloorAt,
} from './state';

export type CourseDeckKind = 'piston' | 'crumble' | 'bellows' | 'geyser' | 'ferry' | 'blink';

/** One course deck: an axis-aligned standable top (course-local centre plus
 *  half extents, top height above the room floor). Static unless a kind and
 *  its matching spec say otherwise. */
export interface CourseDeck {
  x: number;
  z: number;
  hw: number;
  hd: number;
  y: number;
  kind?: CourseDeckKind;
  /** piston: vertical ride. */
  motion?: CourseMotion;
  /** crumble: stand, shake, gone, re-hang. */
  crumble?: CourseCrumbleSpec;
  /** ferry: horizontal ride. */
  track?: CourseTrack;
  /** blink solidity window, or a geyser's eruption window. */
  window?: CourseDuty;
}

/** A floor strip that acts on grounded bodies standing in it. */
export interface CoursePad {
  kind: 'conveyor' | 'boost';
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** conveyor: unit drift direction. */
  dirX?: number;
  dirZ?: number;
  /** conveyor: yards per second of drift; boost: aura seconds. */
  strength?: number;
  /** Standing height the pad sits at (a pad may ride a deck top). */
  y: number;
}

/** An optional collectible on the hard line. */
export interface CourseGem {
  x: number;
  z: number;
  y: number;
}

/** A rift-local respawn point; light it and deaths return here. */
export interface CourseBrazier {
  x: number;
  z: number;
  y: number;
  index: number;
}

/** A collapse-chase run: crossing the trigger arms `deckIndices` with delays
 *  growing along `spacings` at `waveSpeed`, so the floor falls behind you. */
export interface CourseChase {
  triggerX: number;
  triggerZ: number;
  triggerR: number;
  deckIndices: number[];
  spacings: number[];
  waveSpeed: number;
}

/** A fused crate guarding side loot: 'tnt' counts down on touch, 'nitro'
 *  detonates instantly. Spawned as ground objects by the sim. */
export interface CourseCrate {
  x: number;
  z: number;
  y: number;
  kind: 'tnt' | 'nitro';
}

/** The whole generated course for one rift floor. Course-local coordinates
 *  (the floor's instance-local frame); heights above the room floor. */
export interface CoursePlan {
  decks: CourseDeck[];
  hazards: CourseHazard[];
  ropes: CourseRope[];
  pads: CoursePad[];
  gems: CourseGem[];
  braziers: CourseBrazier[];
  crates: CourseCrate[];
  chases: CourseChase[];
  /** The course's top anchor: where a gate switch or prize stands. */
  summit: { x: number; z: number; y: number };
  /** Golden-route waypoints in climb order, for the envelope audit and the
   *  traversal bot. Built WITH the geometry so the two cannot drift. */
  route: Array<{ x: number; z: number; y: number }>;
}

/** A deck's centre at clock time t (ferries move; everything else is where
 *  it was authored). */
export function courseDeckCentre(deck: CourseDeck, t: number): { x: number; z: number } {
  if (deck.kind === 'ferry' && deck.track) return ferryPos(deck.x, deck.z, deck.track, t);
  return { x: deck.x, z: deck.z };
}

/** A deck's standing height at clock time t, ignoring solidity. */
export function courseDeckTop(deck: CourseDeck, t: number): number {
  if (deck.kind === 'piston' && deck.motion) return deck.y + pistonLift(deck.motion, t);
  return deck.y;
}

/** Is the deck solid at clock time t? Blink tiles follow their window;
 *  crumble decks follow their armed phase; everything else always is. */
export function courseDeckSolid(
  deck: CourseDeck,
  index: number,
  instKey: string,
  t: number,
): boolean {
  if (deck.kind === 'blink' && deck.window) return blinkSolid(deck.window, t);
  if (deck.kind === 'crumble' && deck.crumble) {
    return courseCrumblePhase(deck.crumble, instKey, index, t) !== 'gone';
  }
  return true;
}

export interface CourseStand {
  deck: CourseDeck;
  index: number;
  top: number;
}

/**
 * The best deck a body could stand on at a course-local point: the HIGHEST
 * solid top not above `maxY` (feet plus reach, exactly the support query's
 * gate). Null when nothing in reach holds a body there, in which case the
 * caller falls back to the room floor. Ropes are folded in as decks of their
 * own kind: narrow, live, and swaying.
 */
export function courseSupportAt(
  plan: CoursePlan,
  instKey: string,
  lx: number,
  lz: number,
  t: number,
  maxY: number,
): CourseStand | null {
  let best: CourseStand | null = null;
  for (let i = 0; i < plan.decks.length; i++) {
    const deck = plan.decks[i];
    const c = courseDeckCentre(deck, t);
    if (Math.abs(lx - c.x) > deck.hw || Math.abs(lz - c.z) > deck.hd) continue;
    const top = courseDeckTop(deck, t);
    if (top > maxY) continue;
    if (best && top <= best.top) continue;
    if (!courseDeckSolid(deck, i, instKey, t)) continue;
    best = { deck, index: i, top };
  }
  const rope = courseRopeFloorAt(plan.ropes, instKey, lx, lz);
  if (rope !== null && rope <= maxY && (!best || rope > best.top)) {
    best = { deck: ROPE_STAND, index: -1, top: rope };
  }
  return best;
}

/** Sentinel deck for a rope stand (index -1): callers that arm crumble or
 *  ride ferries key off real indices and skip it by construction. */
const ROPE_STAND: CourseDeck = { x: 0, z: 0, hw: 0, hd: 0, y: 0 };

/** The pad (conveyor, boost) under a body standing at a course-local point
 *  and height, or null. Pads act only within a stride of their surface, so a
 *  body jumping over one is not dragged. */
export function coursePadAt(plan: CoursePlan, lx: number, lz: number, y: number): CoursePad | null {
  for (const pad of plan.pads) {
    if (Math.abs(lx - pad.x) > pad.hw || Math.abs(lz - pad.z) > pad.hd) continue;
    if (Math.abs(y - pad.y) > 1.2) continue;
    return pad;
  }
  return null;
}
