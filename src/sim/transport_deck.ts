// A sailing ship's deck as a kinematic platform (Phase 3 of the Eastbrook
// ferry): the moving half of the ship's collision. Moored, the deck is the
// Phase 1 hull layout placed into the static collider grid at the berth and
// gated by the timetable (transport_gates.ts). Under way the grid stays
// static and the deck lives HERE instead: the same hull volumes, placed at the
// ship's pose for the current tick, handed to the movement kernel as a
// platform (player_motion.ts `PlayerMotionDeps.platform`, physics/platform.ts),
// so a passenger walks, jumps, climbs the quarterdeck stair and leans on the
// rails exactly as on the moored deck.
//
// Moving a passenger with the ship is a rigid carry applied before the step:
// wherever the ship was last tick, a body aboard it then (standing, or in
// the air over the hull) keeps its spot, heading and ship-relative velocity in
// the hull's frame and is re-placed at this tick's pose (`carryWithDeck`).
// The step that follows moves it relative to the deck. Only yaw and
// translation ride the sim; the visual bob and roll stay render-only.
//
// Under way the gangplank is stowed and the gangway's side step shipped with
// it, so the port gangway opening is a sheer drop: the one way overboard
// (the rails top a jump everywhere else). A body that leaves the hull's
// footprint is simply no longer carried: it falls into the sea where it is
// and swims, and the ship sails on. Nothing boards a ship under way from the
// water: the hull's sides stand taller than any swimmer can hop.
//
// Pure leaf over the hull layout (transport_ship.ts): no SimContext, no rng.
// The ferry system (transport_ferry.ts) and the online client's prediction
// both build their platforms here, so both hosts solve the same deck.

import type { Collider } from './colliders';
import { angleDelta, type TransportPose } from './transport_schedule';
import type { ShipHullLayout, ShipPose, ShipVolume } from './transport_ship';
import { type Entity, normAngle } from './types';

/** Feet this far below the main deck still count as aboard (a stair tread,
 *  the hatch step, a landing from a hop). A swimmer is far lower. */
export const DECK_ABOARD_BELOW = 1.0;
/** ...and never more than this far above the waterline (a leap overhead). */
export const DECK_ABOARD_MAX_ABOVE_WATER = 14;
/** A platform is handed to the kernel for bodies this far (yards) past the
 *  hull's half length from its centre: aboard, or close enough alongside for
 *  the hull to be something they bump into. */
const DECK_REACH_PAD = 4;

/** Whether a hull volume stays part of the deck under way: everything but
 *  the boarding gear (the stowed gangplank and the gangway's side step). */
export function sailingDeckVolume(v: ShipVolume): boolean {
  return v.kind !== 'gangplank' && v.kind !== 'gangway';
}

/** Ship-frame to world XZ into `out` (three.js rotation.y convention),
 *  allocation free; the same map as transport_ship.ts shipToWorld. */
export function deckToWorld(
  pose: TransportPose,
  x: number,
  z: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const c = Math.cos(pose.rot);
  const s = Math.sin(pose.rot);
  const wx = pose.x + x * c + z * s;
  const wz = pose.z - x * s + z * c;
  out.x = wx;
  out.z = wz;
  return out;
}

/** World XZ to the ship frame into `out` (the inverse of deckToWorld). */
export function worldToDeck(
  pose: TransportPose,
  x: number,
  z: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const c = Math.cos(pose.rot);
  const s = Math.sin(pose.rot);
  const dx = x - pose.x;
  const dz = z - pose.z;
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
  return out;
}

const local = { x: 0, z: 0 };

/**
 * Is a body at (x, y, z) aboard the ship at `pose` (waterline `baseY`): over
 * the hull's footprint, feet at deck height or in the air above it? The
 * footprint follows the hull's taper (`halfBeamAt`): the bow and stern are far
 * narrower than the beam, and a pier the ship swings past at its ends stands
 * at a height inside the aboard band.
 */
export function aboardDeck(
  hull: ShipHullLayout,
  pose: TransportPose,
  baseY: number,
  x: number,
  y: number,
  z: number,
): boolean {
  worldToDeck(pose, x, z, local);
  const above = y - baseY;
  if (Math.abs(local.z) > hull.length / 2) return false;
  const halfBeam = hull.halfBeamAt ? hull.halfBeamAt(local.z) : hull.beam / 2;
  return (
    Math.abs(local.x) <= halfBeam &&
    above >= hull.mainDeckY - DECK_ABOARD_BELOW &&
    above <= DECK_ABOARD_MAX_ABOVE_WATER
  );
}

