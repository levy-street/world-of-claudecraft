// Pure editing model for authored dungeon layouts: an editable draft of the
// five authored lists (rooms, doors, barriers, visual openings, decor) plus
// the boss dais, with hit testing, movement, resizing, and field updates.
// Editor pure core: no DOM, no three.js; only sim layout types.
import type { DungeonLayout, WallStub } from '../../sim/dungeon_layout';
import type { AuthoredDecor, AuthoredDoor, AuthoredRoom } from '../../sim/dungeon_rooms';

export type DungeonBarrier = WallStub & { style?: 'maze' | 'pit' };

export interface DungeonDraft {
  rooms: AuthoredRoom[];
  doors: AuthoredDoor[];
  barriers: DungeonBarrier[];
  visualOpenings: AuthoredDoor[];
  decor: AuthoredDecor[];
  dais: { x: number; z: number; r: number };
}

export type DungeonEntityKind = 'room' | 'door' | 'barrier' | 'opening' | 'decor' | 'dais';

export interface DungeonEntityRef {
  kind: DungeonEntityKind;
  /** List index for list kinds; always 0 for the dais. */
  index: number;
}

const MIN_ROOM_SPAN = 4;
const MIN_SIZE = 0.1;

function cloneRooms(rooms: readonly AuthoredRoom[]): AuthoredRoom[] {
  return rooms.map((room) => ({ ...room }));
}

function cloneDoors(doors: readonly AuthoredDoor[]): AuthoredDoor[] {
  return doors.map((door) => ({ ...door }));
}

function cloneBarriers(barriers: readonly DungeonBarrier[]): DungeonBarrier[] {
  return barriers.map((barrier) => ({ ...barrier }));
}

function cloneDecor(decor: readonly AuthoredDecor[]): AuthoredDecor[] {
  return decor.map((item) => ({ ...item }));
}

export function draftFromLayout(layout: DungeonLayout): DungeonDraft {
  return {
    rooms: cloneRooms(layout.rooms ?? []),
    doors: cloneDoors(layout.doors ?? []),
    barriers: cloneBarriers(layout.barriers ?? []),
    visualOpenings: cloneDoors(layout.visualOpenings ?? []),
    decor: cloneDecor(layout.decor ?? []),
    dais: { ...layout.dais },
  };
}

export function cloneDraft(draft: DungeonDraft): DungeonDraft {
  return {
    rooms: cloneRooms(draft.rooms),
    doors: cloneDoors(draft.doors),
    barriers: cloneBarriers(draft.barriers),
    visualOpenings: cloneDoors(draft.visualOpenings),
    decor: cloneDecor(draft.decor),
    dais: { ...draft.dais },
  };
}

/**
 * Rebuilds a layout from the base's non-editable scalars plus the draft's
 * authored lists, recomputing the derived shell extents from the room
 * bounding box (zMin/zMax, wallX/endWallHw/floorHalfX, side wall slab).
 */
export function draftToLayout(base: DungeonLayout, draft: DungeonDraft): DungeonLayout {
  const out: DungeonLayout = {
    ...base,
    pillars: base.pillars.map((p) => ({ ...p })),
    tombs: base.tombs.map((t) => ({ ...t })),
    stubs: base.stubs.map((s) => ({ ...s })),
    clutter: base.clutter?.map((c) => ({ ...c })),
    rooms: cloneRooms(draft.rooms),
    doors: cloneDoors(draft.doors),
    barriers: cloneBarriers(draft.barriers),
    visualOpenings: cloneDoors(draft.visualOpenings),
    decor: cloneDecor(draft.decor),
    dais: { ...draft.dais },
  };
  if (out.clutter === undefined) delete out.clutter;
  if (draft.rooms.length > 0) {
    let zMin = Number.POSITIVE_INFINITY;
    let zMax = Number.NEGATIVE_INFINITY;
    let halfX = 0;
    for (const room of draft.rooms) {
      zMin = Math.min(zMin, room.z0);
      zMax = Math.max(zMax, room.z1);
      halfX = Math.max(halfX, Math.abs(room.x0), Math.abs(room.x1));
    }
    out.zMin = zMin;
    out.zMax = zMax;
    out.wallX = halfX;
    out.endWallHw = halfX;
    out.floorHalfX = halfX;
    out.sideWallZ = (zMin + zMax) / 2;
    out.sideWallHd = (zMax - zMin) / 2;
  }
  return out;
}

export function snapCoord(v: number, step = 0.5): number {
  const snapped = Math.round(v / step) * step;
  return snapped === 0 ? 0 : snapped;
}

