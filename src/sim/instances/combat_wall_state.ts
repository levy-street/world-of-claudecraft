// Temporary combat walls, the collision half (the trash engine's
// mob/trash_kit/combat_walls.ts is the authority): a wall a mechanic drops in
// the middle of a fight (the Ogre Sledge-Hauler's Ice Slab) is a ground
// object whose template id names its SHAPE here; every slot's live walls are
// published to this per-slot view, and every interior collision reader
// (movement, the sight sampler, the standable-top query, through
// interior_collider_sets.ts interiorCollidersFor) sees the slot's list with
// the walls appended, so a wall blocks bodies AND line of sight exactly where
// it stands.
//
// Who writes it: the authoritative world after every trash pass (the Sim, via
// combat_walls.ts syncCombatWallCollision) and the online ClientWorld from the
// wall objects it mirrors (net/combat_wall_wire.ts), so the local movement
// prediction walls where the server walls. Process-wide per slot origin, the
// shape of the gate view (dungeon_gate_state.ts): two live worlds in one
// process running the same slot would contend, and each re-writes its own
// state when its walls change. A slot nobody wrote holds no walls.
//
// Pure leaf: no SimContext, no rng, no entity reads.

import type { Collider } from '../colliders';

/** A combat wall's footprint: an oriented box of half extents (hw, hd) about
 *  the object's position and yaw, scaled by the object's `scale`, standing
 *  `height` yards over its base for the sight test. */
export interface CombatWallShape {
  hw: number;
  hd: number;
  height: number;
}

/** Every wall shape, by the object template id that carries it. A new wall
 *  kind is one row here plus its look in the renderer. */
export const COMBAT_WALL_SHAPES: Readonly<Record<string, CombatWallShape>> = {
  // The Ogre Sledge-Hauler's Ice Slab: a hauled block of lake ice about four
  // yards on a side and a good head taller than a player, crashed down where
  // its Ice Block Toss landed (gravewyrm_sanctum.ts).
  sanctum_ice_slab: { hw: 2.1, hd: 1.6, height: 3.4 },
};

/** Is `templateId` a combat wall's? */
export function isCombatWallTemplate(templateId: string): boolean {
  return Object.hasOwn(COMBAT_WALL_SHAPES, templateId);
}

/** One wall as the slot publishes it: instance-local centre, yaw, scale and
 *  its base height (world y). */
export interface CombatWallPlacement {
  id: number;
  templateId: string;
  /** Instance-local centre (world minus the slot origin). */
  x: number;
  z: number;
  /** World y of its base. */
  y: number;
  rot: number;
  scale: number;
}

/** The collider a wall stands as (instance-local frame), or null for an
 *  unknown shape. Full height for movement; its sight top over its base. */
export function combatWallCollider(w: CombatWallPlacement): Collider | null {
  const shape = COMBAT_WALL_SHAPES[w.templateId];
  if (!shape) return null;
  const s = w.scale > 0 ? w.scale : 1;
  return {
    type: 'obb',
    x: w.x,
    z: w.z,
    hw: shape.hw * s,
    hd: shape.hd * s,
    rot: w.rot,
    cameraTopY: w.y + shape.height * s,
  };
}

interface SlotWalls {
  /** Placement signature: re-publishing the same walls is a no-op. */
  sig: string;
  colliders: Collider[];
  version: number;
}

interface ComposedList {
  base: Collider[];
  version: number;
  list: Collider[];
}

const slots = new Map<number, Map<number, SlotWalls>>();
const composed = new Map<number, Map<number, ComposedList>>();
let versionCounter = 0;

function slotOf(ox: number, oz: number): SlotWalls | undefined {
  return slots.get(ox)?.get(oz);
}

function signature(walls: readonly CombatWallPlacement[]): string {
  let sig = '';
  for (const w of walls) sig += `${w.id}:${w.templateId}:${w.x}:${w.z}:${w.y}:${w.rot}:${w.scale};`;
  return sig;
}

/** Replace the live walls of the slot anchored at (ox, oz). No-op when the
 *  placements are unchanged (so a per-tick re-publish costs one string). */
export function setCombatWalls(
  ox: number,
  oz: number,
  walls: readonly CombatWallPlacement[],
): void {
  const sig = signature(walls);
  const cur = slotOf(ox, oz);
  if (cur ? cur.sig === sig : walls.length === 0) return;
  const colliders: Collider[] = [];
  for (const w of walls) {
    const c = combatWallCollider(w);
    if (c) colliders.push(c);
  }
  let row = slots.get(ox);
  if (!row) {
    row = new Map();
    slots.set(ox, row);
  }
  if ((cur?.colliders.length ?? 0) === 0 && colliders.length > 0) walledSlots++;
  if ((cur?.colliders.length ?? 0) > 0 && colliders.length === 0) {
    walledSlots--;
    // Let the last walled list (and its cell index) go with the walls.
    composed.get(ox)?.delete(oz);
  }
  row.set(oz, { sig, colliders, version: ++versionCounter });
}

/** How many slots in the process hold a wall: the read path's one-integer
 *  early out while no wall stands anywhere (the common case). */
let walledSlots = 0;

/** The wall colliders live in a slot (empty when it holds none). */
export function combatWallsAt(ox: number, oz: number): readonly Collider[] {
  return slotOf(ox, oz)?.colliders ?? EMPTY;
}

const EMPTY: readonly Collider[] = [];

/** Forget every slot's walls (tests only; a live world simply re-writes). */
export function clearCombatWallStateForTest(): void {
  slots.clear();
  composed.clear();
  walledSlots = 0;
}

/**
 * The slot's view of an interior list with its live walls appended: `base`
 * itself when the slot holds none (every interior and every quiet slot, zero
 * cost), else a new list cached per (base, wall version), so the interior
 * cell index (interior_collider_cells.ts, keyed on list identity) re-indexes
 * once per wall change, never per read. The walls come LAST, so every
 * authored collider keeps its place in the push-out order.
 */
export function slotWalledColliders(base: Collider[], ox: number, oz: number): Collider[] {
  if (walledSlots === 0) return base;
  const state = slotOf(ox, oz);
  if (!state || state.colliders.length === 0) return base;
  let row = composed.get(ox);
  const cached = row?.get(oz);
  if (cached && cached.base === base && cached.version === state.version) return cached.list;
  const list = base.concat(state.colliders);
  if (!row) {
    row = new Map();
    composed.set(ox, row);
  }
  row.set(oz, { base, version: state.version, list });
  return list;
}
