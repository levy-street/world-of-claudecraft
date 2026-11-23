// Structural validation for a dungeon draft: room bounds and id sanity,
// door-graph reachability from the entrance room, floating doors, decor that
// blocks a door opening, and dressing placed outside the room shell.
// Editor pure core: no DOM, no three.js.
import type { AuthoredDoor, AuthoredRoom } from '../../sim/dungeon_rooms';
import { inAnyRoom } from '../../sim/dungeon_rooms';
import { type DungeonDraft, entityBounds } from './dungeon_draft_core';

export interface DungeonValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

const EPS = 1e-6;
const WALL_HALF_THICKNESS = 1;

function spansOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > EPS;
}

/** True when the door cuts a wall shared by both rooms (same wall line, x/z overlap in both). */
function doorConnects(door: AuthoredDoor, a: AuthoredRoom, b: AuthoredRoom): boolean {
  if (door.hw > door.hd) {
    for (const lineA of [a.z0, a.z1]) {
      for (const lineB of [b.z0, b.z1]) {
        if (Math.abs(lineA - lineB) > EPS) continue;
        if (Math.abs(door.z - lineA) > door.hd + WALL_HALF_THICKNESS + EPS) continue;
        if (
          spansOverlap(a.x0, a.x1, door.x - door.hw, door.x + door.hw) &&
          spansOverlap(b.x0, b.x1, door.x - door.hw, door.x + door.hw)
        ) {
          return true;
        }
      }
    }
  } else if (door.hd > door.hw) {
    for (const lineA of [a.x0, a.x1]) {
      for (const lineB of [b.x0, b.x1]) {
        if (Math.abs(lineA - lineB) > EPS) continue;
        if (Math.abs(door.x - lineA) > door.hw + WALL_HALF_THICKNESS + EPS) continue;
        if (
          spansOverlap(a.z0, a.z1, door.z - door.hd, door.z + door.hd) &&
          spansOverlap(b.z0, b.z1, door.z - door.hd, door.z + door.hd)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** True when the door lies on some wall line of the room and overlaps its span. */
function doorTouchesRoom(door: AuthoredDoor, room: AuthoredRoom): boolean {
  if (door.hw >= door.hd) {
    for (const line of [room.z0, room.z1]) {
      if (
        Math.abs(door.z - line) <= door.hd + WALL_HALF_THICKNESS + EPS &&
        spansOverlap(room.x0, room.x1, door.x - door.hw, door.x + door.hw)
      ) {
        return true;
      }
    }
  }
  if (door.hd >= door.hw) {
    for (const line of [room.x0, room.x1]) {
      if (
        Math.abs(door.x - line) <= door.hw + WALL_HALF_THICKNESS + EPS &&
        spansOverlap(room.z0, room.z1, door.z - door.hd, door.z + door.hd)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function validateDraft(draft: DungeonDraft): DungeonValidationIssue[] {
  const issues: DungeonValidationIssue[] = [];
  const { rooms, doors } = draft;

  const seenIds = new Map<string, number>();
  rooms.forEach((room, i) => {
    if (room.x1 <= room.x0 || room.z1 <= room.z0) {
      issues.push({
        severity: 'error',
        message: `Room '${room.id}' (#${i}) has inverted or empty bounds`,
      });
    }
    if (room.id === '') {
      issues.push({ severity: 'error', message: `Room #${i} has an empty id` });
    } else if (seenIds.has(room.id)) {
      issues.push({
        severity: 'error',
        message: `Duplicate room id '${room.id}' (#${seenIds.get(room.id)} and #${i})`,
      });
    } else {
      seenIds.set(room.id, i);
    }
  });

  if (rooms.length > 0) {
    const reached = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (let other = 0; other < rooms.length; other++) {
        if (reached.has(other)) continue;
        const connected = doors.some((door) => doorConnects(door, rooms[current], rooms[other]));
        if (connected) {
          reached.add(other);
          queue.push(other);
        }
      }
    }
    rooms.forEach((room, i) => {
      if (!reached.has(i)) {
        issues.push({
          severity: 'error',
          message: `Room '${room.id}' (#${i}) is unreachable from room '${rooms[0].id}' through the door graph`,
        });
      }
    });
  }

  doors.forEach((door, j) => {
    if (!rooms.some((room) => doorTouchesRoom(door, room))) {
      issues.push({ severity: 'warning', message: `Door #${j} does not touch any room wall` });
    }
  });

  draft.decor.forEach((item, d) => {
    const hasCollision =
      (item.r !== undefined && item.r > 0) ||
      (item.hw !== undefined && item.hd !== undefined && item.hw > 0 && item.hd > 0);
    if (hasCollision) {
      const bounds = entityBounds(draft, { kind: 'decor', index: d });
      doors.forEach((door, j) => {
        if (
          spansOverlap(bounds.x0, bounds.x1, door.x - door.hw, door.x + door.hw) &&
          spansOverlap(bounds.z0, bounds.z1, door.z - door.hd, door.z + door.hd)
        ) {
          issues.push({
            severity: 'warning',
            message: `Decor #${d} ('${item.key}') collision overlaps door #${j} opening`,
          });
        }
      });
    }
    if (!inAnyRoom(rooms, item.x, item.z)) {
      issues.push({
        severity: 'warning',
        message: `Decor #${d} ('${item.key}') center is outside every room`,
      });
    }
  });

  if (!inAnyRoom(rooms, draft.dais.x, draft.dais.z)) {
    issues.push({ severity: 'warning', message: 'Dais is outside every room' });
  }

  return issues;
}
