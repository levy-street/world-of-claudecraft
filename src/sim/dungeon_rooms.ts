import type { Collider } from './colliders';

export interface AuthoredRoom {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A rectangular opening cut out of every authored wall it intersects. */
export interface AuthoredDoor {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface AuthoredDecor {
  key: string;
  x: number;
  /** Optional render-only vertical offset. */
  y?: number;
  z: number;
  yaw: number;
  scale?: number;
  scaleX?: number;
  scaleZ?: number;
  /** Inner-to-outer radius ratio for ring-shaped dressing. */
  innerScale?: number;
  /** Optional movement collision radius. Omit for walkable or hazard dressing. */
  r?: number;
  /** Optional axis-aligned movement footprint for structural dressing. */
  hw?: number;
  hd?: number;
}

export interface AuthoredWallSegment {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

const EPSILON = 1e-6;

function subtractIntervals(
  from: number,
  to: number,
  cuts: ReadonlyArray<readonly [number, number]>,
): Array<readonly [number, number]> {
  const ordered = cuts
    .map(([a, b]) => [Math.max(from, a), Math.min(to, b)] as const)
    .filter(([a, b]) => b - a > EPSILON)
    .sort(([a], [b]) => a - b);
  const result: Array<readonly [number, number]> = [];
  let cursor = from;
  for (const [a, b] of ordered) {
    if (a > cursor + EPSILON) result.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < to - EPSILON) result.push([cursor, to]);
  return result;
}

/**
 * Builds deterministic wall slabs from axis-aligned rooms. A wide, shallow
 * door cuts horizontal walls and a narrow, deep door cuts vertical walls.
 */
export function authoredWallSegments(
  rooms: readonly AuthoredRoom[],
  doors: readonly AuthoredDoor[],
  wallHalfThickness = 1,
): AuthoredWallSegment[] {
  const horizontal = new Map<number, Array<readonly [number, number]>>();
  const vertical = new Map<number, Array<readonly [number, number]>>();
  const addInterval = (
    groups: Map<number, Array<readonly [number, number]>>,
    line: number,
    interval: readonly [number, number],
  ): void => {
    const group = groups.get(line);
    if (group) group.push(interval);
    else groups.set(line, [interval]);
  };

  for (const room of rooms) {
    if (room.x1 <= room.x0 || room.z1 <= room.z0) {
      throw new Error(`Authored dungeon room ${room.id} has invalid bounds`);
    }
    for (const z of [room.z0, room.z1]) {
      const cuts = doors
        .filter(
          (door) =>
            door.hw > door.hd && Math.abs(door.z - z) <= door.hd + wallHalfThickness + EPSILON,
        )
        .map((door) => [door.x - door.hw, door.x + door.hw] as const);
      for (const [x0, x1] of subtractIntervals(room.x0, room.x1, cuts)) {
        addInterval(horizontal, z, [x0, x1]);
      }
    }
    for (const x of [room.x0, room.x1]) {
      const cuts = doors
        .filter(
          (door) =>
            door.hd > door.hw && Math.abs(door.x - x) <= door.hw + wallHalfThickness + EPSILON,
        )
        .map((door) => [door.z - door.hd, door.z + door.hd] as const);
      for (const [z0, z1] of subtractIntervals(room.z0, room.z1, cuts)) {
        addInterval(vertical, x, [z0, z1]);
      }
    }
  }
  const walls: AuthoredWallSegment[] = [];
  for (const [z, intervals] of [...horizontal].sort(([a], [b]) => a - b)) {
    const covered = intervals
      .sort(([a], [b]) => a - b)
      .reduce<Array<readonly [number, number]>>((merged, interval) => {
        const last = merged.at(-1);
        if (last && interval[0] <= last[1] + EPSILON) {
          merged[merged.length - 1] = [last[0], Math.max(last[1], interval[1])];
        } else merged.push(interval);
        return merged;
      }, []);
    for (const [x0, x1] of covered) {
      walls.push({ x: (x0 + x1) / 2, z, hw: (x1 - x0) / 2, hd: wallHalfThickness });
    }
  }
  for (const [x, intervals] of [...vertical].sort(([a], [b]) => a - b)) {
    const covered = intervals
      .sort(([a], [b]) => a - b)
      .reduce<Array<readonly [number, number]>>((merged, interval) => {
        const last = merged.at(-1);
        if (last && interval[0] <= last[1] + EPSILON) {
          merged[merged.length - 1] = [last[0], Math.max(last[1], interval[1])];
        } else merged.push(interval);
        return merged;
      }, []);
    for (const [z0, z1] of covered) {
      walls.push({ x, z: (z0 + z1) / 2, hw: wallHalfThickness, hd: (z1 - z0) / 2 });
    }
  }
  return walls;
}

export function inAnyRoom(
  rooms: readonly AuthoredRoom[],
  x: number,
  z: number,
  inset = 0,
): boolean {
  return rooms.some(
    (room) =>
      x >= room.x0 + inset && x <= room.x1 - inset && z >= room.z0 + inset && z <= room.z1 - inset,
  );
}

export function authoredDecorColliders(decor: readonly AuthoredDecor[]): Collider[] {
  const colliders: Collider[] = [];
  for (const item of decor) {
    if (item.hw !== undefined && item.hd !== undefined && item.hw > 0 && item.hd > 0) {
      colliders.push({
        type: 'obb',
        x: item.x,
        z: item.z,
        hw: item.hw,
        hd: item.hd,
        rot: item.yaw,
      });
    } else if (item.r !== undefined && item.r > 0) {
      colliders.push({ type: 'circle', x: item.x, z: item.z, r: item.r });
    }
  }
  return colliders;
}
