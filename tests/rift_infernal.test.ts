// The Infernal Citadel: the hand-authored set-piece rift floor.
//
// Covers what the procedural rift tests cannot: the authored room graph (walls,
// doorways, reachability), the two-boss gating chain (miniboss -> Blood Orb ->
// portcullis -> giga-boss -> exit), and the guarantee that adding the set-piece
// left every procedural seed byte-identical.

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { fitAuthoredWallSegment } from '../src/render/authored_walls_core';
import type { Collider } from '../src/sim/colliders';
import {
  buildInfernalCitadelFloor,
  INFERNAL_DOORS,
  INFERNAL_FLOOR_COUNT,
  INFERNAL_PIT_DOORS,
  INFERNAL_PIT_ROOMS,
  INFERNAL_ROOMS,
} from '../src/sim/content/rift/infernal_citadel';
import { RIFT_REGION_HALF_X, RIFT_REGION_HALF_Z, riftInstanceOrigin } from '../src/sim/data';
import { layoutColliders } from '../src/sim/dungeon_layout';
import { authoredLiftAt, authoredWallSegments, inAnyRoom, roomAt } from '../src/sim/rift/authored';
import { RIFT_TIER_INFO } from '../src/sim/rift/portals';
import {
  generateRiftFloor,
  generateRiftPlan,
  isSetPieceSeed,
  riftFloorCount,
} from '../src/sim/rift/rift_gen';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const BODY_R = 0.6;

/** The first `count` seeds that open the citadel (used across the lifecycle tests). */
function setPieceSeeds(count: number): number[] {
  const out: number[] = [];
  for (let s = 1; out.length < count && s < 100_000; s++) {
    if (isSetPieceSeed(s)) out.push(s);
  }
  expect(out.length).toBe(count);
  return out;
}

function clears(colliders: readonly Collider[], x: number, z: number, r = BODY_R): boolean {
  for (const c of colliders) {
    if (c.type === 'circle') {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + r) * (c.r + r)) return false;
    } else {
      const dx = x - c.x;
      const dz = z - c.z;
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) return false;
    }
  }
  return true;
}

