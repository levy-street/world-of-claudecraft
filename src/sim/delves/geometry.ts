// Pure delve INTERIOR geometry, collided against identically by every host
// that resolves a delve position: the authoritative server, the offline Sim
// replaying the same code, and the online client's self-motion predictor
// (src/render/client_player_motion.ts / src/render/self_motion.ts). No
// SimContext, no DOM/Three: a plain function of a run-shaped view plus (for
// the door clamp) an explicit solids list, so a Vitest and src/render/ can
// both import it directly (the sanctioned render<-sim pure-geometry
// exception in src/CLAUDE.md). Kept apart from src/sim/delves/runs.ts on
// purpose: that file pulls in SimContext and the whole delve run lifecycle,
// which src/render/ must never import.

import type { DelveRunInfo } from '../../world_api/delves';
import type { RiftFloorView } from '../../world_api/dungeons';
import { delveModuleZOffset as delveModuleZOffsetLayout } from '../data';
import { DELVE_MODULE_LAYOUTS, type DelveModuleId } from '../delve_layout';
import { DUNGEON_WALL_HW, DUNGEON_WALL_X } from '../dungeon_layout';
import type { Entity } from '../types';

// Push-out radii (yards) for solid delve props, kept under the chest/grave interact
// range (DELVE_PLATE_RADIUS + 2 = 4.5) so you can still loot from adjacent. Pressure
// plates and open passages stay walkable (no entry here = radius 0).
export const DELVE_CHEST_SOLID_R = 2.4; // matches the enlarged reliquary chest footprint
export const DELVE_GRAVE_SOLID_R = 1.0;
export const DELVE_WALL_SOLID_R = 3.2; // an intact (undestroyed) destructible wall
// The closed-portcullis aisle box: spans the full walkable width (delve side
// walls at |x|=25, hw=1) so the door cannot be bypassed by skirting the centre
// mesh.
export const DELVE_DOOR_AISLE_HALF_WIDTH = 24;
export const DELVE_DOOR_AISLE_HALF_DEPTH = 1.2;

/** The slice of a DelveRun-shaped object the module-bounds clamp actually
 *  reads. Structural on purpose (never the sim's DelveRun itself): the online
 *  client's mirrored DelveRunInfo (src/world_api/delves.ts) carries the same
 *  three fields with the same shapes, so clampDelveModuleBounds runs
 *  unchanged against either host's run view. */
export interface DelveModuleBoundsRun {
  modules: readonly string[];
  moduleIndex: number;
  origin: { x: number; z: number };
}

export function delveModuleZOffset(
  run: { modules: readonly string[]; moduleIndex: number },
  moduleIndex = run.moduleIndex,
): number {
  return delveModuleZOffsetLayout(run.modules, moduleIndex);
}

// Confine an entity to the active module's interior box. Module-to-module
// travel is teleport-only (advanceDelveModule), so the 16u inter-module gap is
// never meant to be walkable: without this clamp the gap is an unsealed dead
// zone (no side walls) the player can slip into and walk out of the map, and
// it lets a freshly-transitioned player backtrack south into the prior room.
// Bounds come straight from the active module's own layout so they always
// match the room the player is actually standing in.
export function clampDelveModuleBounds(
  run: DelveModuleBoundsRun,
  x: number,
  z: number,
  r: number,
): { x: number; z: number } {
  const moduleId = run.modules[run.moduleIndex] as DelveModuleId;
  const layout = DELVE_MODULE_LAYOUTS[moduleId];
  if (!layout) return { x, z };
  // Irregular Litany rooms are already enclosed by their exact polygon-shell
  // OBBs. Applying the legacy rectangular clamp as well creates invisible
  // walls across every lobe that extends beyond layout.wallX/zMin/zMax.
  if (layout.shellPolygon?.length) return { x, z };
  const wallX = layout.wallX ?? DUNGEON_WALL_X;
  const halfX = wallX - DUNGEON_WALL_HW - r; // inner wall face minus body radius
  const zBase = delveModuleZOffset(run);
  const localX = x - run.origin.x;
  const localZ = z - (run.origin.z + zBase);
  const clampedX = Math.max(-halfX, Math.min(halfX, localX));
  // Front/back end walls are DUNGEON_WALL_HW thick at zMin/zMax; keep the body
  // inside their inner faces.
  const minZ = layout.zMin + DUNGEON_WALL_HW + r;
  const maxZ = layout.zMax - DUNGEON_WALL_HW - r;
  const clampedZ = Math.max(minZ, Math.min(maxZ, localZ));
  return { x: clampedX + run.origin.x, z: clampedZ + run.origin.z + zBase };
}

// The kinds clampDelveDoorSolids treats as solid, each carrying only what the
// clamp math needs (position, plus hp for a destructible wall). A locked door
// with no entry in the list reads exactly like an open one (skipped): the
// server drops a door's entity the instant it opens (runs.ts
// tickDelvePressurePlates), so "present" already means "closed" with no
// separate open flag to carry. Built two ways, by design: the server derives
// it from run.objectIds/objectState (authoritative, runs.ts clampDelveDoors),
// the online client from its mirrored entities
// (delveDoorClampSolidsFromEntities below); both must agree with what the
// server actually collides against.
export type DelveDoorClampKind =
  | 'locked_door'
  | 'reward_chest'
  | 'locked_chest'
  | 'drowned_reliquary'
  | 'cracked_grave'
  | 'destructible_wall';