export function entityBounds(
  draft: DungeonDraft,
  ref: DungeonEntityRef,
): { x0: number; x1: number; z0: number; z1: number } {
  switch (ref.kind) {
    case 'room': {
      const room = draft.rooms[ref.index];
      return { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1 };
    }
    case 'door':
    case 'opening':
    case 'barrier': {
      const rect =
        ref.kind === 'door'
          ? draft.doors[ref.index]
          : ref.kind === 'opening'
            ? draft.visualOpenings[ref.index]
            : draft.barriers[ref.index];
      return {
        x0: rect.x - rect.hw,
        x1: rect.x + rect.hw,
        z0: rect.z - rect.hd,
        z1: rect.z + rect.hd,
      };
    }
    case 'decor': {
      const item = draft.decor[ref.index];
      const e = Math.max(item.hw ?? 0, item.hd ?? 0, item.r ?? 0, 1.2 * (item.scale ?? 1));
      return { x0: item.x - e, x1: item.x + e, z0: item.z - e, z1: item.z + e };
    }
    case 'dais': {
      const dais = draft.dais;
      return { x0: dais.x - dais.r, x1: dais.x + dais.r, z0: dais.z - dais.r, z1: dais.z + dais.r };
    }
  }
}

/** All refs whose bounds contain the point, in pick priority order. */
function hitCandidates(draft: DungeonDraft, x: number, z: number): DungeonEntityRef[] {
  const out: DungeonEntityRef[] = [];
  const contains = (ref: DungeonEntityRef): boolean => {
    const b = entityBounds(draft, ref);
    return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  };
  const pushKind = (kind: DungeonEntityKind, count: number): void => {
    for (let index = 0; index < count; index++) {
      const ref = { kind, index };
      if (contains(ref)) out.push(ref);
    }
  };
  pushKind('decor', draft.decor.length);
  pushKind('door', draft.doors.length);
  pushKind('opening', draft.visualOpenings.length);
  pushKind('barrier', draft.barriers.length);
  pushKind('dais', 1);
  const roomHits: Array<{ index: number; area: number }> = [];
  for (let index = 0; index < draft.rooms.length; index++) {
    if (!contains({ kind: 'room', index })) continue;
    const room = draft.rooms[index];
    roomHits.push({ index, area: (room.x1 - room.x0) * (room.z1 - room.z0) });
  }
  roomHits.sort((a, b) => a.area - b.area);
  for (const hit of roomHits) out.push({ kind: 'room', index: hit.index });
  return out;
}

export function pickEntity(draft: DungeonDraft, x: number, z: number): DungeonEntityRef | null {
  return hitCandidates(draft, x, z)[0] ?? null;
}

/**
 * Like pickEntity, but when several entities sit under the point, returns the
 * candidate after `previous` (wrapping), so repeated clicks cycle the stack.
 */
export function pickEntityCycle(
  draft: DungeonDraft,
  x: number,
  z: number,
  previous: DungeonEntityRef | null,
): DungeonEntityRef | null {
  const candidates = hitCandidates(draft, x, z);
  if (candidates.length === 0) return null;
  if (previous) {
    const at = candidates.findIndex(
      (ref) => ref.kind === previous.kind && ref.index === previous.index,
    );
    if (at >= 0) return candidates[(at + 1) % candidates.length];
  }
  return candidates[0];
}

export function moveEntity(
  draft: DungeonDraft,
  ref: DungeonEntityRef,
  dx: number,
  dz: number,
): void {
  switch (ref.kind) {
    case 'room': {
      const room = draft.rooms[ref.index];
      room.x0 += dx;
      room.x1 += dx;
      room.z0 += dz;
      room.z1 += dz;
      return;
    }
    case 'door': {
      const door = draft.doors[ref.index];
      door.x += dx;
      door.z += dz;
      return;
    }
    case 'opening': {
      const opening = draft.visualOpenings[ref.index];
      opening.x += dx;
      opening.z += dz;
      return;
    }
    case 'barrier': {
      const barrier = draft.barriers[ref.index];
      barrier.x += dx;
      barrier.z += dz;
      return;
    }
    case 'decor': {
      const item = draft.decor[ref.index];
      item.x += dx;
      item.z += dz;
      return;
    }
    case 'dais': {
      draft.dais.x += dx;
      draft.dais.z += dz;
      return;
    }
  }
}

export function resizeRoomEdge(
  draft: DungeonDraft,
  index: number,
  edge: 'x0' | 'x1' | 'z0' | 'z1',
  value: number,
): void {
  const room = draft.rooms[index];
  if (edge === 'x0') room.x0 = Math.min(value, room.x1 - MIN_ROOM_SPAN);
  else if (edge === 'x1') room.x1 = Math.max(value, room.x0 + MIN_ROOM_SPAN);
  else if (edge === 'z0') room.z0 = Math.min(value, room.z1 - MIN_ROOM_SPAN);
  else room.z1 = Math.max(value, room.z0 + MIN_ROOM_SPAN);
}

type FieldRecord = Record<string, number | string | undefined>;

function assignNumber(target: FieldRecord, key: string, raw: unknown, min?: number): void {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
  target[key] = min === undefined ? raw : Math.max(min, raw);
}

