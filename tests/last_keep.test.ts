// The Last Keep: a zero-combat authored room-graph castle interior, laid out
// as THREE STORIES (undercroft / state floor / residence) of adjacent room
// groups at three lift bands joined by stair rooms.
// Pins the structural contracts the layout must keep: every room is reachable
// from the entrance hall through real doorways, every door straddles exactly
// two rooms on a shared wall line (with the opening inside both rooms' shared
// span), the dungeon entry and exit both land inside the entrance hall, decor
// uses only keys the authored decor renderer handles and never sits on a stair
// ramp, the layout yields a real collision set, and the renderer's furnishing
// plan (src/render/lastkeep_dressing.ts) honors the doorway-lane and decor
// clearance contract.
import { describe, expect, it } from 'vitest';
import { type KeepDressingSpot, lastKeepFurnishings } from '../src/render/lastkeep_dressing';
import { DUNGEON_LIST, DUNGEON_X_THRESHOLD, DUNGEONS, dungeonAt } from '../src/sim/data';
import {
  type AuthoredDoor,
  type AuthoredRoom,
  LASTKEEP_DECOR,
  LASTKEEP_DOORS,
  LASTKEEP_LAYOUT,
  LASTKEEP_ROOMS,
  lastKeepLiftAt,
  layoutColliders,
} from '../src/sim/dungeon_layout';
import { enterDungeon, leaveDungeon } from '../src/sim/instances/dungeons';
import { authoredLiftAt, roomAt } from '../src/sim/rift/authored';
import { Sim } from '../src/sim/sim';

// The decor keys the authored render path supports (src/render/rift_decor.ts:
// DECOR_MODELS plus the procedural 'pentagram' and 'rug'). A key outside this
// set renders as NOTHING (the builder skips unknown keys), so a typo here
// would silently ship an unfurnished room.
const SUPPORTED_DECOR_KEYS = new Set([
  'infernal_brazier',
  'infernal_altar',
  'demon_idol',
  'hell_forge',
  'hanging_cage',
  'bone_pile',
  'obsidian_fang',
  'infernal_statue',
  'slag_cauldron',
  'bone_throne',
  'pentagram',
  'rug',
]);

// The exact room-recovery rule authoredLiftAt/placeAuthoredRelief use: a door
// joins the two rooms whose shared wall line it sits on.
function doorRooms(
  rooms: readonly AuthoredRoom[],
  d: AuthoredDoor,
): [AuthoredRoom, AuthoredRoom] | null {
  const south = rooms.find((r) => r.z1 === d.z && d.x >= r.x0 && d.x <= r.x1);
  const north = rooms.find((r) => r.z0 === d.z && d.x >= r.x0 && d.x <= r.x1);
  if (south && north) return [south, north];
  const west = rooms.find((r) => r.x1 === d.x && d.z >= r.z0 && d.z <= r.z1);
  const east = rooms.find((r) => r.x0 === d.x && d.z >= r.z0 && d.z <= r.z1);
  if (west && east) return [west, east];
  return null;
}

