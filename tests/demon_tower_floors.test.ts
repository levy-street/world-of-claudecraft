// Canonical three-floor contract: identity, environment, geometry and hazards
// stay together so sim and render cannot quietly describe different towers.

import { describe, expect, it } from 'vitest';
import {
  buildDemonTowerFloor,
  DEMON_TOWER_SEED,
  demonTowerArenaPolygon,
  demonTowerFloorName,
  demonTowerHazards,
} from '../src/sim/content/rift/demon_tower';
import {
  RIFT_BAND_X_MIN,
  RIFT_REGION_HALF_X,
  RIFT_REGION_HALF_Z,
  RIFT_X_MIN,
} from '../src/sim/data';
import { DEMON_TOWER_FLOORS, demonTowerFloorProfile } from '../src/sim/rift/tower_floors';
import { demonTowerWavePlan } from '../src/sim/rift/tower_waves';

function signedArea(points: readonly { x: number; z: number }[]): number {
  return (
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length];
      return area + point.x * next.z - next.x * point.z;
    }, 0) / 2
  );
}

describe('demon tower floor registry', () => {
  it('pins the three identities, environments and culminating bosses', () => {
    expect(
      DEMON_TOWER_FLOORS.map((floor) => ({
        id: floor.id,
        name: floor.name,
        sceneProfile: floor.style.sceneProfile,
        kit: floor.style.kit,
        shape: floor.arena.shape,
        bossId: floor.bossId,
      })),
    ).toEqual([
      {
        id: 'bloodforge',
        name: 'The Bloodforge',
        sceneProfile: 'bloodforge',
        kit: 'bastion',
        shape: 'octagon',
        bossId: 'tower_boss_ash_tyrant',
      },
      {
        id: 'ossuary',
        name: 'The Ossuary of Chains',
        sceneProfile: 'ossuary',
        kit: 'crypt',
        shape: 'ossuary_cross',
        bossId: 'tower_boss_flesh_shaper',
      },
      {
        id: 'void_crown',
        name: 'The Void Crown',
        sceneProfile: 'void_crown',
        kit: 'sanctum',
        shape: 'void_crown',
        bossId: 'tower_boss_demon_lord',
      },
    ]);
  });

  it('gives every floor distinct fog, torch, material and encounter signatures', () => {
    expect(new Set(DEMON_TOWER_FLOORS.map((floor) => floor.style.fog.color)).size).toBe(3);
    expect(new Set(DEMON_TOWER_FLOORS.map((floor) => floor.style.torch.light)).size).toBe(3);
    expect(new Set(DEMON_TOWER_FLOORS.map((floor) => floor.style.wallTint)).size).toBe(3);
    expect(new Set(DEMON_TOWER_FLOORS.map((floor) => floor.style.floorTint)).size).toBe(3);
    expect(DEMON_TOWER_FLOORS.map((floor) => floor.style.fog)).toEqual([
      { color: 0x1d0703, near: 28, far: 156 },
      { color: 0x0c0a1d, near: 24, far: 140 },
      { color: 0x070817, near: 20, far: 184 },
    ]);
    expect(
      new Set(DEMON_TOWER_FLOORS.map((floor) => floor.encounterSignature.join('|'))).size,
    ).toBe(3);
    for (const floor of DEMON_TOWER_FLOORS) {
      expect(floor.encounterSignature).toHaveLength(3);
      expect(floor.subtitle.length).toBeGreaterThan(20);
    }
  });

  it('builds three different CCW silhouettes with authored inner and outer radii', () => {
    expect(
      DEMON_TOWER_FLOORS.map((floor) => ({
        outerRadius: floor.arena.outerRadius,
        innerRadius: floor.arena.innerRadius,
        entryZ: floor.arena.entryZ,
      })),
    ).toEqual([
      { outerRadius: 64, innerRadius: 64, entryZ: -55 },
      { outerRadius: 62, innerRadius: 46, entryZ: -40 },
      { outerRadius: 60, innerRadius: 43, entryZ: -36 },
    ]);
    const expectedVertexCounts = [8, 16, 10];
    for (const [k, floor] of DEMON_TOWER_FLOORS.entries()) {
      const polygon = demonTowerArenaPolygon(k);
      expect(polygon).toHaveLength(expectedVertexCounts[k]);
      expect(signedArea(polygon)).toBeGreaterThan(0);
      const radii = polygon.map((point) => Math.hypot(point.x, point.z));
      expect(Math.max(...radii)).toBeCloseTo(floor.arena.outerRadius, 2);
      expect(Math.min(...radii)).toBeCloseTo(floor.arena.innerRadius, 2);
    }
    expect(DEMON_TOWER_FLOORS.map((floor) => floor.arena.shape)).toEqual([
      'octagon',
      'ossuary_cross',
      'void_crown',
    ]);
  });

  it('pins three mechanically different deterministic hazard fields', () => {
    const hazards = [0, 1, 2].map(demonTowerHazards);
    expect(hazards.map((zones) => zones.length)).toEqual([2, 4, 5]);
    expect(hazards[0].every((zone) => zone.tier === 'shallow')).toBe(true);
    expect(hazards[0].some((zone) => zone.rx !== zone.rz)).toBe(true);
    expect(hazards[1].every((zone) => zone.tier === 'deep' && zone.rx === zone.rz)).toBe(true);
    expect(hazards[2].every((zone) => zone.tier === 'deep')).toBe(true);
    expect(new Set(hazards.map((zones) => JSON.stringify(zones))).size).toBe(3);
    expect(hazards[0]).toEqual([
      { x: -20, z: -4, r: 6, rx: 4.8, rz: 24, tier: 'shallow' },
      { x: 20, z: -4, r: 6, rx: 4.8, rz: 24, tier: 'shallow' },
    ]);
    expect(hazards[1]).toEqual([
      { x: -20, z: -20, r: 9.2, rx: 9.2, rz: 9.2, tier: 'deep' },
      { x: 20, z: -20, r: 9.2, rx: 9.2, rz: 9.2, tier: 'deep' },
      { x: -20, z: 20, r: 9.2, rx: 9.2, rz: 9.2, tier: 'deep' },
      { x: 20, z: 20, r: 9.2, rx: 9.2, rz: 9.2, tier: 'deep' },
    ]);
    expect(hazards[2]).toEqual([
      { x: 23.511, z: 32.361, r: 6.4, rx: 6.4, rz: 6.4, tier: 'deep' },
      { x: 38.042, z: -12.361, r: 6.4, rx: 6.4, rz: 6.4, tier: 'deep' },
      { x: 0, z: -40, r: 6.4, rx: 6.4, rz: 6.4, tier: 'deep' },
      { x: -38.042, z: -12.361, r: 6.4, rx: 6.4, rz: 6.4, tier: 'deep' },
      { x: -23.511, z: 32.361, r: 6.4, rx: 6.4, rz: 6.4, tier: 'deep' },
    ]);
    expect([0, 1, 2].map(demonTowerHazards)).toEqual(hazards);
  });

  it('pins representative doubled decor and wave placements on every floor', () => {
    const decorKeys = [
      'tower_bloodforge_furnace',
      'tower_ossuary_bone_organ',
      'tower_void_crown_spire',
    ];
    expect(
      [0, 1, 2].map((floorIndex) => {
        const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, floorIndex);
        const item = floor.layout.decor?.find((entry) => entry.key === decorKeys[floorIndex]);
        return item && { key: item.key, x: item.x, z: item.z };
      }),
    ).toEqual([
      { key: 'tower_bloodforge_furnace', x: -44, z: 18 },
      { key: 'tower_ossuary_bone_organ', x: -44, z: 0 },
      { key: 'tower_void_crown_spire', x: 0, z: 55 },
    ]);
    expect([0, 1, 2].map((floorIndex) => demonTowerWavePlan(floorIndex)[0].spawns[0])).toEqual([
      { templateId: 'tower_imp', x: 0, z: 39.68 },
      { templateId: 'tower_gloom_bat', x: -1.6, z: 27.677 },
      { templateId: 'tower_abyss_knight', x: -5.661, z: 28.458 },
    ]);
  });

  it('keeps every doubled arena feature inside the active rift region', () => {
    expect(RIFT_REGION_HALF_X).toBe(68);
    expect(RIFT_X_MIN - RIFT_REGION_HALF_X).toBe(RIFT_BAND_X_MIN);
    let maxFeatureX = 0;
    for (let floorIndex = 0; floorIndex < DEMON_TOWER_FLOORS.length; floorIndex++) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, floorIndex);
      const points = [
        ...(floor.layout.shellPolygon ?? []),
        ...(floor.layout.decor ?? []),
        ...floor.hazards.flatMap((hazard) => {
          const rx = hazard.rx ?? hazard.r;
          const rz = hazard.rz ?? hazard.r;
          return [
            { x: hazard.x - rx, z: hazard.z - rz },
            { x: hazard.x + rx, z: hazard.z + rz },
          ];
        }),
        ...floor.objects,
        floor.entry,
        ...demonTowerWavePlan(floorIndex).flatMap((wave) => wave.spawns),
      ];
      for (const point of points) {
        maxFeatureX = Math.max(maxFeatureX, Math.abs(point.x));
        expect(Math.abs(point.x), `floor ${floorIndex + 1} x=${point.x}`).toBeLessThanOrEqual(
          RIFT_REGION_HALF_X,
        );
        expect(Math.abs(point.z), `floor ${floorIndex + 1} z=${point.z}`).toBeLessThanOrEqual(
          RIFT_REGION_HALF_Z,
        );
      }
    }
    expect(maxFeatureX + 4).toBeLessThanOrEqual(RIFT_REGION_HALF_X);
  });

  it('builds plans that retain their registry identity without procedural drift', () => {
    for (const [k, profile] of DEMON_TOWER_FLOORS.entries()) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, k);
      expect(floor).toEqual(buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, k));
      expect(floor.floorIndex).toBe(k);
      expect(floor.floorCount).toBe(3);
      expect(floor.name).toBe(demonTowerFloorName(k));
      expect(floor.themeName).toBe(profile.name);
      expect(floor.style.sceneProfile).toBe(profile.style.sceneProfile);
      expect(floor.layout.shellPolygon).toEqual(demonTowerArenaPolygon(k));
      expect(floor.hazards).toEqual(demonTowerHazards(k));
      expect(floor.entry).toEqual({ x: 0, z: profile.arena.entryZ });
      expect(floor.objects.some((object) => object.kind === 'treasure')).toBe(false);
      if (k < 2) {
        expect(floor.objects).toContainEqual(
          expect.objectContaining({ kind: 'descent', name: 'Tower Ascent' }),
        );
      }
    }
  });

  it('clamps registry access without mutating canonical records', () => {
    expect(demonTowerFloorProfile(-100)).toBe(DEMON_TOWER_FLOORS[0]);
    expect(demonTowerFloorProfile(100)).toBe(DEMON_TOWER_FLOORS[2]);
    expect(demonTowerFloorProfile(Number.NaN)).toBe(DEMON_TOWER_FLOORS[0]);
    const snapshot = JSON.stringify(DEMON_TOWER_FLOORS);
    demonTowerFloorProfile(0);
    demonTowerFloorProfile(2);
    expect(JSON.stringify(DEMON_TOWER_FLOORS)).toBe(snapshot);
  });
});
