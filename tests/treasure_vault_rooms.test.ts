// The one-room treasure vault layout (src/sim/rift/vault_seed.ts + the vault
// branch of rift_gen.ts): a vault seed always generates a single boss room with
// no puzzle, the room and its trash grow with the size tier, everything stays
// inside the rift region, and ordinary rift seeds never read as vaults.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TREASURE_SITES } from '../src/sim/content/treasure_maps';
import { RIFT_REGION_HALF_X, RIFT_REGION_HALF_Z } from '../src/sim/data';
import { polygonIsStarShaped, polygonSelfIntersects } from '../src/sim/geometry2d';
import { buildHoardValleyLayout } from '../src/sim/rift/hoard_valley';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor, isSetPieceSeed, riftFloorCount } from '../src/sim/rift/rift_gen';
import {
  makeVaultSeed,
  OPEN_HOARD_RARITIES,
  VAULT_ZONE_IDS,
  type VaultSizeTier,
  vaultSeedOpen,
  vaultSeedTier,
  vaultSeedZone,
} from '../src/sim/rift/vault_seed';
import { Rng } from '../src/sim/rng';

const TIERS: VaultSizeTier[] = [0, 1, 2, 3];
const LEVELS = [
  RIFT_RANK_BASE_LEVEL.C,
  RIFT_RANK_BASE_LEVEL.B,
  RIFT_RANK_BASE_LEVEL.A,
  RIFT_RANK_BASE_LEVEL.S,
];

function floorHash(seed: number, level: number): string {
  const json = JSON.stringify(generateRiftFloor(seed, level, 0));
  return createHash('sha256').update(json).digest('hex');
}

describe('vault seeds', () => {
  it('round-trips the tier and never collides with the natural seed space', () => {
    for (const tier of TIERS) {
      for (const random of [0, 1, 12345, 0x0fffffff, 0xffffffff]) {
        expect(vaultSeedTier(makeVaultSeed(tier, random))).toBe(tier);
      }
    }
    // Natural and dev portals draw seeds in [1, 1e9] (src/sim/rift/portals.ts).
    for (const seed of [1, 555, 31337, 999_999_999, 1_000_000_000, 0x3fffffff]) {
      expect(vaultSeedTier(seed)).toBeNull();
    }
    expect(vaultSeedTier(0xbfffffff)).toBeNull();
  });

  it('preserves old seeds as caves and round-trips the metadata namespace', () => {
    expect(VAULT_ZONE_IDS).toEqual(TREASURE_SITES.map((site) => site.zoneId));
    expect(makeVaultSeed(3, 0xffffffff)).toBe(0xffffffff);
    const oldSeedWithMetadataBitsSet = makeVaultSeed(2, 0x0f800000);
    expect(vaultSeedOpen(oldSeedWithMetadataBitsSet)).toBe(false);
    expect(vaultSeedZone(oldSeedWithMetadataBitsSet)).toBeNull();

    for (const tier of TIERS) {
      for (const zoneId of VAULT_ZONE_IDS) {
        for (const open of [false, true]) {
          const seed = makeVaultSeed(tier, 0xffffffff, { open, zoneId });
          expect(vaultSeedTier(seed)).toBe(tier);
          expect(vaultSeedOpen(seed)).toBe(open);
          expect(vaultSeedZone(seed)).toBe(zoneId);
        }
      }
    }
    expect(OPEN_HOARD_RARITIES).toEqual(['epic', 'legendary']);
  });

  it('pins the metadata bit layout and treats unknown zone indexes as caves', () => {
    const seed = makeVaultSeed(3, 0x123456, { open: true, zoneId: 'galecrest' });
    expect(seed).toBe(0x7b923456);
    expect(vaultSeedTier(seed)).toBe(3);
    expect(vaultSeedOpen(seed)).toBe(true);
    expect(vaultSeedZone(seed)).toBe('galecrest');

    const unknownZoneSeed = 0x4f800001;
    expect(vaultSeedTier(unknownZoneSeed)).toBe(0);
    expect(vaultSeedOpen(unknownZoneSeed)).toBe(true);
    expect(vaultSeedZone(unknownZoneSeed)).toBeNull();
    expect(generateRiftFloor(unknownZoneSeed, LEVELS[0], 0).outdoor).toBeUndefined();
  });
});

