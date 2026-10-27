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
import { noteAppendedColliders } from '../interior_collider_cells';

/** A combat wall's footprint: an oriented box of half extents (hw, hd) about
 *  the object's position and yaw, scaled by the object's `scale`, standing
 *  `height` yards over its base for the sight test. */
export interface CombatWallShape {
  hw: number;
  hd: number;
  height: number;
  /** A round wall (a pillar): a circle of radius `hw` instead of the box. */
  round?: boolean;
  /** Drawn by its own encounter's renderer, never as the engine's ice slab
   *  (the Hammer Council's pillars: render/smith_heart_fx). */
  ownLook?: boolean;
  /** A wall that walks (the mythic Walking Slab): its collider anchors on a
   *  grid this many yards wide (wallAnchor), so the slot's view republishes
   *  a few times a second as it drags, never every tick. */
  anchorStep?: number;
}

/** A wall's collider anchor along one axis (instance-local): its own spot,
 *  or for a walking wall the nearest point of its grid. Both worlds publish
 *  through it (combat_walls.ts, net/combat_wall_wire.ts), so they agree. */
export function wallAnchor(templateId: string, v: number): number {
  const step = COMBAT_WALL_SHAPES[templateId]?.anchorStep;
  return step ? Math.round(v / step) * step : v;
}

/** A wall entity's placement as both worlds publish it (combat_walls.ts,
 *  net/combat_wall_wire.ts): instance-local, on its grid for a walking wall,
 *  whose base height and (round) yaw ride the same grid so a drag over an
 *  uneven floor republishes only when the anchor moves. */
export function wallPlacement(
  e: {
    id: number;
    templateId: string;
    pos: { x: number; y: number; z: number };
    facing: number;
    scale: number;
  },
  ox: number,
  oz: number,
): CombatWallPlacement {
  const shape = COMBAT_WALL_SHAPES[e.templateId];
  const step = shape?.anchorStep;
  return {
    id: e.id,
    templateId: e.templateId,
    x: wallAnchor(e.templateId, e.pos.x - ox),
    z: wallAnchor(e.templateId, e.pos.z - oz),
    y: step ? Math.round(e.pos.y / step) * step : e.pos.y,
    rot: step && shape.round ? 0 : e.facing,
    scale: e.scale,
  };
}

/** Every wall shape, by the object template id that carries it. A new wall
 *  kind is one row here plus its look in the renderer. */
export const COMBAT_WALL_SHAPES: Readonly<Record<string, CombatWallShape>> = {
  // The Ogre Sledge-Hauler's Ice Slab: a hauled block of lake ice about four
  // yards on a side and a good head taller than a player, crashed down where
  // its Ice Block Toss landed (gravewyrm_sanctum.ts).
  sanctum_ice_slab: { hw: 2.1, hd: 1.6, height: 3.4 },
  // The Smith's Heart's Hammer Council pillars (encounters/smith_heart/
  // council_pillars.ts): the quarry's carved columns and the pillars the
  // Slabwright raises, one template per integrity left (3 whole, 2 cracked,
  // 1 about to fall). Sizes match content/smith_heart_layout.ts
  // QUARRY_PILLAR_R and QUARRY_PILLAR_H (pinned by the council tests).
  sh_council_pillar_3: { hw: 2.6, hd: 2.6, height: 13, round: true, ownLook: true },
  sh_council_pillar_2: { hw: 2.6, hd: 2.6, height: 13, round: true, ownLook: true },
  sh_council_pillar_1: { hw: 2.6, hd: 2.6, height: 13, round: true, ownLook: true },
  sh_council_risen_3: { hw: 2.2, hd: 2.2, height: 10, round: true, ownLook: true },
  sh_council_risen_2: { hw: 2.2, hd: 2.2, height: 10, round: true, ownLook: true },
  sh_council_risen_1: { hw: 2.2, hd: 2.2, height: 10, round: true, ownLook: true },
  // Mythic: a pillar holding a fallen member's soul (encounters/smith_heart/
  // council_soul.ts, council_ids.ts councilSoulTemplate), by soul, kind (c a
  // carved column, r a risen pillar) and pips left; the column's or the
  // risen pillar's own size (pinned by the soul tests).
  ...soulPillarShapes(),
  // The Smith's Heart's Guardian of the Quench (encounters/smith_heart/
  // quench_blades.ts, quench_rim.ts): the Smith's four great blades of ice,
  // sunk in the lake (content/smith_heart_layout.ts QUENCH_BLADE_R and
  // QUENCH_BLADE_H) or awake and floating upright (a thinner body: the blade
  // alone, the heaved ice left in the lake); a blade in flight is no wall
  // (`sh_quench_blade_fly`). The shore ice the guardian raises round the
  // lake: one slab per segment of QUENCH_RIMEWALL, along the ring.
  sh_quench_blade_sunk: { hw: 1.6, hd: 1.6, height: 12, round: true, ownLook: true },
  sh_quench_blade_wake: { hw: 1.3, hd: 1.3, height: 12, round: true, ownLook: true },
  sh_quench_blade_float: { hw: 1.3, hd: 1.3, height: 12, round: true, ownLook: true },
  sh_quench_rim: { hw: 4.4, hd: 0.7, height: 3.2, ownLook: true },
};

/** The soul pillars' rows: `sh_council_soul_<role>_<c|r>_<pips>`. */
function soulPillarShapes(): Record<string, CombatWallShape> {
  const out: Record<string, CombatWallShape> = {};
  for (const role of ['guardian', 'slabwright', 'singer'])
    for (const kind of ['c', 'r'])
      for (const pips of [1, 2, 3])
        out[`sh_council_soul_${role}_${kind}_${pips}`] = {
          ...(kind === 'c'
            ? { hw: 2.6, hd: 2.6, height: 13, round: true, ownLook: true }
            : { hw: 2.2, hd: 2.2, height: 10, round: true, ownLook: true }),
          // The Slabwright's soul walks (council_soul.ts stepSlab).
          ...(role === 'slabwright' ? { anchorStep: 0.5 } : {}),
        };
  return out;
}

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
  if (shape.round)
    return { type: 'circle', x: w.x, z: w.z, r: shape.hw * s, cameraTopY: w.y + shape.height * s };
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
  // Indexed as the base plus its walls (only the walls' cells re-file).
  noteAppendedColliders(list, base);
  if (!row) {
    row = new Map();
    composed.set(ox, row);
  }
  row.set(oz, { base, version: state.version, list });
  return list;
}
