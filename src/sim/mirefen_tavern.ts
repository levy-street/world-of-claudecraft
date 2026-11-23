// The Mirefen tavern (content/mirefen_tavern.ts): its colliders, its rest area and its
// innkeeper. The floor is mirefen_tavern_floor.ts (folded into groundHeight), so this
// module only adds what stands on it:
//  - the walls, minus the front doorway and the arch onto the tower's nook: full height to
//    movement (a jump never clears one), topped at the eaves for sight. The kitchen's
//    serving hatch is no way through: the back wall's collider runs on over it. The round
//    tower's wall is a ring of short boxes;
//  - the porch parapets, which block a body whose feet are under their tops;
//  - the furniture (standable, the harbor house idiom) and what stands in the room at full
//    height (the hearth, the wall fireplace, the barrel racks and the bar's pillar);
//  - the grounds outside (mirefen_tavern_grounds.ts): the stable's walls, partition and front
//    posts at full height, and the pieces on the terrain (the terrace's tables and benches, the
//    trough, the hay, the cart, the woodpile, the casks and crates, standable; the lantern
//    posts and the dog, not) through the same furniture colliders, each on its `baseY`.
// There is no upper floor: every change of height in the floor surface is a ramp.
//
// The rest area reuses the inn rule (progression/xp.ts isResting): standing anywhere inside,
// out of combat, accrues rested experience like any inn.
//
// Deterministic and rng-free. The colliders join the static grid with the other built
// structures (built_structure_colliders.ts, built-in world only); the innkeeper is spawned
// at world init under her reserved id (spawnTavernKeeper, through built_world_keepers.ts),
// so the sequential id stream every other entity takes is untouched.

import type { Collider } from './colliders';
import {
  TAVERN_ARCH,
  TAVERN_BAR_PLATFORM,
  TAVERN_DOOR,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_KEEPER_ENTITY_ID,
  TAVERN_KEEPER_NPC_ID,
  TAVERN_ORIGIN,
  TAVERN_PIT,
  TAVERN_PORCH,
  TAVERN_PROPS,
  TAVERN_REST_SINK,
  TAVERN_STAGE,
  TAVERN_TOWER,
  TAVERN_WING,
  TAVERN_YAW,
  type TavernLevel,
  type TavernProp,
  tavernToWorld,
} from './content/mirefen_tavern';
import { TAVERN_STABLE } from './content/mirefen_tavern_grounds';
import { createNpc } from './entity';
import { tavernStablePosts, tavernStableWalls } from './mirefen_tavern_grounds';
import type { SimContext } from './sim_context';
import type { WorldContent } from './types';

const DEG = Math.PI / 180;

/** A wall or rail box in the local frame: [x0, x1, z0, z1]. */
export type TavernBox = readonly [number, number, number, number];

/** The floor a level stands on, over the ground floor. */
export function tavernLevelY(level: TavernLevel): number {
  if (level === 'pit') return -TAVERN_PIT.depth;
  if (level === 'stage') return TAVERN_STAGE.lift;
  return level === 'platform' ? TAVERN_BAR_PLATFORM.lift : 0;
}

/** The hall's wall boxes, minus the front doorway and the arch onto the tower (the back
 *  wall runs on over the kitchen's serving hatch). */
export function tavernHallWalls(): TavernBox[] {
  const h = TAVERN_HALL;
  const t = h.wall;
  const d0 = TAVERN_DOOR.x - TAVERN_DOOR.width / 2;
  const d1 = TAVERN_DOOR.x + TAVERN_DOOR.width / 2;
  return [
    [h.x0, d0, h.z1 - t, h.z1],
    [d1, h.x1, h.z1 - t, h.z1],
    [h.x0, TAVERN_ARCH.x0, h.z0, h.z0 + t],
    [TAVERN_ARCH.x1, h.x1, h.z0, h.z0 + t],
    [h.x0, h.x0 + t, h.z0, h.z1],
    [h.x1 - t, h.x1, h.z0, h.z1],
  ];
}

/** The wing's wall boxes (its north side is the hall's back wall). Its west wall stops at
 *  the tower's outside face on either side, where the model's wall stops: between the two
 *  runs the tower's ring is the wall, and no run stands inside the tower's nook. */
export function tavernWingWalls(): TavernBox[] {
  const w = TAVERN_WING;
  const t = w.wall;
  const tw = TAVERN_TOWER;
  // (measured on the wall's inner face, so no slit opens between a run and the ring)
  const half = Math.sqrt(tw.rOut * tw.rOut - (w.x0 + t - tw.x) ** 2);
  return [
    [w.x1 - t, w.x1, w.z0, w.z1],
    [w.x0, w.x1, w.z0, w.z0 + t],
    [w.x0, w.x0 + t, w.z0, tw.z - half],
    [w.x0, w.x0 + t, tw.z + half, w.z1],
  ];
}

/** The tower wall's angular run (radians, atan2(dx, dz)): everything but the arch onto the
 *  hall. */
export const TAVERN_TOWER_WALL_RUNS: readonly (readonly [number, number])[] = [
  [48 * DEG, 312 * DEG],
];

/** One segment of the tower's wall ring: a box across the wall's thickness. */
export interface TavernRingSegment {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** Local yaw: the box's local z runs out along the radius. */
  rot: number;
}