describe('The Last Keep layout', () => {
  const rooms = LASTKEEP_ROOMS;
  const doors = LASTKEEP_DOORS;
  const def = DUNGEONS.the_last_keep;

  it('registers the dungeon def: zero combat, unique index, authored interior', () => {
    expect(def).toBeDefined();
    expect(def.spawns).toEqual([]);
    // zero combat, but not zero encounters: the entrance hall keepsake is
    // the instance's one placed object (the placement sweep in fixes.test.ts
    // requires every dungeon to place at least one encounter)
    expect(def.objects?.map((o) => o.itemId)).toEqual(['last_keep_signet']);
    expect(def.interior).toBe('lastkeep');
    expect(def.suggestedPlayers).toBe(1);
    // index unique across the merged registry
    const withIndex = DUNGEON_LIST.filter((d) => d.index === def.index);
    expect(withIndex).toEqual([def]);
    // door position unique (two doors at one point is the map-portal overlap bug)
    const doorKey = `${def.doorPos.x},${def.doorPos.z}`;
    const sameDoor = DUNGEON_LIST.filter((d) => `${d.doorPos.x},${d.doorPos.z}` === doorKey);
    expect(sameDoor).toEqual([def]);
  });

  it('every door straddles exactly two rooms, with the opening inside their shared span', () => {
    for (const d of doors) {
      const pair = doorRooms(rooms, d);
      expect(pair, `door at (${d.x},${d.z}) does not straddle two rooms`).not.toBeNull();
      const [a, b] = pair as [AuthoredRoom, AuthoredRoom];
      expect(a.id).not.toBe(b.id);
      if (a.z1 === d.z || a.z0 === d.z) {
        // constant-z wall: the opening runs along x and must fit inside both rooms
        const lo = Math.max(a.x0, b.x0);
        const hi = Math.min(a.x1, b.x1);
        expect(d.x - d.hw, `door (${d.x},${d.z}) opening exits ${a.id}/${b.id}`).toBeGreaterThan(
          lo,
        );
        expect(d.x + d.hw, `door (${d.x},${d.z}) opening exits ${a.id}/${b.id}`).toBeLessThan(hi);
      } else {
        const lo = Math.max(a.z0, b.z0);
        const hi = Math.min(a.z1, b.z1);
        expect(d.z - d.hd, `door (${d.x},${d.z}) opening exits ${a.id}/${b.id}`).toBeGreaterThan(
          lo,
        );
        expect(d.z + d.hd, `door (${d.x},${d.z}) opening exits ${a.id}/${b.id}`).toBeLessThan(hi);
      }
    }
  });

  it('every room is reachable from the entrance hall through doors', () => {
    const entryRoom = roomAt(rooms, def.entry.x, def.entry.z);
    expect(entryRoom?.id).toBe('hall_entrance');
    const adjacency = new Map<string, string[]>();
    for (const d of doors) {
      const pair = doorRooms(rooms, d);
      if (!pair) continue;
      const [a, b] = pair;
      adjacency.set(a.id, [...(adjacency.get(a.id) ?? []), b.id]);
      adjacency.set(b.id, [...(adjacency.get(b.id) ?? []), a.id]);
    }
    const seen = new Set<string>([(entryRoom as AuthoredRoom).id]);
    const queue = [(entryRoom as AuthoredRoom).id];
    while (queue.length > 0) {
      const cur = queue.pop() as string;
      for (const next of adjacency.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const unreachable = rooms.filter((r) => !seen.has(r.id)).map((r) => r.id);
    expect(unreachable).toEqual([]);
  });

  it('rooms never overlap', () => {
    for (const a of rooms) {
      for (const b of rooms) {
        if (a.id >= b.id) continue;
        const overlap = a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('entry and exit both sit in the entrance hall, outside the exit door trigger', () => {
    expect(roomAt(rooms, def.entry.x, def.entry.z)?.id).toBe('hall_entrance');
    expect(roomAt(rooms, def.exitOffset.x, def.exitOffset.z)?.id).toBe('hall_entrance');
    const gap = Math.hypot(def.entry.x - def.exitOffset.x, def.entry.z - def.exitOffset.z);
    expect(gap).toBeGreaterThan(2); // DOOR_TRIGGER_RADIUS: arrival must not re-trigger the exit
  });

  it('reads as three stories: undercroft 0, state floor 3, residence 6, tower above', () => {
    const lift = (id: string): number => rooms.find((r) => r.id === id)?.lift ?? 0;
    const lowest = Math.min(...rooms.map((r) => r.lift ?? 0));
    // Negative lifts are unsupported by the render relief path, so the
    // undercroft sits at exactly 0 and everything else is raised above it.
    expect(lowest).toBe(0);
    // STORY 0, the undercroft: the only dungeon-flavored story.
    for (const id of ['gaol', 'cell_north', 'cell_mid', 'cell_south', 'storeroom', 'wine_cellar']) {
      expect(lift(id), id).toBe(0);
    }
    // STORY 1, the state floor, with the throne dais +1.2 above it.
    for (const id of [
      'hall_entrance',
      'guard_room',
      'armory',
      'great_hall',
      'throne_room',
      'ballroom',
      'kitchen',
      'pantry',
      'steward_office',
      'dining_parlor',
      'council',
      'treasury',
    ]) {
      expect(lift(id), id).toBeCloseTo(3.0, 5);
    }
    expect(lift('throne_dais') - lift('throne_room')).toBeCloseTo(1.2, 5);
    // STORY 2, the residence floor, reached over two half landings.
    for (const id of [
      'gallery',
      'royal_chamber',
      'guest_west',
      'guest_mid',
      'guest_east',
      'servants_quarters',
      'solar',
      'chapel',
      'library',
    ]) {
      expect(lift(id), id).toBeCloseTo(6.0, 5);
    }
    expect(lift('gaol_stair')).toBeCloseTo(1.5, 5);
    expect(lift('stair_grand')).toBeCloseTo(4.5, 5);
    expect(lift('stair_servants')).toBeCloseTo(4.5, 5);
    // The watch tower continues above the residence to the lookout.
    expect(lift('tower_mid')).toBeCloseTo(7.5, 5);
    expect(lift('tower_lookout')).toBeCloseTo(9.0, 5);
    // Every lift change across a door is a climbable half landing (max 1.5
    // per step: slope 0.25 over the 6yd ramp band, far under the 1.5 gate).
    for (const d of doors) {
      const pair = doorRooms(rooms, d) as [AuthoredRoom, AuthoredRoom];
      const step = Math.abs((pair[0].lift ?? 0) - (pair[1].lift ?? 0));
      expect(step, `door (${d.x},${d.z}) lift step`).toBeLessThanOrEqual(1.5 + 1e-9);
    }
    // lastKeepLiftAt (the groundHeight arm's source) agrees with the room data
    expect(lastKeepLiftAt(def.entry.x, def.entry.z)).toBeCloseTo(lift('hall_entrance'), 5);
    expect(lastKeepLiftAt(34, -1)).toBe(0); // middle cell floor
    expect(lastKeepLiftAt(33, 97)).toBeCloseTo(lift('tower_lookout'), 5);
    expect(lastKeepLiftAt(0, 72)).toBeCloseTo(lift('gallery'), 5);
  });

  it('the residence floor loops: two distinct stair routes reach story 2', () => {
    // Removing either stair room must leave the residence reachable through
    // the other, so story 2 never hangs off a single staircase. (The
    // servants' quarters are deliberately excluded: they open only onto the
    // servants' stair, their whole point.)
    for (const removed of ['stair_grand', 'stair_servants']) {
      const kept = rooms.filter((r) => r.id !== removed);
      const adjacency = new Map<string, string[]>();
      for (const d of doors) {
        const pair = doorRooms(kept, d);
        if (!pair) continue;
        const [a, b] = pair;
        adjacency.set(a.id, [...(adjacency.get(a.id) ?? []), b.id]);
        adjacency.set(b.id, [...(adjacency.get(b.id) ?? []), a.id]);
      }
      const seen = new Set<string>(['hall_entrance']);
      const queue = ['hall_entrance'];
      while (queue.length > 0) {
        const cur = queue.pop() as string;
        for (const next of adjacency.get(cur) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      for (const id of [
        'gallery',
        'royal_chamber',
        'guest_west',
        'guest_mid',
        'guest_east',
        'solar',
        'chapel',
        'library',
      ]) {
        expect(seen.has(id), `${id} unreachable without ${removed}`).toBe(true);
      }
    }
  });

  it('decor uses only renderer-supported keys, inside a room, never on a stair ramp', () => {
    for (const d of LASTKEEP_DECOR) {
      expect(SUPPORTED_DECOR_KEYS.has(d.key), `unsupported decor key ${d.key}`).toBe(true);
      const room = roomAt(rooms, d.x, d.z);
      expect(room, `${d.key} at (${d.x},${d.z}) is outside every room`).not.toBeNull();
      // A decor piece inside a door's ramp band would stand tilted on the stair
      // run; every piece must sit on its room's flat floor.
      const at = authoredLiftAt(rooms, doors, d.x, d.z);
      expect(at, `${d.key} at (${d.x},${d.z}) sits on a ramp`).toBeCloseTo(
        (room as AuthoredRoom).lift ?? 0,
        5,
      );
    }
  });

  it('the dungeon dressing (cages, bones) is confined to the undercroft', () => {
    for (const d of LASTKEEP_DECOR) {
      if (d.key !== 'hanging_cage' && d.key !== 'bone_pile') continue;
      const room = roomAt(rooms, d.x, d.z) as AuthoredRoom;
      // The pantry's larder cage is the one lived-in use of the cage model.
      if (d.key === 'hanging_cage' && room.id === 'pantry') continue;
      expect(room.lift ?? 0, `${d.key} at (${d.x},${d.z}) is above the undercroft`).toBeLessThan(
        1.6,
      );
    }
  });

  it('layoutColliders yields walls and decor footprints', () => {
    const colliders = layoutColliders(LASTKEEP_LAYOUT);
    expect(colliders.length).toBeGreaterThan(0);
    expect(colliders.some((c) => c.type === 'obb')).toBe(true); // wall runs
    expect(colliders.some((c) => c.type === 'circle')).toBe(true); // decor footprints
  });

  it('furnishing plan: every kcas piece sits in a room, off ramps, off decor, off door lanes', () => {
    const spots = lastKeepFurnishings();
    expect(spots.length).toBeGreaterThan(150); // the keep is FURNISHED, not dressed
    const inRoom = (s: KeepDressingSpot, id: string): boolean => roomAt(rooms, s.x, s.z)?.id === id;
    const count = (id: string, pred: (kind: KeepDressingSpot['kind']) => boolean): number =>
      spots.filter((s) => inRoom(s, id) && pred(s.kind)).length;
    // The library is the bookcase-heavy room.
    expect(count('library', (k) => k === 'kcasBookcase')).toBeGreaterThanOrEqual(6);
    // Castle-v3 room-identity pins: the throne room's candle rows, feast
    // tables in the great hall, the parlor's set dinner table, the ballroom
    // buffet, a bed in every bedroom, bunks by the servants' stair, the
    // chapel's shrine and pews, and the armory's wall racks.
    expect(count('throne_room', (k) => k === 'kcasCandleTriple')).toBeGreaterThanOrEqual(8);
    // kcasTableLong is the laid (food-decorated) tablecloth model.
    expect(
      count('great_hall', (k) => k === 'kcasTableCloth' || k === 'kcasTableLong'),
    ).toBeGreaterThanOrEqual(4);
    expect(count('dining_parlor', (k) => k === 'kcasTableCloth')).toBeGreaterThanOrEqual(1);
    expect(count('dining_parlor', (k) => k === 'kcasChair')).toBeGreaterThanOrEqual(4);
    expect(
      count('ballroom', (k) => k === 'kcasBarA' || k === 'kcasBarB' || k === 'kcasBarC'),
    ).toBeGreaterThanOrEqual(3);
    expect(count('royal_chamber', (k) => k === 'kcasBedRoyal')).toBe(1);
    expect(count('guest_west', (k) => k === 'kcasBedSingle')).toBeGreaterThanOrEqual(2);
    expect(count('guest_mid', (k) => k === 'kcasBedDouble')).toBe(1);
    expect(count('guest_east', (k) => k === 'kcasBedDouble')).toBe(1);
    expect(count('servants_quarters', (k) => k === 'kcasBedBunk')).toBeGreaterThanOrEqual(2);
    expect(count('guard_room', (k) => k === 'kcasBedCot')).toBeGreaterThanOrEqual(2);
    expect(count('chapel', (k) => k === 'kcasShrine')).toBe(1);
    expect(count('chapel', (k) => k === 'kcasBench')).toBeGreaterThanOrEqual(4);
    expect(count('armory', (k) => k === 'kcasSwordShield')).toBeGreaterThanOrEqual(2);
    // Prisoner bedrolls dress every gaol cell.
    for (const cell of ['cell_north', 'cell_mid', 'cell_south']) {
      expect(
        count(cell, (k) => k === 'kcasBedroll'),
        cell,
      ).toBe(1);
    }
    // The doorway-lane contract: a walk lane through every opening, extended
    // 1.5yd into both rooms, that no floor-standing piece's footprint enters.
    const laneRects = doors.map((d) => {
      const pair = doorRooms(rooms, d) as [AuthoredRoom, AuthoredRoom];
      const zWall = pair[0].z1 === d.z || pair[0].z0 === d.z;
      return zWall
        ? { x0: d.x - d.hw, x1: d.x + d.hw, z0: d.z - d.hd - 1.5, z1: d.z + d.hd + 1.5 }
        : { x0: d.x - d.hw - 1.5, x1: d.x + d.hw + 1.5, z0: d.z - d.hd, z1: d.z + d.hd };
    });
    const circleHitsRect = (
      s: KeepDressingSpot,
      r: { x0: number; x1: number; z0: number; z1: number },
    ): boolean => {
      const cx = Math.max(r.x0, Math.min(r.x1, s.x));
      const cz = Math.max(r.z0, Math.min(r.z1, s.z));
      return Math.hypot(s.x - cx, s.z - cz) < s.clearR;
    };
    for (const s of spots) {
      const room = roomAt(rooms, s.x, s.z);
      expect(room, `${s.kind} at (${s.x},${s.z}) is outside every room`).not.toBeNull();
      // Never on a stair ramp (a tilted bookcase or a bench floating over the
      // run): the local lift must be the room's flat floor.
      const at = authoredLiftAt(rooms, doors, s.x, s.z);
      expect(at, `${s.kind} at (${s.x},${s.z}) sits on a ramp`).toBeCloseTo(
        (room as AuthoredRoom).lift ?? 0,
        5,
      );
      if (s.mounted) continue; // banners and sconces hang above the lanes
      for (const lane of laneRects) {
        expect(
          circleHitsRect(s, lane),
          `${s.kind} at (${s.x},${s.z}) blocks the door lane (${lane.x0}..${lane.x1}, ${lane.z0}..${lane.z1})`,
        ).toBe(false);
      }
      // Never on a sim decor collider (brazier, statue, forge, ...): the
      // furniture carries no collider of its own, so overlapping one would
      // bury the collidable prop inside a table or keg.
      for (const d of LASTKEEP_DECOR) {
        if (d.r === undefined || d.r <= 0) continue;
        const dist = Math.hypot(s.x - d.x, s.z - d.z);
        expect(
          dist,
          `${s.kind} at (${s.x},${s.z}) lands on decor ${d.key} at (${d.x},${d.z})`,
        ).toBeGreaterThanOrEqual(d.r + 0.2);
      }
    }
  });

  it('a player enters through the door path, spawns no mobs, and leaves clean', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const pid = sim.player.id;
    const before = [...(sim as any).entities.values()].filter(
      (e: { kind: string }) => e.kind === 'mob',
    ).length;
    expect(enterDungeon((sim as any).ctx, 'the_last_keep', pid)).toBe(true);
    expect(sim.player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('the_last_keep');
    // a zero-combat interior claims its slot without creating a single mob
    const after = [...(sim as any).entities.values()].filter(
      (e: { kind: string }) => e.kind === 'mob',
    ).length;
    expect(after).toBe(before);
    // the arrival point must not sit inside the exit portal's walk-out trigger:
    // a tick of door processing leaves the player standing inside
    sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(leaveDungeon((sim as any).ctx, pid)).toBe(true);
    expect(sim.player.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
  });
});