/** Is (x, z) close enough to the ship at `pose` for its deck to matter? */
export function nearDeck(hull: ShipHullLayout, pose: TransportPose, x: number, z: number): boolean {
  const reach = hull.length / 2 + DECK_REACH_PAD;
  const dx = x - pose.x;
  const dz = z - pose.z;
  return dx * dx + dz * dz <= reach * reach;
}

/**
 * Carry a body aboard the ship from where the ship was (`from`) to where it
 * is (`to`): the same spot in the hull's frame, the heading turned with the
 * hull, and any velocity (a jump, a fall) turned with it too, so a leap on a
 * turning deck lands where it would on a moored one. Height is untouched
 * (the sim's hull neither pitches nor rolls).
 */
export function carryWithDeck(from: TransportPose, to: TransportPose, e: Entity): void {
  worldToDeck(from, e.pos.x, e.pos.z, local);
  deckToWorld(to, local.x, local.z, local);
  e.pos.x = local.x;
  e.pos.z = local.z;
  const d = angleDelta(from.rot, to.rot);
  if (d === 0) return;
  e.facing = normAngle(e.facing + d);
  if (e.vx !== 0 || e.vz !== 0) {
    const c = Math.cos(d);
    const s = Math.sin(d);
    const vx = e.vx;
    e.vx = vx * c + e.vz * s;
    e.vz = -vx * s + e.vz * c;
  }
}

/**
 * One ship's deck under way: its sailing volumes as world colliders, placed
 * at a pose and re-placed in place (no allocation) whenever the pose moves.
 * Each consumer owns its own (the Sim per world and route, the online
 * prediction its own), so two poses in one process never share colliders.
 */
export class DeckPlatform {
  private readonly volumes: readonly ShipVolume[];
  private readonly colliders: Collider[];
  private readonly placed: ShipPose = { x: Number.NaN, z: Number.NaN, rot: Number.NaN, baseY: 0 };

  constructor(readonly hull: ShipHullLayout) {
    this.volumes = hull.volumes.filter(sailingDeckVolume);
    this.colliders = this.volumes.map((v) =>
      v.shape === 'circle'
        ? { type: 'circle' as const, x: 0, z: 0, r: v.r ?? 0.5 }
        : { type: 'obb' as const, x: 0, z: 0, hw: v.hw ?? 0.5, hd: v.hd ?? 0.5, rot: 0 },
    );
  }

  /** The deck's colliders at `pose` over waterline `baseY`. A LIVE list,
   *  valid until the next call with a different pose. */
  at(pose: TransportPose, baseY: number): readonly Collider[] {
    const p = this.placed;
    if (p.x === pose.x && p.z === pose.z && p.rot === pose.rot && p.baseY === baseY) {
      return this.colliders;
    }
    p.x = pose.x;
    p.z = pose.z;
    p.rot = pose.rot;
    p.baseY = baseY;
    for (let i = 0; i < this.volumes.length; i++) {
      const v = this.volumes[i];
      const c = this.colliders[i];
      deckToWorld(pose, v.x, v.z, c);
      c.moveTopY = baseY + v.top;
      c.cameraTopY = baseY + (v.sightTop ?? v.top);
      if (v.standable) c.standable = true;
      if (c.type === 'obb') c.rot = pose.rot + (v.rot ?? 0);
    }
    return this.colliders;
  }
}

/** A body's spot in the hull's frame: x port, y above the waterline, z bow,
 *  and its heading relative to the bow. */
export interface DeckLocal {
  x: number;
  y: number;
  z: number;
  f: number;
}

/** Where a body at world (x, y, z) facing `facing` stands in the frame of the
 *  ship at `pose` over `baseY`, into `out`. */
export function toDeckLocal(
  pose: TransportPose,
  baseY: number,
  x: number,
  y: number,
  z: number,
  facing: number,
  out: DeckLocal,
): DeckLocal {
  worldToDeck(pose, x, z, local);
  out.x = local.x;
  out.z = local.z;
  out.y = y - baseY;
  out.f = normAngle(facing - pose.rot);
  return out;
}