describe('infernal citadel: seed selection', () => {
  it('is a pure function of the seed (stable across calls)', () => {
    for (let s = 1; s < 200; s++) {
      expect(isSetPieceSeed(s)).toBe(isSetPieceSeed(s));
    }
  });

  it('fires on a sane fraction of seeds (roughly the tuned 15%)', () => {
    let hits = 0;
    for (let s = 1; s <= 4000; s++) if (isSetPieceSeed(s)) hits++;
    const pct = hits / 4000;
    expect(pct).toBeGreaterThan(0.08);
    expect(pct).toBeLessThan(0.22);
  });

  it('is C-only content: C builds the citadel; B/A/S run procedural', () => {
    // The 2-floor set-piece gates on riftHeroicTuningFor(baseLevel) === null.
    // B now carries the heroic transform, so B/A/S all bypass the citadel and
    // run the procedural descent even on a set-piece seed.
    const seed = setPieceSeeds(1)[0];
    // C: gets the authored citadel.
    const cFloor = generateRiftFloor(seed, RIFT_TIER_INFO.C.baseLevel, 0);
    expect(cFloor.authored, 'C opens the citadel').toBeDefined();
    // B on a citadel seed runs procedural 3+ (B has heroic tuning now).
    const bFloor = generateRiftFloor(seed, RIFT_TIER_INFO.B.baseLevel, 0);
    expect(bFloor.authored, 'B never opens the 2-floor set-piece').toBeUndefined();
    expect(bFloor.floorCount).toBeGreaterThanOrEqual(3);
    for (const tier of ['A', 'S'] as const) {
      const floor = generateRiftFloor(seed, RIFT_TIER_INFO[tier].baseLevel, 0);
      expect(floor.authored, `${tier} never opens the 2-floor set-piece`).toBeUndefined();
      expect(floor.floorCount).toBeGreaterThanOrEqual(3);
    }
  });

  it('names the rift a Citadel and descends two floors (halls, then the pit)', () => {
    // The citadel is C-only content: use the C-rank base level (20).
    for (const seed of setPieceSeeds(5)) {
      const plan = generateRiftPlan(seed, 20);
      expect(plan.floorCount).toBe(INFERNAL_FLOOR_COUNT);
      expect(plan.floorCount).toBe(2);
      expect(plan.themeId).toBe('infernal');
      expect(plan.name).toMatch(/Citadel$/);
    }
  });

  it('leaves procedural seeds untouched (no set-piece, still multi-floor)', () => {
    let checked = 0;
    for (let s = 1; s < 400; s++) {
      if (isSetPieceSeed(s)) continue;
      const floor = generateRiftFloor(s, 20, 0);
      expect(floor.authored).toBeUndefined();
      expect(floor.layout.rooms).toBeUndefined();
      expect(generateRiftPlan(s, 20).floorCount).toBeGreaterThanOrEqual(3);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  // The set-piece landed alongside an extraction of `mix`/`jitterColor`/`buildStyle`
  // out of rift_gen and into rift/style.ts. Nothing in the parity gate enters a rift,
  // so a mistyped constant in that move (or any later edit to the generator's draw
  // ORDER) would silently reshape every procedural rift with every other test green.
  // This digest was captured on the BASE branch, before the set-piece existed: it must
  // never change unless procedural rift geometry is deliberately re-tuned.
  // DELIBERATE re-pin (phantom-wall removal): the treasure pocket keeps the same
  // draws but no longer emits an illusion wall into the layout, so the serialized
  // floors changed while every collider, spawn, and object position stayed put
  // (the objective-placement sweep in rift_gen.test.ts pins those directly).
  // DELIBERATE re-pin (entry clearance): the trash band now starts a full
  // RIFT_ENTRY_CLEAR_RADIUS past the arrival point so walking into a floor cannot pull
  // the front pack (tests/rift_entry_clearance.test.ts). packCount is still keyed to the
  // original band start, so the draw COUNT and therefore the draw ORDER are unchanged:
  // the same packs are spread across a shorter band. Verified narrow before re-pinning,
  // by digesting every floor field EXCEPT `spawns` across seeds 1 to 200 on both sides of
  // the change: that digest is byte-identical, so only spawn positions moved here.
  it('regenerates procedural floors byte-identically to the pre-set-piece baseline', () => {
    // Hand-picked on the base branch, so the seed list itself cannot drift with the
    // set-piece roll.
    const SEEDS = [
      1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 42, 101, 202, 12345,
    ];
    for (const s of SEEDS) expect(isSetPieceSeed(s), `seed ${s} must stay procedural`).toBe(false);
    const h = createHash('sha256');
    for (const s of SEEDS) {
      h.update(`${s}:${riftFloorCount(s)}`);
      for (let f = 0; f < riftFloorCount(s); f++) {
        h.update(JSON.stringify(generateRiftFloor(s, 20, f)));
      }
    }
    expect(h.digest('hex')).toBe(
      'c1bdf1d27a9d3a5450c758d7e0aadda33cd9c765ed40e11ed308c3ae8de5db1a',
    );
  });
});

describe('infernal citadel: determinism', () => {
  it('regenerates byte-identically from the same descriptor', () => {
    const seed = setPieceSeeds(1)[0];
    const a = JSON.stringify(buildInfernalCitadelFloor(seed, 22, 22));
    const b = JSON.stringify(buildInfernalCitadelFloor(seed, 22, 22));
    expect(a).toBe(b);
  });

  it('draws no randomness from the live sim rng', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const before = sim.rng.next();
    const sim2 = new Sim({ seed: 7, playerClass: 'warrior' });
    buildInfernalCitadelFloor(setPieceSeeds(1)[0], 22, 22);
    // Use C-rank (20) so the set-piece gate opens the citadel (B now has heroic tuning).
    generateRiftFloor(setPieceSeeds(1)[0], 20, 0);
    const after = sim2.rng.next();
    expect(after).toBe(before);
  });

  it('grades differently per seed (the colour jitter is seeded)', () => {
    const seeds = setPieceSeeds(4);
    const fogs = seeds.map((s) => buildInfernalCitadelFloor(s, 22, 22).style.fog.color);
    expect(new Set(fogs).size).toBeGreaterThan(1);
  });
});

describe('infernal citadel: authored geometry', () => {
  const floor = buildInfernalCitadelFloor(setPieceSeeds(1)[0], 22, 22);
  const colliders = layoutColliders(floor.layout);
  const pitFloor = buildInfernalCitadelFloor(setPieceSeeds(1)[0], 22, 22, 1);
  const pitColliders = layoutColliders(pitFloor.layout);

  it('stays inside the rift region bounds', () => {
    for (const r of [...INFERNAL_ROOMS, ...INFERNAL_PIT_ROOMS]) {
      expect(Math.abs(r.x0)).toBeLessThan(RIFT_REGION_HALF_X);
      expect(Math.abs(r.x1)).toBeLessThan(RIFT_REGION_HALF_X);
      expect(Math.abs(r.z0)).toBeLessThan(RIFT_REGION_HALF_Z);
      expect(Math.abs(r.z1)).toBeLessThan(RIFT_REGION_HALF_Z);
    }
  });

  it('lays out both floors from non-overlapping room graphs', () => {
    expect(INFERNAL_ROOMS.length).toBe(7);
    expect(INFERNAL_DOORS.length).toBe(7);
    expect(INFERNAL_PIT_ROOMS.length).toBe(4);
    expect(INFERNAL_PIT_DOORS.length).toBe(3);
    for (const rooms of [INFERNAL_ROOMS, INFERNAL_PIT_ROOMS]) {
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i];
          const b = rooms[j];
          const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
          expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('fits every rendered wall module inside its source segment (both floors)', () => {
    for (const [rooms, doors] of [
      [INFERNAL_ROOMS, INFERNAL_DOORS],
      [INFERNAL_PIT_ROOMS, INFERNAL_PIT_DOORS],
    ] as const) {
      for (const seg of authoredWallSegments(rooms, doors)) {
        const cells = fitAuthoredWallSegment(seg.a, seg.b, 8);
        expect(cells.length).toBeGreaterThan(0);
        for (const cell of cells) {
          expect(cell.center - cell.length / 2).toBeGreaterThanOrEqual(seg.a - 1e-9);
          expect(cell.center + cell.length / 2).toBeLessThanOrEqual(seg.b + 1e-9);
        }
      }
    }
  });

  it('fitAuthoredWallSegment handles degenerate and exact-multiple inputs', () => {
    expect(fitAuthoredWallSegment(5, 5, 8)).toEqual([]);
    expect(fitAuthoredWallSegment(5, 3, 8)).toEqual([]);
    expect(fitAuthoredWallSegment(0, 10, 0)).toEqual([]);
    expect(fitAuthoredWallSegment(0, 10, -4)).toEqual([]);
    expect(fitAuthoredWallSegment(0, 16, 8)).toEqual([
      { center: 4, length: 8 },
      { center: 12, length: 8 },
    ]);
    expect(fitAuthoredWallSegment(0, 1.5, 8)).toEqual([{ center: 0.75, length: 1.5 }]);
  });

  it('gives the entrance enough room for the player and chase camera', () => {
    const entrance = INFERNAL_ROOMS.find((room) => room.id === 'entry');
    expect(entrance).toBeDefined();
    expect(
      (entrance as NonNullable<typeof entrance>).x1 - (entrance as NonNullable<typeof entrance>).x0,
    ).toBeGreaterThanOrEqual(14);
    expect(
      (entrance as NonNullable<typeof entrance>).z1 - (entrance as NonNullable<typeof entrance>).z0,
    ).toBeGreaterThanOrEqual(18);
    expect(floor.entry.z - (entrance as NonNullable<typeof entrance>).z0).toBeGreaterThanOrEqual(8);
  });

  it('walls seal the shell: no segment crosses a doorway centre', () => {
    const segs = authoredWallSegments(INFERNAL_ROOMS, INFERNAL_DOORS);
    expect(segs.length).toBeGreaterThan(10);
    for (const d of INFERNAL_DOORS) {
      expect(clears(colliders, d.x, d.z), `doorway (${d.x},${d.z}) is walled shut`).toBe(true);
    }
  });

  it('every doorway is walkable and joins two DIFFERENT rooms', () => {
    for (const d of INFERNAL_DOORS) {
      // A step to either side of the door line lands in a room, and they differ.
      const along = d.hw > d.hd ? { dx: 0, dz: 1 } : { dx: 1, dz: 0 };
      const step = 2.0;
      const a = roomAt(INFERNAL_ROOMS, d.x - along.dx * step, d.z - along.dz * step);
      const b = roomAt(INFERNAL_ROOMS, d.x + along.dx * step, d.z + along.dz * step);
      expect(a, `no room south/west of door (${d.x},${d.z})`).not.toBeNull();
      expect(b, `no room north/east of door (${d.x},${d.z})`).not.toBeNull();
      expect(a?.id).not.toBe(b?.id);
    }
  });

  it('connects every room to the entrance through the door graph', () => {
    // Build the adjacency the doors define, then BFS from the entry room.
    const adj = new Map<string, string[]>(INFERNAL_ROOMS.map((r) => [r.id, []]));
    for (const d of INFERNAL_DOORS) {
      const along = d.hw > d.hd ? { dx: 0, dz: 1 } : { dx: 1, dz: 0 };
      const a = roomAt(INFERNAL_ROOMS, d.x - along.dx * 2, d.z - along.dz * 2);
      const b = roomAt(INFERNAL_ROOMS, d.x + along.dx * 2, d.z + along.dz * 2);
      if (!a || !b) continue;
      adj.get(a.id)?.push(b.id);
      adj.get(b.id)?.push(a.id);
    }
    const seen = new Set(['entry']);
    const queue = ['entry'];
    while (queue.length) {
      for (const n of adj.get(queue.shift() as string) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    expect(
      seen.size,
      `unreachable rooms: ${INFERNAL_ROOMS.filter((r) => !seen.has(r.id)).map((r) => r.id)}`,
    ).toBe(INFERNAL_ROOMS.length);
  });

  it('loops the Magus and side-room routes back into the central progression', () => {
    const edges = new Set<string>();
    for (const d of INFERNAL_DOORS) {
      const along = d.hw > d.hd ? { dx: 0, dz: 1 } : { dx: 1, dz: 0 };
      const a = roomAt(INFERNAL_ROOMS, d.x - along.dx * 2, d.z - along.dz * 2);
      const b = roomAt(INFERNAL_ROOMS, d.x + along.dx * 2, d.z + along.dz * 2);
      if (a && b) edges.add([a.id, b.id].sort().join(':'));
    }
    expect(edges).toContain('gallery:sacrifice');
    expect(edges).toContain('gallery:rotunda');
    expect(edges).toContain('rotunda:sacrifice');
    expect(edges).toContain('bonepit:rotunda');
    expect(edges).not.toContain('bonepit:temple');
  });

  it('makes the portcullis the only route to the descent (and so to Azgorath)', () => {
    const gate = floor.gate as NonNullable<typeof floor.gate>;
    const adj = new Map<string, string[]>(INFERNAL_ROOMS.map((room) => [room.id, []]));
    for (const door of INFERNAL_DOORS) {
      if (door.x === gate.x && door.z === gate.z) continue;
      const along = door.hw > door.hd ? { dx: 0, dz: 1 } : { dx: 1, dz: 0 };
      const a = roomAt(INFERNAL_ROOMS, door.x - along.dx * 2, door.z - along.dz * 2);
      const b = roomAt(INFERNAL_ROOMS, door.x + along.dx * 2, door.z + along.dz * 2);
      if (!a || !b) continue;
      adj.get(a.id)?.push(b.id);
      adj.get(b.id)?.push(a.id);
    }
    const seen = new Set(['entry']);
    const queue = ['entry'];
    while (queue.length) {
      for (const next of adj.get(queue.shift() as string) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    expect(seen).toContain('rotunda');
    expect(seen).toContain('bonepit');
    expect(seen).not.toContain('stairhead');
    // The descent (the ONLY way to the boss floor) lives in the barred room.
    const descent = floor.objects.find((o) => o.kind === 'descent') as { x: number; z: number };
    expect(roomAt(INFERNAL_ROOMS, descent.x, descent.z)?.id).toBe('stairhead');
  });

  it('connects every pit-floor room to the landing through the door graph', () => {
    const adj = new Map<string, string[]>(INFERNAL_PIT_ROOMS.map((r) => [r.id, []]));
    for (const d of INFERNAL_PIT_DOORS) {
      const along = d.hw > d.hd ? { dx: 0, dz: 1 } : { dx: 1, dz: 0 };
      const a = roomAt(INFERNAL_PIT_ROOMS, d.x - along.dx * 2, d.z - along.dz * 2);
      const b = roomAt(INFERNAL_PIT_ROOMS, d.x + along.dx * 2, d.z + along.dz * 2);
      if (!a || !b) continue;
      adj.get(a.id)?.push(b.id);
      adj.get(b.id)?.push(a.id);
    }
    const seen = new Set(['landing']);
    const queue = ['landing'];
    while (queue.length) {
      for (const n of adj.get(queue.shift() as string) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    expect(seen.size).toBe(INFERNAL_PIT_ROOMS.length);
  });

  it('places the player entry, every spawn, and every object on clear ground inside a room', () => {
    for (const [f, rooms, doors, cols] of [
      [floor, INFERNAL_ROOMS, INFERNAL_DOORS, colliders],
      [pitFloor, INFERNAL_PIT_ROOMS, INFERNAL_PIT_DOORS, pitColliders],
    ] as const) {
      expect(inAnyRoom(rooms, f.entry.x, f.entry.z)).toBe(true);
      expect(clears(cols, f.entry.x, f.entry.z)).toBe(true);
      for (const s of f.spawns) {
        expect(inAnyRoom(rooms, s.x, s.z), `${s.templateId} outside every room`).toBe(true);
        expect(clears(cols, s.x, s.z), `${s.templateId} spawns inside a collider`).toBe(true);
      }
      for (const o of f.objects) {
        // The portcullis deliberately stands ON the shared wall line it bars; every
        // other object sits strictly inside a room.
        if (o.kind === 'gate') {
          expect(doors.some((d) => d.x === o.x && d.z === o.z)).toBe(true);
          continue;
        }
        expect(inAnyRoom(rooms, o.x, o.z), `${o.kind} outside every room`).toBe(true);
      }
    }
  });

  it('leaves the Blood Orb reachable past its altar collider', () => {
    const orb = floor.objects.find((o) => o.kind === 'infernal_orb');
    expect(orb).toBeDefined();
    // Stand just south of the altar: clear ground, and within the 3.2yd orb trigger.
    const standZ = (orb as { z: number }).z - 2.2;
    expect(clears(colliders, 0, standZ)).toBe(true);
    expect(Math.hypot(0, (orb as { z: number }).z - standZ)).toBeLessThan(3.2);
  });

  it('has no phantom walls, and the relic cache stands reachable in the open', () => {
    // Every citadel wall is solid: the relic gallery's collider-less illusion
    // panel is gone rift-wide (a wall that renders solid must BE solid).
    expect(floor.layout.illusionWalls ?? []).toHaveLength(0);
    const cache = floor.objects.find((o) => o.kind === 'treasure' && o.x > 30);
    expect(cache).toBeDefined();
    expect(clears(colliders, (cache as { x: number }).x, (cache as { z: number }).z)).toBe(true);
  });
});

describe('infernal citadel: content', () => {
  const floor = buildInfernalCitadelFloor(setPieceSeeds(1)[0], 22, 22);
  const pitFloor = buildInfernalCitadelFloor(setPieceSeeds(1)[0], 22, 22, 1);

  it('fields the miniboss in the halls and the giga-boss down in the pit', () => {
    expect(floor.spawns.filter((s) => s.boss).length).toBe(0);
    const minis = floor.spawns.filter((s) => s.miniboss);
    expect(minis.length).toBe(1);
    expect(minis[0].templateId).toBe('rift_boss_ritualist');
    expect(minis[0].boss).toBeUndefined();
    const bosses = pitFloor.spawns.filter((s) => s.boss);
    expect(bosses.length).toBe(1);
    expect(bosses[0].templateId).toBe('rift_boss_pitlord');
    expect(pitFloor.spawns.filter((s) => s.miniboss).length).toBe(0);
  });

  it('draws trash only from the citadel roster (both floors)', () => {
    const trash = [...floor.spawns, ...pitFloor.spawns].filter((s) => !s.boss && !s.miniboss);
    expect(trash.length).toBeGreaterThan(15);
    for (const s of trash) {
      expect(['rift_hellguard', 'rift_pact_acolyte']).toContain(s.templateId);
    }
  });

  it('floor 0 is the halls: orb-opened gate sealing the descent, no boss chest', () => {
    expect(floor.isBoss).toBe(false);
    expect(floor.authored).toBe(true);
    expect(floor.floorIndex).toBe(0);
    expect(floor.floorCount).toBe(2);
    expect(floor.gate?.openOnOrb).toBe(true);
    expect(floor.objects.filter((o) => o.kind === 'descent').length).toBe(1);
    expect(floor.objects.some((o) => o.kind === 'switch')).toBe(false);
    expect(floor.objects.some((o) => o.kind === 'chest')).toBe(false);
    expect(floor.objects.filter((o) => o.kind === 'treasure').length).toBe(1);
    expect(floor.puzzle.kind).toBe('none');
    expect(floor.rollers).toEqual([]);
    expect(floor.iceZone).toBeNull();
    expect(floor.hazards.length).toBe(1); // the west gallery's lava band
  });

  it('floor 1 is the boss pit: chest marker and forge cache, no gate or descent', () => {
    expect(pitFloor.isBoss).toBe(true);
    expect(pitFloor.authored).toBe(true);
    expect(pitFloor.floorIndex).toBe(1);
    expect(pitFloor.floorCount).toBe(2);
    expect(pitFloor.gate).toBeNull();
    expect(pitFloor.objects.some((o) => o.kind === 'descent')).toBe(false);
    expect(pitFloor.objects.some((o) => o.kind === 'infernal_orb')).toBe(false);
    expect(pitFloor.objects.filter((o) => o.kind === 'chest').length).toBe(1);
    expect(pitFloor.objects.filter((o) => o.kind === 'treasure').length).toBe(1);
    expect(pitFloor.hazards.length).toBe(1); // the forge wing's molten runoff
  });

  it('bars the way down: orb before the gate, the descent sealed behind it', () => {
    const gate = floor.gate as NonNullable<typeof floor.gate>;
    const orb = floor.objects.find((o) => o.kind === 'infernal_orb') as { z: number };
    const descent = floor.objects.find((o) => o.kind === 'descent') as { z: number };
    expect(orb.z).toBeLessThan(gate.z); // the orb is reached BEFORE the gate
    expect(descent.z).toBeGreaterThan(gate.z); // the way down waits behind it
  });

  it('descends into relief: the pit arena sits below the balcony and the nave', () => {
    const lift = (id: string): number => INFERNAL_PIT_ROOMS.find((r) => r.id === id)?.lift ?? 0;
    expect(lift('landing')).toBeGreaterThan(lift('nave'));
    expect(lift('nave')).toBeGreaterThan(lift('pit'));
    expect(lift('pit')).toBe(0);
    expect(lift('forge')).toBe(lift('nave')); // level crossing into the wing
    // The boss dais lies at the LOWEST point: the pit drops away below the entry.
    const boss = pitFloor.spawns.find((s) => s.boss) as { x: number; z: number };
    expect(authoredLiftAt(INFERNAL_PIT_ROOMS, INFERNAL_PIT_DOORS, boss.x, boss.z)).toBe(0);
    const entry = pitFloor.entry;
    expect(
      authoredLiftAt(INFERNAL_PIT_ROOMS, INFERNAL_PIT_DOORS, entry.x, entry.z),
    ).toBeGreaterThan(3);
  });

  it('ramps continuously through every lift-changing door (no vertical pop)', () => {
    for (const d of INFERNAL_PIT_DOORS) {
      // March across the door along z at its centre x: successive samples must
      // never jump more than the ramp's own slope allows.
      let prev = authoredLiftAt(INFERNAL_PIT_ROOMS, INFERNAL_PIT_DOORS, d.x, d.z - 8);
      for (let dz = -7.75; dz <= 8; dz += 0.25) {
        const cur = authoredLiftAt(INFERNAL_PIT_ROOMS, INFERNAL_PIT_DOORS, d.x, d.z + dz);
        expect(Math.abs(cur - prev)).toBeLessThan(0.45);
        prev = cur;
      }
    }
    // Outside every room the floor is flat zero.
    expect(authoredLiftAt(INFERNAL_PIT_ROOMS, INFERNAL_PIT_DOORS, 39, 100)).toBe(0);
  });
});

describe('infernal citadel: lifecycle', () => {
  let sim: Sim;
  let pid: number;
  let seed: number;

  const inst = () => sim.riftInstances.find((i) => i.partyKey !== null);
  const player = (): Entity => sim.entities.get(pid) as Entity;
  const tickSeconds = (s: number) => {
    for (let i = 0; i < s * 20; i++) sim.tick();
  };
  const localPos = (x: number, z: number) => {
    const i = inst() as NonNullable<ReturnType<typeof inst>>;
    const o = riftInstanceOrigin(i.slot, i.floorIndex);
    return { x: o.x + x, z: o.z + z };
  };
  const teleport = (x: number, z: number) => {
    const p = localPos(x, z);
    const e = player();
    e.prevPos = { ...e.pos };
    e.pos = sim.groundPos(p.x, p.z);
    sim.rebucket(e);
  };
  /** Clear the citadel's trash (the bosses live on). Standing at the altar with six
   * level-22 elites awake kills the test player before the orb can be touched. */
  const killTrash = () => {
    const i = inst() as NonNullable<ReturnType<typeof inst>>;
    for (const id of i.mobIds) {
      if (id === i.bossId || id === i.minibossId) continue;
      const m = sim.entities.get(id);
      if (!m) continue;
      m.hp = 0;
      m.dead = true;
    }
  };

  beforeEach(() => {
    seed = setPieceSeeds(1)[0];
    sim = new Sim({ seed: 99, playerClass: 'warrior', autoEquip: true, devCommands: true });
    pid = sim.player.id;
    // Use C-rank (baseLevel 20): the citadel is C-only content since B now has
    // the heroic stat transform and is excluded from the set-piece by the shared gate.
    sim.enterRift(seed, 20, pid);
  });

  /** Clear the halls (trash + Magus), touch the armed orb, then ride the descent
   * into the pit. Leaves the instance on floor 1 with fresh mobs. */
  const descendToPit = () => {
    const i = inst() as NonNullable<ReturnType<typeof inst>>;
    killTrash();
    const mini = sim.entities.get(i.minibossId as number) as Entity;
    mini.hp = 0;
    mini.dead = true;
    tickSeconds(1.1); // the 1 Hz driver arms the orb and tears the descent open
    expect(i.orbActive).toBe(true);
    expect(i.descentOpen).toBe(true);
    const floor0 = generateRiftFloor(seed, 20, 0);
    const orb = floor0.objects.find((o) => o.kind === 'infernal_orb') as { x: number; z: number };
    teleport(orb.x, orb.z - 2.2);
    sim.tick();
    expect(i.gateOpen).toBe(true);
    const descent = floor0.objects.find((o) => o.kind === 'descent') as { x: number; z: number };
    teleport(descent.x, descent.z);
    for (let k = 0; k < 40 && i.floorIndex === 0; k++) sim.tick();
    expect(i.floorIndex).toBe(1);
  };

  it('drops the party into the entrance corridor of the two-floor citadel', () => {
    const i = inst();
    expect(i).toBeDefined();
    expect(i?.floorCount).toBe(2);
    expect(i?.floorIndex).toBe(0);
    expect(i?.minibossId).not.toBeNull();
    expect(i?.orbId).not.toBeNull();
    expect(i?.orbActive).toBe(false);
    expect(i?.gateOpen).toBe(false);
    const e = player();
    const o = riftInstanceOrigin((i as NonNullable<typeof i>).slot, 0);
    expect(inAnyRoom(INFERNAL_ROOMS, e.pos.x - o.x, e.pos.z - o.z)).toBe(true);
    expect(roomAt(INFERNAL_ROOMS, e.pos.x - o.x, e.pos.z - o.z)?.id).toBe('entry');
  });

  it('keeps the closed gate impassable (a runtime clamp, never a collider)', () => {
    const floor = generateRiftFloor(seed, 20, 0);
    const gate = floor.gate as NonNullable<typeof floor.gate>;
    teleport(0, gate.z + 6); // try to stand INSIDE the temple
    sim.tick();
    const i = inst() as NonNullable<ReturnType<typeof inst>>;
    const o = riftInstanceOrigin(i.slot, i.floorIndex);
    expect(player().pos.z - o.z).toBeLessThan(gate.z); // shoved back south of it
  });

  it('never clamps a player who is legitimately in a side room', () => {
    const i = inst() as NonNullable<ReturnType<typeof inst>>;
    const o = riftInstanceOrigin(i.slot, i.floorIndex);
    killTrash();
    // The Bone Chamber and rotunda both sit NORTH of the gate line but outside its
    // span, so the closed portcullis must leave them alone (it spans |x| < 18).
    for (const [x, z, room] of [
      [-27, 60, 'bonepit'],
      [-27, 40, 'rotunda'],
    ] as const) {
      teleport(x, z);
      sim.tick();
      expect(i.gateOpen).toBe(false);
      expect(roomAt(INFERNAL_ROOMS, player().pos.x - o.x, player().pos.z - o.z)?.id).toBe(room);
    }
  });

  it('refuses the dormant orb, then opens the gate once the miniboss falls', () => {
    const floor = generateRiftFloor(seed, 20, 0);
    const orb = floor.objects.find((o) => o.kind === 'infernal_orb') as { x: number; z: number };
    const i = inst() as NonNullable<ReturnType<typeof inst>>;
    killTrash();

    // Touching the sealed orb does nothing but warn.
    teleport(orb.x, orb.z - 2.2);
    sim.tick();
    expect(i.gateOpen).toBe(false);
    expect(sim.entities.get(i.orbId as number)?.templateId).toBe('rift_infernal_orb');

    // Kill the ritualist away in the rotunda; the 1 Hz driver arms the orb. Step
    // back down the hall first, so arming alone (not a touch) is what is measured.
    teleport(0, 12);
    const mini = sim.entities.get(i.minibossId as number) as Entity;
    mini.hp = 0;
    mini.dead = true;
    tickSeconds(1.1);
    expect(i.orbActive).toBe(true);
    expect(sim.entities.get(i.orbId as number)?.templateId).toBe('rift_infernal_orb_active');
    expect(i.gateOpen).toBe(false); // still shut until someone touches it

    // Touch it: the portcullis grinds open and stays open.
    teleport(orb.x, orb.z - 2.2);
    sim.tick();
    expect(i.gateOpen).toBe(true);
    expect(sim.entities.get(i.gateId as number)?.templateId).toBe('rift_gate_open');

    // Now the temple is passable.
    const gate = floor.gate as NonNullable<typeof floor.gate>;
    teleport(0, gate.z + 6);
    sim.tick();
    const o = riftInstanceOrigin(i.slot, i.floorIndex);
    expect(player().pos.z - o.z).toBeGreaterThan(gate.z);
  });

  it('opens the way home and the sealed cache only when the pit lord dies', () => {
    const i = inst() as NonNullable<ReturnType<typeof inst>>;
    descendToPit();
    killTrash();
    tickSeconds(1.1);
    expect(i.exitId).toBeNull();
    expect(i.cacheId).toBeNull();

    const boss = sim.entities.get(i.bossId as number) as Entity;
    expect(boss.name).toContain('Azgorath');
    boss.hp = 0;
    boss.dead = true;
    tickSeconds(1.1);
    expect(i.exitId).not.toBeNull();
    expect(i.cacheId).not.toBeNull();
    expect(sim.entities.get(i.cacheId as number)?.templateId).toBe('rift_locked_chest');
  });

  it('leaves the citadel through the exit and does not bounce back in', () => {
    const i = inst() as NonNullable<ReturnType<typeof inst>>;
    descendToPit();
    killTrash();
    const boss = sim.entities.get(i.bossId as number) as Entity;
    boss.hp = 0;
    boss.dead = true;
    tickSeconds(1.1);
    const exit = sim.entities.get(i.exitId as number) as Entity;
    const e = player();
    e.prevPos = { ...e.pos };
    e.pos = sim.groundPos(exit.pos.x, exit.pos.z);
    sim.rebucket(e);
    sim.tick();
    expect(Math.abs(player().pos.x)).toBeLessThan(RIFT_REGION_HALF_X * 2); // back overworld
    expect(sim.riftFloor).toBeNull(); // the run is over for this player
  });

  it('lets /dev portal pick the dungeon type by searching for a seed of that kind', () => {
    const chat = (text: string) => sim.chat(text, pid);
    // The dev command forces the kind by finding a seed whose pure roll matches, so no
    // wire field is needed. Assert the SPAWNED portal's seed, not just the log line.
    const portalSeeds = (): number[] => {
      const out: number[] = [];
      for (const e of sim.entities.values()) {
        if (e.templateId === 'rift_portal' && e.riftSeed !== undefined) out.push(e.riftSeed);
      }
      return out;
    };
    const before = portalSeeds().length;
    chat('/dev portal 1 22 A infernal');
    const afterInfernal = portalSeeds();
    expect(afterInfernal.length).toBe(before + 1);
    expect(isSetPieceSeed(afterInfernal[afterInfernal.length - 1])).toBe(true);

    chat('/dev portal 5 22 A random');
    const afterRandom = portalSeeds();
    expect(afterRandom.length).toBe(before + 2);
    expect(isSetPieceSeed(afterRandom[afterRandom.length - 1])).toBe(false);
  });

  it('seals the entry portal on victory: a cleared run cannot be walked into again', () => {
    // Own Sim: the shared fixture already sits in a programmatic (portal-less)
    // instance of the same seed, which a walk-in would silently rejoin.
    const s2 = new Sim({ seed: 99, playerClass: 'warrior', autoEquip: true, devCommands: true });
    const p2 = s2.player.id;
    s2.player.level = 22;
    // Use baseLevel 20 (C-rank): the citadel is C-only since B now has heroic
    // tuning. No rank letter: a letter now forces that rank's canonical
    // baseLevel, and any heroic rank would exclude the set-piece citadel.
    s2.chat('/dev portal 5 20 infernal', p2);
    const portal = [...s2.entities.values()]
      .filter((e) => e.templateId === 'rift_portal')
      .at(-1) as Entity;
    const portalId = portal.id;
    const portalPos = { ...portal.pos };
    const walkIn = () => {
      const e = s2.entities.get(p2) as Entity;
      e.prevPos = { ...e.pos };
      e.pos = { ...portalPos };
      s2.rebucket(e);
      for (let t = 0; t < 40 && s2.riftFloor === null; t++) s2.tick();
    };
    // First run: enter through the portal and clear BOTH floors out.
    walkIn();
    expect(s2.riftFloor).not.toBeNull();
    const run = s2.riftInstances.find((i) => i.memberIds.has(p2) && i.outcome === 'active');
    expect(run).toBeDefined();
    const i = run as NonNullable<typeof run>;
    expect(i.portalId).toBe(portalId);
    const killAll = () => {
      for (const id of i.mobIds) {
        const m = s2.entities.get(id);
        if (m && !m.dead) {
          m.hp = 0;
          m.dead = true;
        }
      }
      for (let k = 0; k < 26; k++) s2.tick();
    };
    killAll(); // halls cleared: the orb arms and the descent tears open
    expect(i.descentOpen).toBe(true);
    const descent = s2.entities.get(i.descentId as number) as Entity;
    const e0 = s2.entities.get(p2) as Entity;
    e0.prevPos = { ...e0.pos };
    e0.pos = { ...descent.pos };
    s2.rebucket(e0);
    for (let k = 0; k < 40 && i.floorIndex === 0; k++) s2.tick();
    expect(i.floorIndex).toBe(1);
    killAll(); // the pit cleared: Azgorath falls, the run is won
    expect(i.outcome).toBe('won');
    // The way in is gone the moment the run is won.
    expect(s2.entities.has(portalId)).toBe(false);
    expect(i.portalId).toBeNull();
    const exit = s2.entities.get(i.exitId as number) as Entity;
    const e = s2.entities.get(p2) as Entity;
    e.prevPos = { ...e.pos };
    e.pos = s2.groundPos(exit.pos.x, exit.pos.z);
    s2.rebucket(e);
    s2.tick();
    expect(s2.riftFloor).toBeNull();
    // Standing where the portal used to be re-enters nothing.
    walkIn();
    expect(s2.riftFloor).toBeNull();
  });

  it('kills nothing on entry: every mob spawns clear of the walls it fights in', () => {
    const i = inst() as NonNullable<ReturnType<typeof inst>>;
    const floor = generateRiftFloor(seed, 20, 0);
    const colliders = layoutColliders(floor.layout);
    const o = riftInstanceOrigin(i.slot, i.floorIndex);
    expect(i.mobIds.length).toBe(floor.spawns.length);
    for (const id of i.mobIds) {
      const m = sim.entities.get(id) as Entity;
      expect(clears(colliders, m.pos.x - o.x, m.pos.z - o.z, 0.4), `${m.name} embedded`).toBe(true);
    }
  });
});
