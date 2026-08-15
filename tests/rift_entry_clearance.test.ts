// Arriving on a rift floor must never pull a pack. Rift floors are generated, so unlike
// the authored dungeons (pinned coordinate-by-coordinate in dungeon_entry_clearance.test.ts)
// the clearance has to hold for EVERY seed, rank and depth, including the hand-authored
// Infernal Citadel set piece that short-circuits the procedural chain.
//
// Why the clearance is aggro radius PLUS wander radius, not just aggro radius: mob aggro is
// a pure radius check with no line-of-sight gate (mob/locomotion.ts idle scan), so the
// entrance porch wall does not help, and rift trash sits at level 22 to 23 against the
// level 20 player cap, which drives `aggroRadius + leveldiff * 1.5` up to the clamp. An
// idle mob then drifts up to MAX_WANDER_RADIUS off its spawn, so clearing only the aggro
// radius would hold at the instant of arrival and decay as the front pack wandered in.
import { describe, expect, it } from 'vitest';
import { MAX_AGGRO_RADIUS, MAX_WANDER_RADIUS } from '../src/sim/mob/locomotion';
import {
  isClearOfRiftEntry,
  RIFT_ENTRY_CLEAR_RADIUS,
  riftMinSpawnZ,
} from '../src/sim/rift/entry_clearance';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import {
  generateRiftFloor,
  isSetPieceRift,
  isSetPieceSeed,
  riftFloorCount,
} from '../src/sim/rift/rift_gen';
import { buildHeuristicRiftUpgrade, buildRiftDungeonDraft } from '../src/sim/rift/upgrader_draft';
import type { RiftTier } from '../src/sim/types';

const TIERS: RiftTier[] = ['C', 'B', 'A', 'S'];

describe('rift entry clearance: the constant', () => {
  it('is the aggro ceiling plus the wander ring, imported not re-typed', () => {
    // Pinning the composition (not the literal 29) is the point: retuning either term in
    // locomotion.ts must move the rift clearance with it, or the pull comes back silently.
    expect(RIFT_ENTRY_CLEAR_RADIUS).toBe(MAX_AGGRO_RADIUS + MAX_WANDER_RADIUS);
    expect(RIFT_ENTRY_CLEAR_RADIUS).toBeGreaterThan(MAX_AGGRO_RADIUS);
  });

  it('riftMinSpawnZ offsets the arrival z by exactly the clearance', () => {
    expect(riftMinSpawnZ(-11)).toBe(-11 + RIFT_ENTRY_CLEAR_RADIUS);
    expect(riftMinSpawnZ(0)).toBe(RIFT_ENTRY_CLEAR_RADIUS);
  });

  it('isClearOfRiftEntry rejects inside, accepts on the boundary and beyond', () => {
    const entry = { x: 0, z: -11 };
    // Just inside the ring on the z axis, and the same distance out on the x axis.
    expect(isClearOfRiftEntry(entry, 0, -11 + RIFT_ENTRY_CLEAR_RADIUS - 0.1)).toBe(false);
    expect(isClearOfRiftEntry(entry, RIFT_ENTRY_CLEAR_RADIUS - 0.1, -11)).toBe(false);
    // Exactly on the boundary is clear: detection is strict (d < radius) in locomotion.ts.
    expect(isClearOfRiftEntry(entry, 0, -11 + RIFT_ENTRY_CLEAR_RADIUS)).toBe(true);
    // An x offset only ever increases the true distance, which is why a z floor is enough.
    expect(isClearOfRiftEntry(entry, 14, -11 + RIFT_ENTRY_CLEAR_RADIUS)).toBe(true);
  });
});

