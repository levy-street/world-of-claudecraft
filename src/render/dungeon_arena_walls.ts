// The hideable-wall accumulator for dungeon shells. Every standard-layout
// interior routes its outer walls through the (formerly arena-only) hideable
// path, so each wall face collects its module placements separately and
// carries the plan footprint the per-frame sightline fade tests against
// (arena_wall_occlusion_core.ts). Moved verbatim out of dungeon.ts; the emit
// side (InstancedMesh construction + material policy) stays with
// DungeonInteriors.
import * as THREE from 'three';
import { polygonWallSegments } from '../sim/delve_litany_layout';
import {
  DUNGEON_END_WALL_HW,
  DUNGEON_WALL_HEIGHT,
  DUNGEON_WALL_HW,
  DUNGEON_WALL_X,
  type DungeonLayout,
} from '../sim/dungeon_layout';
import type { ArenaWallFootprint } from './arena_wall_occlusion_core';
import type { DungeonInteriorVariant } from './dungeon';
import { type WallCullPlane, wallSegmentOutward } from './wall_backface_cull_core';

/** Accumulates instance transforms per module kind, then emits InstancedMeshes. */
export class Placements {
  readonly byKind = new Map<string, THREE.Matrix4[]>();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  add(
    kind: string,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    scale: number | [number, number, number] = 1,
  ): void {
    const m = new THREE.Matrix4();
    this.pos.set(x, y, z);
    this.quat.setFromEuler(this.euler.set(0, rotY, 0));
    if (typeof scale === 'number') this.scl.set(scale, scale, scale);
    else this.scl.set(scale[0], scale[1], scale[2]);
    m.compose(this.pos, this.quat, this.scl);
    const list = this.byKind.get(kind);
    if (list) list.push(m);
    else this.byKind.set(kind, [m]);
  }
}

export interface PendingArenaWall {
  placements: Placements;
  footprint: ArenaWallFootprint;
  /** Ignivar raid shells only: the face's cull plane, so the wall hides
   *  outright whenever the camera is on its outside (backface cull) instead
   *  of ghosting one crossed segment to 20%. */
  backface?: WallCullPlane;
}

export interface PendingArenaWalls {
  left: PendingArenaWall;
  right: PendingArenaWall;
  front: PendingArenaWall;
  back: PendingArenaWall;
  all: PendingArenaWall[];
}

export function pendingArenaWallsFor(
  layout: DungeonLayout,
  ox: number,
  oz: number,
  variant?: DungeonInteriorVariant,
): PendingArenaWalls {
  // the Ignivar rooms stack a second wall course, so the hide/fade footprint
  // reaches the true top
  const topY = variant === 'ignivar' ? DUNGEON_WALL_HEIGHT * 2 : DUNGEON_WALL_HEIGHT;
  const wallX = layout.wallX ?? DUNGEON_WALL_X;
  const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
  const wall = (footprint: ArenaWallFootprint): PendingArenaWall => ({
    placements: new Placements(),
    footprint,
  });
  const left = wall({
    x: ox - wallX,
    z: oz + layout.sideWallZ,
    hw: DUNGEON_WALL_HW,
    hd: layout.sideWallHd,
    topY,
  });
  const right = wall({
    x: ox + wallX,
    z: oz + layout.sideWallZ,
    hw: DUNGEON_WALL_HW,
    hd: layout.sideWallHd,
    topY,
  });
  const front = wall({ x: ox, z: oz + layout.zMin, hw: endWallHw, hd: DUNGEON_WALL_HW, topY });
  const back = wall({ x: ox, z: oz + layout.zMax, hw: endWallHw, hd: DUNGEON_WALL_HW, topY });
  if (layout.shellPolygon) {
    const pole = layout.shellPole;
    const polygon = polygonWallSegments(layout.shellPolygon).map((segment) => {
      const pending = wall({
        x: ox + segment.x,
        z: oz + segment.z,
        hw: segment.halfLength,
        hd: DUNGEON_WALL_HW,
        topY,
        ry: segment.rot,
      });
      // The Ignivar raid rooms are convex shells with a chase camera that has
      // no collision pull-in: their walls carry a backface-cull plane so a
      // camera pushed outside a face hides the whole face, not a ray-thin
      // ghost peephole in one segment.
      if (variant === 'ignivar' && pole) {
        const outward = wallSegmentOutward(segment.x, segment.z, segment.rot, pole.x, pole.z);
        pending.backface = {
          x: ox + segment.x,
          z: oz + segment.z,
          nx: outward.nx,
          nz: outward.nz,
        };
      }
      return pending;
    });
    return { left, right, front, back, all: polygon };
  }
  return {
    left,
    right,
    front,
    back,
    all: [left, right, front, back],
  };
}
