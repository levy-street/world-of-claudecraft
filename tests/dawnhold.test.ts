// Dawnhold Castle: the Evergarden's zero-combat authored room-graph garden
// palace, laid out as ONE WARM MAIN FLOOR plus a small upper story (gallery,
// bedroom suite, solar) over a single half-landing stair room.
// Pins the structural contracts the layout must keep: every room is reachable
// from the entrance hall through real doorways, every door straddles exactly
// two rooms on a shared wall line (with the opening inside both rooms' shared
// span), the dungeon entry and exit both land inside the entrance hall, decor
// uses only keys the authored decor renderer handles, never sits on a stair
// ramp, and never brings the crypt's cold dressing indoors (no bones, cages,
// or thrones: this palace has no undercroft), the layout yields a real
// collision set, the renderer's furnishing plan
// (src/render/dawnhold_dressing.ts) honors the doorway-lane and decor
// clearance contract, and entering through the real Sim door path spawns no
// mobs, records the visit deed, and leaves clean.
import { describe, expect, it } from 'vitest';
import { type DawnholdDressingSpot, dawnholdFurnishings } from '../src/render/dawnhold_dressing';
import { PROP_ASSET_DEFS } from '../src/render/props';
import { DUNGEON_LIST, DUNGEON_X_THRESHOLD, DUNGEONS, dungeonAt } from '../src/sim/data';
import {
  type AuthoredDoor,
  type AuthoredRoom,
  DAWNHOLD_DECOR,
  DAWNHOLD_DOORS,
  DAWNHOLD_LAYOUT,
  DAWNHOLD_ROOMS,
  dawnholdKeepLiftAt,
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

// Dawnhold is a WARM garden palace with no undercroft: the crypt-flavored
// dressing must never appear anywhere in it.
const COLD_DECOR_KEYS = new Set([
  'hanging_cage',
  'bone_pile',
  'bone_throne',
  'demon_idol',
  'obsidian_fang',
  'pentagram',
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

describe('Dawnhold Castle layout', () => {
  const rooms = DAWNHOLD_ROOMS;
  const doors = DAWNHOLD_DOORS;
  const def = DUNGEONS.dawnhold_castle;

  it('registers the dungeon def: zero combat, unique index, authored interior', () => {
    expect(def).toBeDefined();
    expect(def.spawns).toEqual([]);
    // zero combat, but not zero encounters: the entrance hall keepsake is
    // the instance's one placed object (the placement sweep in fixes.test.ts
    // requires every dungeon to place at least one encounter)
    expect(def.objects?.map((o) => o.itemId)).toEqual(['dawnhold_posy']);
    expect(def.interior).toBe('dawnhold');
    expect(def.suggestedPlayers).toBe(1);
    // The door reads as the palace's own doorway, flush on the keep model's
    // south face (the keep faces +z), so leaving drops the player FORWARD.
    expect(def.staticDoor).toBe(true);
    expect(def.doorPos).toEqual({ x: 258, z: 886.6 });
    expect(def.leaveOffset).toEqual({ x: 0, z: 3.2 });
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

  it('reads as two stories: the warm main floor at 0, the solar story at 3', () => {
    const lift = (id: string): number => rooms.find((r) => r.id === id)?.lift ?? 0;
    // No undercroft: nothing sits below the garden floor.
    const lowest = Math.min(...rooms.map((r) => r.lift ?? 0));
    expect(lowest).toBe(0);
    // THE MAIN FLOOR: eight warm rooms at lift 0.
    for (const id of [
      'hall_entrance',
      'great_parlor',
      'dining_room',
      'kitchen',
      'garden_room',
      'library_nook',
      'chapel',
    ]) {
      expect(lift(id), id).toBe(0);
    }
    // THE UPPER STORY, reached over one half landing.
    expect(lift('stair_solar')).toBeCloseTo(1.5, 5);
    for (const id of ['gallery', 'bedroom_suite', 'solar']) {
      expect(lift(id), id).toBeCloseTo(3.0, 5);
    }
    // Every lift change across a door is a climbable half landing (max 1.5
    // per step: slope 0.25 over the 6yd ramp band, far under the 1.5 gate).
    for (const d of doors) {
      const pair = doorRooms(rooms, d) as [AuthoredRoom, AuthoredRoom];
      const step = Math.abs((pair[0].lift ?? 0) - (pair[1].lift ?? 0));
      expect(step, `door (${d.x},${d.z}) lift step`).toBeLessThanOrEqual(1.5 + 1e-9);
    }
    // dawnholdKeepLiftAt (the groundHeight arm's source) agrees with the room data
    expect(dawnholdKeepLiftAt(def.entry.x, def.entry.z)).toBe(0);
    expect(dawnholdKeepLiftAt(22, 8)).toBe(0); // the conservatory floor
    expect(dawnholdKeepLiftAt(8, 30)).toBeCloseTo(lift('stair_solar'), 5);
    expect(dawnholdKeepLiftAt(2, 38)).toBeCloseTo(lift('gallery'), 5);
    expect(dawnholdKeepLiftAt(-17, 41)).toBeCloseTo(lift('bedroom_suite'), 5);
    expect(dawnholdKeepLiftAt(20, 40)).toBeCloseTo(lift('solar'), 5);
  });

  it('decor uses only renderer-supported keys, inside a room, never on a stair ramp', () => {
    for (const d of DAWNHOLD_DECOR) {
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

  it('carries NO cold dungeon dressing anywhere (this palace has no undercroft)', () => {
    for (const d of DAWNHOLD_DECOR) {
      expect(COLD_DECOR_KEYS.has(d.key), `${d.key} at (${d.x},${d.z}) is crypt dressing`).toBe(
        false,
      );
    }
    // The warmth is real, not just an absence: hearths in the parlor and
    // kitchen, garden statues, and firelight throughout.
    const keys = DAWNHOLD_DECOR.map((d) => d.key);
    expect(keys.filter((k) => k === 'hell_forge').length).toBe(2);
    expect(keys.filter((k) => k === 'infernal_statue').length).toBeGreaterThanOrEqual(4);
    expect(keys.filter((k) => k === 'infernal_brazier').length).toBeGreaterThanOrEqual(10);
  });

  it('layoutColliders yields walls and decor footprints', () => {
    const colliders = layoutColliders(DAWNHOLD_LAYOUT);
    expect(colliders.length).toBeGreaterThan(0);
    expect(colliders.some((c) => c.type === 'obb')).toBe(true); // wall runs
    expect(colliders.some((c) => c.type === 'circle')).toBe(true); // decor footprints
  });

  it('every furnishing kind resolves in the prop registry (an unknown key renders nothing)', () => {
    // ensureDawnholdDressing swallows a missing PROP_ASSET_DEFS entry in a
    // try/catch and caches an empty part list, so an unregistered kind
    // ships as silently invisible furniture; pin the whole kind set here
    const defs = PROP_ASSET_DEFS as Record<string, { url: string } | undefined>;
    const missing = [...new Set(dawnholdFurnishings().map((s) => s.kind))].filter(
      (k) => !defs[k]?.url,
    );
    expect(missing).toEqual([]);
  });

  it('furnishing plan: every piece sits in a room, off ramps, off decor, off door lanes', () => {
    const spots = dawnholdFurnishings();
    expect(spots.length).toBeGreaterThan(100); // the palace is FURNISHED, not dressed
    const inRoom = (s: DawnholdDressingSpot, id: string): boolean =>
      roomAt(rooms, s.x, s.z)?.id === id;
    const count = (id: string, pred: (kind: DawnholdDressingSpot['kind']) => boolean): number =>
      spots.filter((s) => inRoom(s, id) && pred(s.kind)).length;
    // Room-identity pins: the conservatory is FULL of planters and flowers,
    // green (never red) heraldry throughout, a set dinner table, the cook's
    // hearth-side work table, the chapel's shrine and pews, the library's
    // bookcases, the state bed upstairs, and more growing things in the solar.
    const planterKinds = new Set(['flowerBedSquareA', 'flowerBedSquareB', 'flowerBedRound']);
    const flowerKinds = new Set(['shrubFlowering', 'flowerGlow']);
    expect(count('garden_room', (k) => planterKinds.has(k))).toBeGreaterThanOrEqual(6);
    expect(count('garden_room', (k) => flowerKinds.has(k))).toBeGreaterThanOrEqual(8);
    expect(count('garden_room', (k) => k === 'leafyFoxStatue')).toBe(1);
    expect(spots.filter((s) => s.kind.startsWith('kcasBannerGreen')).length).toBeGreaterThanOrEqual(
      8,
    );
    expect(spots.some((s) => s.kind.startsWith('kcasBannerRed'))).toBe(false);
    expect(count('dining_room', (k) => k === 'kcasTableCloth')).toBe(1);
    expect(count('dining_room', (k) => k === 'kcasChair')).toBeGreaterThanOrEqual(6);
    expect(count('kitchen', (k) => k === 'kcasTableLong')).toBe(1);
    expect(count('kitchen', (k) => k === 'kcasKeg' || k === 'kcasBarrel')).toBeGreaterThanOrEqual(
      3,
    );
    expect(count('chapel', (k) => k === 'kcasShrine')).toBe(1);
    expect(count('chapel', (k) => k === 'kcasBench')).toBeGreaterThanOrEqual(4);
    expect(count('library_nook', (k) => k === 'kcasBookcase')).toBeGreaterThanOrEqual(3);
    expect(count('bedroom_suite', (k) => k === 'kcasBedRoyal')).toBe(1);
    expect(count('great_parlor', (k) => k === 'kcasTableCloth')).toBe(1);
    expect(count('solar', (k) => planterKinds.has(k) || flowerKinds.has(k))).toBeGreaterThanOrEqual(
      3,
    );
    // Every room carries at least one furnishing or light spot.
    for (const room of rooms) {
      expect(
        count(room.id, () => true),
        `${room.id} is bare`,
      ).toBeGreaterThan(0);
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
      s: DawnholdDressingSpot,
      r: { x0: number; x1: number; z0: number; z1: number },
    ): boolean => {
      const cx = Math.max(r.x0, Math.min(r.x1, s.x));
      const cz = Math.max(r.z0, Math.min(r.z1, s.z));
      return Math.hypot(s.x - cx, s.z - cz) < s.clearR;
    };
    for (const s of spots) {
      const room = roomAt(rooms, s.x, s.z);
      expect(room, `${s.kind} at (${s.x},${s.z}) is outside every room`).not.toBeNull();
      // Never on a stair ramp (a tilted bookcase or a planter floating over
      // the run): the local lift must be the room's flat floor.
      const at = authoredLiftAt(rooms, doors, s.x, s.z);
      expect(at, `${s.kind} at (${s.x},${s.z}) sits on a ramp`).toBeCloseTo(
        (room as AuthoredRoom).lift ?? 0,
        5,
      );
      // A MOUNTED piece hangs above the walking lane, so it is exempt from
      // the lane rule, but it may never hang in the OPENING itself: a
      // sconce inside a doorway floats in the gap where the wall is not.
      // The lane rule cannot see this (it exempts mounted pieces outright),
      // which is exactly how a wing appended later puts a fixture in a new
      // door: check the opening on the pierced wall directly.
      if (s.mounted) {
        for (const d of doors) {
          const pair = doorRooms(rooms, d) as [AuthoredRoom, AuthoredRoom];
          const zWall = pair[0].z1 === d.z || pair[0].z0 === d.z;
          // the hole in the wall, one wall thickness deep
          const opening = zWall
            ? { x0: d.x - d.hw, x1: d.x + d.hw, z0: d.z - d.hd, z1: d.z + d.hd }
            : { x0: d.x - d.hd, x1: d.x + d.hd, z0: d.z - d.hw, z1: d.z + d.hw };
          // the MOUNT point plus its bracket, not the lane clearance: a
          // banner two yards down the wall from an arch is fine, a sconce
          // bracketed inside the arch is not
          const BRACKET = 0.5;
          const inOpening =
            s.x > opening.x0 - BRACKET &&
            s.x < opening.x1 + BRACKET &&
            s.z > opening.z0 - BRACKET &&
            s.z < opening.z1 + BRACKET;
          expect(
            inOpening,
            `mounted ${s.kind} at (${s.x},${s.z}) hangs in the door opening at (${d.x},${d.z})`,
          ).toBe(false);
        }
        continue;
      }
      for (const lane of laneRects) {
        expect(
          circleHitsRect(s, lane),
          `${s.kind} at (${s.x},${s.z}) blocks the door lane (${lane.x0}..${lane.x1}, ${lane.z0}..${lane.z1})`,
        ).toBe(false);
      }
      // Never on a sim decor collider (brazier, statue, hearth, ...): the
      // furniture carries no collider of its own, so overlapping one would
      // bury the collidable prop inside a table or planter.
      for (const d of DAWNHOLD_DECOR) {
        if (d.r === undefined || d.r <= 0) continue;
        const dist = Math.hypot(s.x - d.x, s.z - d.z);
        expect(
          dist,
          `${s.kind} at (${s.x},${s.z}) lands on decor ${d.key} at (${d.x},${d.z})`,
        ).toBeGreaterThanOrEqual(d.r + 0.2);
      }
    }
  });

  it('a player enters through the door path, spawns no mobs, earns the visit deed, and leaves clean', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const pid = sim.player.id;
    const before = [...(sim as any).entities.values()].filter(
      (e: { kind: string }) => e.kind === 'mob',
    ).length;
    expect(enterDungeon((sim as any).ctx, 'dawnhold_castle', pid)).toBe(true);
    expect(sim.player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('dawnhold_castle');
    // a zero-combat interior claims its slot without creating a single mob
    const after = [...(sim as any).entities.values()].filter(
      (e: { kind: string }) => e.kind === 'mob',
    ).length;
    expect(after).toBe(before);
    // the arrival point must not sit inside the exit portal's walk-out trigger:
    // a tick of door processing leaves the player standing inside; the same
    // tick's deeds pass grants the visit deed off the enterDungeon mark
    sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const meta = (sim as any).players.get(pid);
    expect(meta.deedStats.visited.has('dungeon:dawnhold_castle')).toBe(true);
    expect(meta.deedsEarned.has('exp_dawnhold_castle')).toBe(true);
    expect(leaveDungeon((sim as any).ctx, pid)).toBe(true);
    expect(sim.player.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
  });
});