export function tavernTowerWallSegments(): TavernRingSegment[] {
  const t = TAVERN_TOWER;
  const mid = (t.rIn + t.rOut) / 2;
  const out: TavernRingSegment[] = [];
  for (const [a0, a1] of TAVERN_TOWER_WALL_RUNS) {
    const n = Math.max(1, Math.ceil((a1 - a0) / (10 * DEG)));
    const step = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const a = a0 + step * (i + 0.5);
      out.push({
        x: t.x + Math.sin(a) * mid,
        z: t.z + Math.cos(a) * mid,
        // the outer face's half chord, and a hand's overlap so no slit opens between boxes
        hw: t.rOut * Math.sin(step / 2) + 0.05,
        hd: (t.rOut - t.rIn) / 2,
        rot: a,
      });
    }
  }
  return out;
}

/** A local box, turned into the world. */
function worldObb(
  x: number,
  z: number,
  hw: number,
  hd: number,
  rot: number,
  extra: Partial<Collider>,
): Collider {
  const w = tavernToWorld(x, z);
  return { type: 'obb', x: w.x, z: w.z, hw, hd, rot: rot + TAVERN_YAW, ...extra } as Collider;
}

function boxCollider(b: TavernBox, extra: Partial<Collider>): Collider {
  return worldObb(
    (b[0] + b[1]) / 2,
    (b[2] + b[3]) / 2,
    (b[1] - b[0]) / 2,
    (b[3] - b[2]) / 2,
    0,
    extra,
  );
}

/** The floor a furnishing stands on, over the ground floor: its level's, or the terrain's
 *  under it for a piece outside (`baseY`). */
export function tavernPropBaseY(prop: TavernProp): number {
  return prop.baseY ?? tavernLevelY(prop.level);
}

/** One furnishing's collider, seated on its floor. */
export function tavernPropCollider(prop: TavernProp): Collider {
  const top = TAVERN_FLOOR_Y + tavernPropBaseY(prop) + prop.height;
  const move = prop.standable ? { moveTopY: top, standable: true as const } : {};
  if (prop.r !== undefined) {
    const w = tavernToWorld(prop.x, prop.z);
    return { type: 'circle', x: w.x, z: w.z, r: prop.r, cameraTopY: top, ...move };
  }
  return worldObb(prop.x, prop.z, prop.hw ?? 0.5, prop.hd ?? 0.5, prop.rot, {
    cameraTopY: top,
    ...move,
  });
}

/** Every collider of the tavern: the walls, the tower ring, the porch parapets, the stable,
 *  then the furnishings inside and out. (seed kept for the collider-set signature: the floor is absolute, so
 *  nothing here reads the ground.) */
export function mirefenTavernColliders(_seed: number): Collider[] {
  const f = TAVERN_FLOOR_Y;
  const out: Collider[] = [];
  for (const b of tavernHallWalls()) out.push(boxCollider(b, { cameraTopY: f + TAVERN_HALL.eave }));
  for (const b of tavernWingWalls()) out.push(boxCollider(b, { cameraTopY: f + TAVERN_WING.eave }));
  for (const s of tavernTowerWallSegments()) {
    out.push(worldObb(s.x, s.z, s.hw, s.hd, s.rot, { cameraTopY: f + TAVERN_TOWER.wallTop }));
  }
  const p = TAVERN_PORCH;
  for (const x of [p.x0, p.x1]) {
    out.push(
      boxCollider([x - 0.2, x + 0.2, p.z0, p.z1], {
        moveTopY: f + p.parapet,
        cameraTopY: f + p.parapet,
      }),
    );
  }
  // the stable on the grounds: its walls and partition, then its front posts, full height
  const st = f + TAVERN_STABLE.baseY;
  for (const b of tavernStableWalls()) {
    out.push(boxCollider(b, { cameraTopY: st + TAVERN_STABLE.eave }));
  }
  for (const p of tavernStablePosts()) {
    const w = tavernToWorld(p.x, p.z);
    out.push({ type: 'circle', x: w.x, z: w.z, r: p.r, cameraTopY: st + TAVERN_STABLE.eave });
  }
  for (const prop of TAVERN_PROPS) out.push(tavernPropCollider(prop));
  return out;
}

/** Whether a local point stands inside the tavern (the hall, the arch and the tower's
 *  nook): the rest area's plan. */
export function tavernInsideLocal(lx: number, lz: number): boolean {
  const h = TAVERN_HALL;
  if (lx > h.x0 + h.wall && lx < h.x1 - h.wall && lz > h.z0 && lz < h.z1 - h.wall) return true;
  const t = TAVERN_TOWER;
  return Math.hypot(lx - t.x, lz - t.z) < t.rIn;
}

/** Whether a body at world (x, y, z) stands in the tavern's rest area: inside it, its feet
 *  between the ground floor (a hand under the hearth pit) and the roof. */
export function tavernRestsAt(x: number, y: number, z: number): boolean {
  if (!tavernInsideLocal(TAVERN_ORIGIN.z - z, x - TAVERN_ORIGIN.x)) return false;
  return y >= TAVERN_FLOOR_Y - TAVERN_REST_SINK && y <= TAVERN_FLOOR_Y + TAVERN_HALL.ridge;
}

/** Spawn the innkeeper behind the bar, under her reserved id, when the world carries her
 *  (the built-in world). Idempotent; draws no rng. */
export function spawnTavernKeeper(ctx: SimContext, world: WorldContent): void {
  const def = world.npcs[TAVERN_KEEPER_NPC_ID];
  if (!def?.dynamic) return;
  if (ctx.entities.has(TAVERN_KEEPER_ENTITY_ID)) return;
  // on the bar platform's floor, read from the tavern itself rather than the walk surface, so
  // she stands at the same height whichever world is active (the floor fold is built-in only)
  const y = TAVERN_FLOOR_Y + TAVERN_BAR_PLATFORM.lift;
  ctx.addEntity(createNpc(TAVERN_KEEPER_ENTITY_ID, def, { x: def.pos.x, y, z: def.pos.z }));
}