describe('the one-room vault', () => {
  it('is a single puzzle-free boss room that grows with the tier, inside the region', () => {
    const meanLength: number[] = [];
    const meanTrash: number[] = [];
    for (const tier of TIERS) {
      let length = 0;
      let trash = 0;
      const N = 40;
      for (let i = 0; i < N; i++) {
        const seed = makeVaultSeed(tier, 7919 * (i + 1));
        const baseLevel = LEVELS[tier];
        expect(isSetPieceSeed(seed)).toBe(false);
        expect(riftFloorCount(seed, baseLevel)).toBe(1);
        const floor = generateRiftFloor(seed, baseLevel, 0);
        expect(floor.floorCount).toBe(1);
        expect(floor.isBoss).toBe(true);
        expect(floor.puzzle.kind).toBe('none');
        expect(floor.spawns.filter((s) => s.boss)).toHaveLength(1);
        expect(floor.hazards).toEqual([]);
        expect(floor.outdoor).toBeUndefined();
        // Everything the room holds stays inside the rift region.
        expect(floor.layout.zMax).toBeLessThan(RIFT_REGION_HALF_Z);
        for (const spawn of floor.spawns) {
          expect(Math.abs(spawn.x)).toBeLessThan(RIFT_REGION_HALF_X);
          expect(spawn.z).toBeLessThan(RIFT_REGION_HALF_Z);
        }
        // Regenerating from the seed alone gives the same room (both hosts do).
        expect(generateRiftFloor(seed, baseLevel, 0)).toBe(floor);
        length += floor.layout.zMax - floor.layout.zMin;
        trash += floor.spawns.filter((s) => !s.boss).length;
      }
      meanLength.push(length / N);
      meanTrash.push(trash / N);
    }
    for (let tier = 1; tier < 4; tier++) {
      expect(meanLength[tier]).toBeGreaterThan(meanLength[tier - 1] + 15);
      expect(meanTrash[tier]).toBeGreaterThan(meanTrash[tier - 1]);
    }
    // A common map is a short errand; a legendary one a real fight.
    expect(meanTrash[0]).toBeLessThan(9);
    expect(meanTrash[3]).toBeGreaterThan(20);
  });

  it('leaves ordinary rift seeds exactly as they were', () => {
    // Pinned from the generator before the vault branch existed.
    const floor = generateRiftFloor(424242, RIFT_RANK_BASE_LEVEL.C, 0);
    expect(floor.floorCount).toBeGreaterThanOrEqual(2);
    expect(floor.isBoss).toBe(false);
    expect(riftFloorCount(424242)).toBe(floor.floorCount);
    expect(floorHash(424242, RIFT_RANK_BASE_LEVEL.C)).toBe(
      '6a7b514814dea60f31b4af64c10ebffdfe72d992ea3c8adfd0fd20ba520646da',
    );
  });

  it('leaves saved legacy vault plans byte-for-byte unchanged', () => {
    expect(floorHash(3222418518, 20)).toBe(
      'c679b11556af1d6e3224521717e571d64617ed5a3e88245ce8ee0a568757329e',
    );
    expect(floorHash(3635138031, 22)).toBe(
      '9a644445f391aa586573411d3d86836cb508b0dc951435cedfa8d50ef8f39c40',
    );
    expect(floorHash(4010947670, 25)).toBe(
      'c704213221f0a67dd1dcbabcc99ee7c89510a1413ab23f0442b64f5af990f3d5',
    );
  });
});