export interface DelveDoorClampSolid {
  kind: DelveDoorClampKind;
  x: number;
  z: number;
  /** Only consulted for destructible_wall: hp <= 0 stops blocking. */
  hp: number;
}

const DELVE_DOOR_CLAMP_KINDS = new Set<string>([
  'locked_door',
  'reward_chest',
  'locked_chest',
  'drowned_reliquary',
  'cracked_grave',
  'destructible_wall',
]);

export function isDelveDoorClampKind(kind: string): kind is DelveDoorClampKind {
  return DELVE_DOOR_CLAMP_KINDS.has(kind);
}

// Pure geometry: closed portcullis doors block the full walkable aisle,
// solid props (chests, cracked graves, an intact destructible wall) block as
// circles so you cannot walk through them. Pressure plates and open passages
// never appear in `solids` and so stay walkable. No SimContext, no Entity: a
// plain list in, a clamped point out, so both hosts (and a Vitest) can call it
// directly against whatever solids list they built.
export function clampDelveDoorSolids(
  solids: readonly DelveDoorClampSolid[],
  x: number,
  z: number,
  r: number,
): { x: number; z: number } {
  for (const solid of solids) {
    if (solid.kind === 'locked_door') {
      const dx = x - solid.x,
        dz = z - solid.z;
      const ox = Math.abs(dx) - DELVE_DOOR_AISLE_HALF_WIDTH - r;
      const oz = Math.abs(dz) - DELVE_DOOR_AISLE_HALF_DEPTH - r;
      if (ox < 0 && oz < 0) {
        if (ox > oz) x = solid.x + Math.sign(dx || 1) * (DELVE_DOOR_AISLE_HALF_WIDTH + r);
        else z = solid.z + Math.sign(dz || 1) * (DELVE_DOOR_AISLE_HALF_DEPTH + r);
      }
      continue;
    }
    let solidR = 0;
    if (
      solid.kind === 'reward_chest' ||
      solid.kind === 'locked_chest' ||
      solid.kind === 'drowned_reliquary'
    )
      solidR = DELVE_CHEST_SOLID_R;
    else if (solid.kind === 'cracked_grave') solidR = DELVE_GRAVE_SOLID_R;
    else if (solid.kind === 'destructible_wall') solidR = solid.hp > 0 ? DELVE_WALL_SOLID_R : 0;
    if (solidR <= 0) continue;
    const dx = x - solid.x,
      dz = z - solid.z;
    const dist = Math.hypot(dx, dz);
    const min = solidR + r;
    if (dist < min) {
      if (dist > 1e-6) {
        x = solid.x + (dx / dist) * min;
        z = solid.z + (dz / dist) * min;
      } else x = solid.x + min;
    }
  }
  return { x, z };
}

// The online client's half of the shared list: scan the mirrored entity
// roster for delve objects (templateId `delve_<kind>`, minted only by
// runs.ts createDelveObject) and keep only the solid kinds. An opened door's
// entity is already gone from the roster (dropped server-side the same tick
// it opens), so presence alone means closed; a triggered pressure plate's
// `delve_pressure_plate_triggered` templateId does not match any solid kind
// and is skipped like every other non-solid prop. Pure: no SimContext, no
// IWorld, just the mirrored Entity fields the wire already carries.
export function delveDoorClampSolidsFromEntities(
  entities: Iterable<Pick<Entity, 'templateId' | 'pos' | 'hp'>>,
): DelveDoorClampSolid[] {
  const out: DelveDoorClampSolid[] = [];
  for (const e of entities) {
    if (!e.templateId.startsWith('delve_')) continue;
    const kind = e.templateId.slice('delve_'.length);
    if (!isDelveDoorClampKind(kind)) continue;
    out.push({ kind, x: e.pos.x, z: e.pos.z, hp: e.hp });
  }
  return out;
}

const EMPTY_DELVE_SOLIDS: readonly DelveDoorClampSolid[] = [];

/** This frame's delve run + door/prop solids for the self-motion predictors
 *  (both wire versions; src/main.ts is the src/net-to-src/render/src/game
 *  junction that calls this). A pure sim leaf (never DOM/SimContext) so both
 *  render/ and game/ can import it without crossing each other's boundary. */
export interface DelveMotionState {
  delveRun: DelveRunInfo | null;
  delveSolids: readonly DelveDoorClampSolid[];
}

export function delveMotionState(net: {
  delveRun: DelveRunInfo | null;
  entities: ReadonlyMap<number, Pick<Entity, 'templateId' | 'pos' | 'hp'>>;
}): DelveMotionState {
  const delveRun = net.delveRun;
  const delveSolids = delveRun
    ? delveDoorClampSolidsFromEntities(net.entities.values())
    : EMPTY_DELVE_SOLIDS;
  return { delveRun, delveSolids };
}

/** Bundles the rift-floor descriptor in beside the delve state above for
 *  SelfMotionFrameBuffer.write()'s one trailing arg (src/game/self_motion_frame_buffer.ts
 *  InstancedMotionState, matched structurally, not imported: that module lives
 *  in src/game/, which src/sim/ never imports). A function call, not an
 *  object-literal expression, so src/main.ts's animation-frame hot path stays
 *  clean of direct allocation syntax (tests/client_frame_allocations.test.ts). */
export function instancedMotionState(
  riftFloor: RiftFloorView | null,
  delve: DelveMotionState,
): DelveMotionState & { riftFloor: RiftFloorView | null } {
  return { riftFloor, delveRun: delve.delveRun, delveSolids: delve.delveSolids };
}
