import { describe, expect, it } from 'vitest';
import type { Collider } from '../src/sim/colliders';
import { RIFT_THEMES } from '../src/sim/content/rift/themes';
import { DUNGEON_WALL_X } from '../src/sim/dungeon_layout';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import {
  generateRiftFloor,
  generateRiftPlan,
  isSetPieceSeed,
  riftFloorColliders,
  riftFloorCount,
} from '../src/sim/rift/rift_gen';

const BODY_R = 0.6;

function clears(colliders: readonly Collider[], x: number, z: number, r = BODY_R): boolean {
  for (const c of colliders) {
    if (c.type === 'circle') {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + r) * (c.r + r)) return false;
    } else {
      // Rotated OBB in the box's local frame, matching colliders.ts pushOut
      // (rotY(dx, dz, -rot) == (dx*cos(rot) - dz*sin(rot), dx*sin(rot) + dz*cos(rot))).
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

describe('rift generator: determinism', () => {
  it('regenerates byte-identical floors for the same descriptor', () => {
    // Force cache eviction (limit 128) between the two reads so this proves pure
    // regeneration, not just a cached object identity.
    const a = JSON.stringify(generateRiftFloor(12345, 15, 1));
    for (let s = 0; s < 200; s++) generateRiftFloor(s, 15, 0);
    const b = JSON.stringify(generateRiftFloor(12345, 15, 1));
    expect(b).toBe(a);
  });

  it('is independent of the live sim rng (own seeded stream)', () => {
    const first = JSON.stringify(generateRiftFloor(777, 20, 2));
    // Interleave unrelated generations; the target floor must be unchanged.
    generateRiftPlan(999, 5);
    generateRiftFloor(1, 1, 0);
    const second = JSON.stringify(generateRiftFloor(777, 20, 2));
    expect(second).toBe(first);
  });

  it('floor count is stable and within bounds', () => {
    for (let s = 0; s < 300; s++) {
      // The authored set-piece citadel is deliberately a fixed two-floor
      // descent; the procedural bounds below only describe generated descents.
      if (isSetPieceSeed(s)) {
        expect(riftFloorCount(s)).toBe(2);
        continue;
      }
      const n = riftFloorCount(s);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
      expect(riftFloorCount(s)).toBe(n);
    }
  });
});

describe('rift generator: variety', () => {
  it('produces many distinct rift names and themes across seeds', () => {
    const names = new Set<string>();
    const themes = new Set<string>();
    const bossThemes = new Set<string>();
    for (let s = 0; s < 200; s++) {
      if (isSetPieceSeed(s)) continue; // the citadel has its own name + theme
      const plan = generateRiftPlan(s, 15);
      names.add(plan.name);
      bossThemes.add(plan.themeId);
      for (let f = 0; f < plan.floorCount; f++) {
        themes.add(generateRiftFloor(s, 15, f).themeName);
      }
    }
    // Names combine 8 themes x 4 nouns x 8 suffixes = plenty of distinct strings.
    expect(names.size).toBeGreaterThan(40);
    // Every authored theme should surface as a floor across 200 seeds.
    expect(themes.size).toBe(RIFT_THEMES.length);
    expect(bossThemes.size).toBeGreaterThan(4);
  });

  it('varies geometry (width, length, obstacle counts) across seeds', () => {
    const widths = new Set<number>();
    const lengths = new Set<number>();
    const pillarCounts = new Set<number>();
    for (let s = 0; s < 120; s++) {
      const fl = generateRiftFloor(s, 15, 0);
      widths.add(fl.layout.wallX ?? DUNGEON_WALL_X);
      lengths.add(fl.layout.zMax - fl.layout.zMin);
      pillarCounts.add(fl.layout.pillars.length);
    }
    expect(widths.size).toBeGreaterThan(3);
    expect(lengths.size).toBeGreaterThan(10);
    expect(pillarCounts.size).toBeGreaterThan(5);
  });

  it('produces non-rectangular room shapes (not just plain rectangles)', () => {
    let polygonFloors = 0;
    let total = 0;
    const distinctWidthProfiles = new Set<string>();
    for (let s = 0; s < 120; s++) {
      const n = riftFloorCount(s);
      for (let f = 0; f < n; f++) {
        const fl = generateRiftFloor(s, 15, f);
        total++;
        if (fl.layout.shellPolygon) {
          polygonFloors++;
          // fingerprint the silhouette by its rounded half-width samples
          distinctWidthProfiles.add(
            fl.layout.shellPolygon
              .filter((p) => p.x >= 0)
              .map((p) => Math.round(p.x))
              .join(','),
          );
        }
      }
    }
    // The large majority of floors should be shaped rooms, not rectangles.
    expect(polygonFloors / total).toBeGreaterThan(0.5);
    // ...and those silhouettes should be highly varied.
    expect(distinctWidthProfiles.size).toBeGreaterThan(30);
  });

  it('boss floors give the giant boss an open arena (dais fits the room width)', () => {
    for (let s = 0; s < 120; s++) {
      const n = riftFloorCount(s);
      const fl = generateRiftFloor(s, 15, n - 1);
      // The dais radius never exceeds the room half-width at the boss end.
      const backWidth = fl.layout.shellPolygon
        ? Math.max(...fl.layout.shellPolygon.map((p) => Math.abs(p.x)))
        : (fl.layout.wallX ?? DUNGEON_WALL_X);
      expect(fl.layout.dais.r).toBeLessThanOrEqual(backWidth);
      expect(fl.layout.dais.r).toBeGreaterThanOrEqual(6);
    }
  });

  it('uses varied boss types across seeds', () => {
    const bosses = new Set<string>();
    for (let s = 0; s < 200; s++) {
      const n = riftFloorCount(s);
      const boss = generateRiftFloor(s, 15, n - 1).spawns.find((sp) => sp.boss);
      if (boss) bosses.add(boss.templateId);
    }
    expect(bosses.size).toBeGreaterThan(4);
  });
});

describe('rift generator: playability', () => {
  // The procedural invariants below (one nave, a clear central spine, a dais at the
  // far end) describe GENERATED floors. The authored citadel is a room graph with
  // no spine; tests/rift_infernal.test.ts pins its own walkability.
  const cases: Array<[number, number, number]> = [];
  for (let s = 0; s < 60; s++) {
    if (isSetPieceSeed(s)) continue;
    const n = riftFloorCount(s);
    for (let f = 0; f < n; f++) cases.push([s, 15, f]);
  }

  it('every floor is walkable and correctly gated', () => {
    for (const [seed, base, f] of cases) {
      const fl = generateRiftFloor(seed, base, f);
      const colliders = riftFloorColliders(seed, base, f);
      const wallX = fl.layout.wallX ?? DUNGEON_WALL_X;

      // Entry clears.
      expect(clears(colliders, fl.entry.x, fl.entry.z), `entry seed ${seed} f${f}`).toBe(true);

      // The centre spine from entry to dais is fully walkable (a guaranteed path).
      for (let z = fl.entry.z; z <= fl.layout.dais.z; z += 2) {
        expect(clears(colliders, 0, z), `spine seed ${seed} f${f} z${z}`).toBe(true);
      }

      // Every spawn is clear and inside the room.
      for (const sp of fl.spawns) {
        expect(Math.abs(sp.x)).toBeLessThan(wallX);
        expect(sp.z).toBeGreaterThan(fl.layout.zMin);
        expect(sp.z).toBeLessThan(fl.layout.zMax);
        expect(clears(colliders, sp.x, sp.z), `spawn seed ${seed} f${f} @${sp.x},${sp.z}`).toBe(
          true,
        );
        expect(sp.level).toBeGreaterThanOrEqual(1);
        expect(sp.level).toBeLessThanOrEqual(60);
      }

      // Every object is clear and inside the room.
      for (const ob of fl.objects) {
        expect(Math.abs(ob.x)).toBeLessThan(wallX);
        expect(clears(colliders, ob.x, ob.z), `object ${ob.kind} seed ${seed} f${f}`).toBe(true);
      }

      // Gating: non-boss floors have a descent; boss floors have exactly one boss + a chest.
      if (fl.isBoss) {
        expect(fl.spawns.filter((sp) => sp.boss).length).toBe(1);
        expect(fl.objects.some((o) => o.kind === 'chest')).toBe(true);
        expect(fl.objects.some((o) => o.kind === 'descent')).toBe(false);
      } else {
        expect(fl.objects.some((o) => o.kind === 'descent')).toBe(true);
        expect(fl.spawns.some((sp) => sp.boss)).toBe(false);
      }

      // rune_pylons puzzle places the declared number of pylons.
      if (fl.puzzle.kind === 'rune_pylons') {
        expect(fl.objects.filter((o) => o.kind === 'rune_pylon').length).toBe(fl.puzzle.pylonCount);
      }
    }
  });

  it('the boss floor is always the last floor', () => {
    for (let s = 0; s < 80; s++) {
      const n = riftFloorCount(s);
      for (let f = 0; f < n; f++) {
        expect(generateRiftFloor(s, 15, f).isBoss).toBe(f === n - 1);
      }
    }
  });
});

describe('rift generator: objectives are never inside (or hidden by) a wall', () => {
  // Per-kind prop clearance radii mirroring the toClear margins the generator
  // passes when it places each interactable (a rune monolith is fatter than a
  // body). Every objective must clear every collider by its prop radius, and no
  // layout may carry a phantom (illusion) wall, so collider clearance IS visual
  // clearance: a rune can never render embedded in, or tucked behind, a wall.
  // Per-kind prop clearance radii: the three values below match the explicit
  // toClear margin the generator passes; the rest use the player body radius
  // (BODY_R = 0.6) because they are placed on the always-clear spine or within
  // the obstacle-free AISLE_HALF band (|x| <= 5.5) by construction.
  const PROP_R: Record<string, number> = {
    rune_pylon: 1.7,
    seq_rune: 1.5,
    treasure: 1.0,
    // The kinds below are placed on the always-clear centre spine (x=0) or
    // within the obstacle-free AISLE_HALF band (|x| <= 5.5) by construction,
    // so BODY_R (0.6) is the correct clearance check at their placement point:
    // their visual footprint may be wider (boulder dodecahedron r=1.1, switch
    // cylinder r=1.3, ice_goal disc r=1.7) but they are never placed near a
    // wall. infernal_orb is authored at a fixed altar position inside the
    // always-open citadel hall; it only appears on set-piece seeds which are
    // skipped by the seed loop below, but is listed here for completeness.
    chest: 0.6,
    descent: 0.6,
    gate: 0.6,
    switch: 0.6,
    boulder: 0.6,
    boulder_pad: 0.6,
    ice_goal: 0.6,
    infernal_orb: 0.6,
  };

  it('every interactable clears the walls by its prop radius, at every rank', () => {
    for (const baseLevel of [20, 22, 25, 28]) {
      for (let s = 0; s < 60; s++) {
        if (isSetPieceSeed(s)) continue;
        const n = riftFloorCount(s);
        for (let f = 0; f < n; f++) {
          const fl = generateRiftFloor(s, baseLevel, f);
          const colliders = riftFloorColliders(s, baseLevel, f);
          expect(fl.layout.illusionWalls ?? [], `phantom wall seed ${s} f${f}`).toHaveLength(0);
          for (const ob of fl.objects) {
            const r = PROP_R[ob.kind] ?? BODY_R;
            expect(
              clears(colliders, ob.x, ob.z, r),
              `${ob.kind} seed ${s} f${f} base ${baseLevel} @${ob.x},${ob.z}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

describe('rift generator: balance', () => {
  it('floor level rises monotonically with depth and stays in band', () => {
    for (let s = 0; s < 60; s++) {
      const n = riftFloorCount(s);
      let prev = 0;
      for (let f = 0; f < n; f++) {
        const lvl = generateRiftFloor(s, 22, f).spawns[0]?.level ?? 0;
        expect(lvl).toBeGreaterThanOrEqual(prev);
        expect(lvl).toBeLessThanOrEqual(60);
        prev = lvl;
      }
    }
  });

  it('every floor has at least two trash packs worth of enemies', () => {
    for (let s = 0; s < 60; s++) {
      const n = riftFloorCount(s);
      for (let f = 0; f < n; f++) {
        const fl = generateRiftFloor(s, 15, f);
        expect(fl.spawns.length).toBeGreaterThanOrEqual(fl.isBoss ? 3 : 4);
      }
    }
  });
});

describe('rift runtime placements: exit portal and sealed cache are inside the room', () => {
  // openExit() in runs.ts spawns two objects whose positions are computed at
  // runtime (not by the generator): the rift exit portal and the Sealed Rift
  // Cache. Their local positions mirror:
  //   const chest = floor.objects.find(o => o.kind === 'chest');
  //   const pos = chest ?? { x: 0, z: floor.layout.dais.z + 6 };
  //   exit at (pos.x, pos.z), cache at (pos.x - 4, pos.z)
  // Both must land inside the room polygon and clear every wall collider by
  // at least BODY_R (0.6), across all procedural boss floors and all four
  // rank base levels (20/22/25/28).

  // Inline containment helper: polygon branch if shellPolygon is present
  // (star-shaped room), rectangle branch otherwise. Matches the pattern from
  // tests/rift_wall_solidity.test.ts.
  function insideRoom(fl: ReturnType<typeof generateRiftFloor>, x: number, z: number): boolean {
    const { layout } = fl;
    if (layout.shellPolygon) {
      return polygonContainsPoint(layout.shellPolygon, x, z);
    }
    const wx = layout.wallX ?? DUNGEON_WALL_X;
    return Math.abs(x) < wx && z > layout.zMin && z < layout.zMax;
  }

  it('exit portal and sealed cache land inside the room at every rank', () => {
    for (const baseLevel of [20, 22, 25, 28]) {
      for (let s = 0; s < 60; s++) {
        if (isSetPieceSeed(s)) continue;
        const n = riftFloorCount(s);
        const bossFloor = n - 1;
        const fl = generateRiftFloor(s, baseLevel, bossFloor);
        if (!fl.isBoss) continue; // defensive: boss is always last
        const colliders = riftFloorColliders(s, baseLevel, bossFloor);
        // Mirror the openExit position logic from runs.ts.
        const chest = fl.objects.find((o) => o.kind === 'chest');
        const pos = chest ?? { x: 0, z: fl.layout.dais.z + 6 };
        const exitX = pos.x;
        const exitZ = pos.z;
        const cacheX = pos.x - 4;
        const cacheZ = pos.z;
        expect(
          insideRoom(fl, exitX, exitZ),
          `exit inside room seed ${s} base ${baseLevel} @${exitX},${exitZ}`,
        ).toBe(true);
        expect(
          clears(colliders, exitX, exitZ),
          `exit clears walls seed ${s} base ${baseLevel} @${exitX},${exitZ}`,
        ).toBe(true);
        expect(
          insideRoom(fl, cacheX, cacheZ),
          `cache inside room seed ${s} base ${baseLevel} @${cacheX},${cacheZ}`,
        ).toBe(true);
        expect(
          clears(colliders, cacheX, cacheZ),
          `cache clears walls seed ${s} base ${baseLevel} @${cacheX},${cacheZ}`,
        ).toBe(true);
      }
    }
  });
});