describe('the hidden valley vault', () => {
  it('starts as a narrow gorge, opens into a wide basin and stays inside its region', () => {
    for (const tier of [2, 3] as const) {
      for (const zoneId of VAULT_ZONE_IDS) {
        const seed = makeVaultSeed(tier, 7919 * (VAULT_ZONE_IDS.indexOf(zoneId) + 1), {
          open: true,
          zoneId,
        });
        const floor = generateRiftFloor(seed, LEVELS[tier], 0);
        expect(floor.outdoor?.zoneId).toBe(zoneId);
        expect(floor.platform).toBeNull();
        expect(floor.layout.shellPolygon).toBeDefined();
        expect(floor.layout.zMax).toBeLessThan(RIFT_REGION_HALF_Z);
        expect(floor.layout.wallX).toBeLessThan(RIFT_REGION_HALF_X);

        const polygon = floor.layout.shellPolygon!;
        const nearestWidth = (z: number) => {
          let nearest = polygon[0];
          for (const point of polygon) {
            if (Math.abs(point.z - z) < Math.abs(nearest.z - z)) nearest = point;
          }
          return Math.abs(nearest.x);
        };
        const gorgeWidth = nearestWidth(floor.outdoor!.gorgeEndZ - 5);
        const valleyWidth = nearestWidth(floor.outdoor!.valleyStartZ + 8);
        expect(gorgeWidth).toBeLessThanOrEqual(10.6);
        expect(valleyWidth).toBeGreaterThan(gorgeWidth + 15);
        expect(polygonSelfIntersects(polygon)).toBe(false);
        expect(polygonIsStarShaped(polygon, floor.layout.shellPole!)).toBe(true);

        for (const point of polygon) {
          expect(Math.abs(point.x)).toBeLessThan(RIFT_REGION_HALF_X);
          expect(Math.abs(point.z)).toBeLessThan(RIFT_REGION_HALF_Z);
        }
        const boss = floor.spawns.find((spawn) => spawn.boss)!;
        expect(boss.z).toBeGreaterThan(floor.outdoor!.valleyStartZ + 40);
        for (const spawn of floor.spawns.filter((candidate) => !candidate.boss)) {
          expect(spawn.z).toBeGreaterThan(floor.outdoor!.valleyStartZ);
          expect(Math.abs(spawn.x)).toBeLessThan(RIFT_REGION_HALF_X);
          expect(spawn.z).toBeLessThan(RIFT_REGION_HALF_Z);
        }
      }
    }
  });

  it('regenerates the same valley from the same local RNG stream', () => {
    const first = buildHoardValleyLayout(new Rng(884422), 3);
    const second = buildHoardValleyLayout(new Rng(884422), 3);
    expect(second.layout).toEqual(first.layout);
    expect(second.colliders).toEqual(first.colliders);
    expect(second.gorgeEndZ).toBe(first.gorgeEndZ);
    expect(second.valleyStartZ).toBe(first.valleyStartZ);
  });

  it('regenerates the complete floor after the floor-plan cache evicts it', () => {
    const seed = makeVaultSeed(3, 12345, { open: true, zoneId: 'palmreach' });
    const first = JSON.stringify(generateRiftFloor(seed, LEVELS[3], 0));
    for (let i = 0; i < 140; i++) generateRiftFloor(100_000 + i, LEVELS[0], 0);
    expect(JSON.stringify(generateRiftFloor(seed, LEVELS[3], 0))).toBe(first);
  });

  it('keeps metadata cave hoards on the original room generator', () => {
    for (const tier of [0, 1] as const) {
      const seed = makeVaultSeed(tier, 99173, {
        open: false,
        zoneId: 'frostveil',
      });
      const floor = generateRiftFloor(seed, LEVELS[tier], 0);
      expect(floor.outdoor).toBeUndefined();
      expect(floor.layout.pillars.length + floor.layout.tombs.length).toBeGreaterThan(0);
    }
  });
});