describe('rift entry clearance: no generated spawn can pull the arrival point', () => {
  for (const tier of TIERS) {
    const baseLevel = RIFT_RANK_BASE_LEVEL[tier];
    it(`${tier} rank: every spawn on every floor clears the entry`, () => {
      let checkedFloors = 0;
      let checkedSpawns = 0;
      for (let seed = 1; seed <= 120; seed++) {
        const floors = riftFloorCount(seed, baseLevel);
        for (let f = 0; f < floors; f++) {
          const floor = generateRiftFloor(seed, baseLevel, f);
          checkedFloors++;
          for (const sp of floor.spawns) {
            checkedSpawns++;
            const dist = Math.hypot(sp.x - floor.entry.x, sp.z - floor.entry.z);
            expect(
              dist,
              `${tier} seed ${seed} floor ${f}: ${sp.templateId} at (${sp.x}, ${sp.z}) is ` +
                `${dist.toFixed(1)} yd from entry (${floor.entry.x}, ${floor.entry.z}), ` +
                `inside the ${RIFT_ENTRY_CLEAR_RADIUS} yd clearance`,
            ).toBeGreaterThanOrEqual(RIFT_ENTRY_CLEAR_RADIUS);
          }
        }
      }
      // Guard the guard: a generator that returned no spawns would pass vacuously.
      expect(checkedFloors).toBeGreaterThan(100);
      expect(checkedSpawns).toBeGreaterThan(400);
    });
  }

  it('survives the Dungeon Upgrader manifest every natural portal carries', () => {
    // The upgraded floor is what a player actually enters, so the raw generator holding
    // the line is only half the guarantee: applyRiftUpgrade re-rosters and can DROP
    // spawns ('breather' pacing), and a future edit that also repositioned them would
    // reintroduce the pull on the path that ships. Pinned over the real heuristic
    // manifest rather than a hand-built one.
    let checkedSpawns = 0;
    let upgradedFloors = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const tier of TIERS) {
        const baseLevel = RIFT_RANK_BASE_LEVEL[tier];
        const upgrade = buildHeuristicRiftUpgrade(buildRiftDungeonDraft(seed, baseLevel));
        if (!upgrade) continue;
        upgradedFloors++;
        for (let f = 0; f < riftFloorCount(seed, baseLevel); f++) {
          const floor = generateRiftFloor(seed, baseLevel, f, upgrade);
          for (const sp of floor.spawns) {
            checkedSpawns++;
            const dist = Math.hypot(sp.x - floor.entry.x, sp.z - floor.entry.z);
            expect(
              dist,
              `upgraded ${tier} seed ${seed} floor ${f}: ${sp.templateId} at (${sp.x}, ${sp.z}) ` +
                `is ${dist.toFixed(1)} yd from entry, inside the ` +
                `${RIFT_ENTRY_CLEAR_RADIUS} yd clearance`,
            ).toBeGreaterThanOrEqual(RIFT_ENTRY_CLEAR_RADIUS);
          }
        }
      }
    }
    // Guard the guard: a manifest builder that returned null everywhere, or an upgrade
    // that emptied the spawn lists, would otherwise pass this vacuously.
    expect(upgradedFloors).toBeGreaterThan(50);
    expect(checkedSpawns).toBeGreaterThan(400);
  });

  it('the authored Infernal Citadel clears the entry on both of its floors', () => {
    let seed = -1;
    for (let s = 1; s < 400 && seed < 0; s++) if (isSetPieceSeed(s)) seed = s;
    expect(seed, 'found a set-piece seed').toBeGreaterThan(0);
    // The citadel only opens at C; this asserts we are really exercising the authored
    // branch and not silently falling through to a procedural floor.
    const baseLevel = RIFT_RANK_BASE_LEVEL.C;
    expect(isSetPieceRift(seed, baseLevel), 'the citadel opens at C').toBe(true);

    let checkedSpawns = 0;
    for (let f = 0; f < riftFloorCount(seed, baseLevel); f++) {
      const floor = generateRiftFloor(seed, baseLevel, f);
      expect(floor.spawns.length, `citadel floor ${f} has spawns`).toBeGreaterThan(0);
      for (const sp of floor.spawns) {
        checkedSpawns++;
        const dist = Math.hypot(sp.x - floor.entry.x, sp.z - floor.entry.z);
        expect(
          dist,
          `citadel floor ${f}: ${sp.templateId} at (${sp.x}, ${sp.z}) is ${dist.toFixed(1)} yd ` +
            `from entry (${floor.entry.x}, ${floor.entry.z}), inside the ` +
            `${RIFT_ENTRY_CLEAR_RADIUS} yd clearance`,
        ).toBeGreaterThanOrEqual(RIFT_ENTRY_CLEAR_RADIUS);
      }
    }
    expect(checkedSpawns).toBeGreaterThan(15);
  });
});