/** Assigns, clamps to MIN_SIZE, or (when raw is undefined) deletes an optional field. */
function assignOptionalNumber(target: FieldRecord, key: string, raw: unknown, min?: number): void {
  if (raw === undefined) {
    delete target[key];
    return;
  }
  assignNumber(target, key, raw, min);
}

export function updateEntityFields(
  draft: DungeonDraft,
  ref: DungeonEntityRef,
  fields: Record<string, number | string | undefined>,
): void {
  switch (ref.kind) {
    case 'room': {
      const room = draft.rooms[ref.index];
      for (const [key, raw] of Object.entries(fields)) {
        if (key === 'id') {
          if (typeof raw === 'string') room.id = raw;
        } else if (key === 'x0' || key === 'x1' || key === 'z0' || key === 'z1') {
          if (typeof raw === 'number' && Number.isFinite(raw))
            resizeRoomEdge(draft, ref.index, key, raw);
        }
      }
      return;
    }
    case 'door':
    case 'opening':
    case 'barrier': {
      const rect = (ref.kind === 'door'
        ? draft.doors[ref.index]
        : ref.kind === 'opening'
          ? draft.visualOpenings[ref.index]
          : draft.barriers[ref.index]) as unknown as FieldRecord;
      for (const [key, raw] of Object.entries(fields)) {
        if (key === 'x' || key === 'z') assignNumber(rect, key, raw);
        else if (key === 'hw' || key === 'hd') assignNumber(rect, key, raw, MIN_SIZE);
        else if (key === 'style' && ref.kind === 'barrier') {
          if (raw === undefined) delete rect.style;
          else if (raw === 'maze' || raw === 'pit') rect.style = raw;
        }
      }
      return;
    }
    case 'decor': {
      const item = draft.decor[ref.index] as unknown as FieldRecord;
      for (const [key, raw] of Object.entries(fields)) {
        if (key === 'key') {
          if (typeof raw === 'string') item.key = raw;
        } else if (key === 'x' || key === 'z' || key === 'yaw') assignNumber(item, key, raw);
        else if (key === 'y' || key === 'innerScale') assignOptionalNumber(item, key, raw);
        else if (key === 'scale' || key === 'scaleX' || key === 'scaleZ') {
          assignOptionalNumber(item, key, raw, MIN_SIZE);
        } else if (key === 'r' || key === 'hw' || key === 'hd') {
          assignOptionalNumber(item, key, raw, MIN_SIZE);
        }
      }
      return;
    }
    case 'dais': {
      const dais = draft.dais as unknown as FieldRecord;
      for (const [key, raw] of Object.entries(fields)) {
        if (key === 'x' || key === 'z') assignNumber(dais, key, raw);
        else if (key === 'r') assignNumber(dais, key, raw, MIN_SIZE);
      }
      return;
    }
  }
}

function nextRoomId(rooms: readonly AuthoredRoom[]): string {
  const used = new Set(rooms.map((room) => room.id));
  let n = 1;
  while (used.has(`room_${n}`)) n++;
  return `room_${n}`;
}

export function addEntity(
  draft: DungeonDraft,
  kind: Exclude<DungeonEntityKind, 'dais'>,
  at: { x: number; z: number },
): DungeonEntityRef {
  const x = snapCoord(at.x);
  const z = snapCoord(at.z);
  switch (kind) {
    case 'room': {
      draft.rooms.push({ id: nextRoomId(draft.rooms), x0: x - 8, x1: x + 8, z0: z - 8, z1: z + 8 });
      return { kind, index: draft.rooms.length - 1 };
    }
    case 'door': {
      draft.doors.push({ x, z, hw: 3.6, hd: 1 });
      return { kind, index: draft.doors.length - 1 };
    }
    case 'barrier': {
      draft.barriers.push({ x, z, hw: 6, hd: 1, style: 'maze' });
      return { kind, index: draft.barriers.length - 1 };
    }
    case 'opening': {
      draft.visualOpenings.push({ x, z, hw: 1, hd: 6 });
      return { kind, index: draft.visualOpenings.length - 1 };
    }
    case 'decor': {
      draft.decor.push({ key: 'lava_brazier', x, z, yaw: 0, r: 0.9 });
      return { kind, index: draft.decor.length - 1 };
    }
  }
}

export function removeEntity(draft: DungeonDraft, ref: DungeonEntityRef): void {
  switch (ref.kind) {
    case 'room':
      draft.rooms.splice(ref.index, 1);
      return;
    case 'door':
      draft.doors.splice(ref.index, 1);
      return;
    case 'opening':
      draft.visualOpenings.splice(ref.index, 1);
      return;
    case 'barrier':
      draft.barriers.splice(ref.index, 1);
      return;
    case 'decor':
      draft.decor.splice(ref.index, 1);
      return;
    case 'dais':
      // The dais is structural: it can move but never be deleted.
      return;
  }
}
