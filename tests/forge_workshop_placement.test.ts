import { expect, it } from 'vitest';
import { objectInteractionRange } from '../src/game/interactions';
import { resolvePosition } from '../src/sim/colliders';
import { DRAKELANDS_PROPS } from '../src/sim/content/drakelands';
import { EVERGARDEN_PROPS } from '../src/sim/content/evergarden';
import { FORGE_WORKSHOP_DRESSING } from '../src/sim/content/forge_workshop_dressing';
import {
  FORGE_INTERACT_RANGE,
  FORGE_NPC_DEF,
  FORGE_STATIONS,
  WORLD_QUEST_FORGING,
} from '../src/sim/content/world_quest_forging';
import { CAMPS, PROPS } from '../src/sim/data';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

it('separates all four workshop supplies while keeping them clickable from Mara', () => {
  expect(WORLD_QUEST_FORGING.zoneId).toBe('drakelands');
  expect(FORGE_NPC_DEF.pos).toEqual({ x: 428, z: 1889 });
  expect(FORGE_STATIONS).toHaveLength(4);
  expect(FORGE_INTERACT_RANGE).toBe(22);
  for (const station of FORGE_STATIONS) {
    expect(Math.hypot(station.x - 428, station.z - 1893)).toBeLessThan(FORGE_INTERACT_RANGE);
    expect(objectInteractionRange({ templateId: `ground_${station.objectItemId}` })).toBe(
      FORGE_INTERACT_RANGE,
    );
    for (const other of FORGE_STATIONS) {
      if (other === station) continue;
      expect(Math.hypot(station.x - other.x, station.z - other.z)).toBeGreaterThanOrEqual(5);
    }
  }
  expect(objectInteractionRange({ templateId: 'supply_crate' })).toBe(5);
});

it('relocates the smithy to Wyrmwatch and brings the well into the work area', () => {
  const byId = Object.fromEntries(FORGE_STATIONS.map((station) => [station.id, station]));
  expect(byId.tools).toMatchObject({ x: 431.86, z: 1891.08 });
  expect(byId.fuel).toMatchObject({ x: 431, z: 1883 });
  expect(byId.metal).toMatchObject({ x: 431, z: 1899 });
  expect(byId.water).toMatchObject({ x: 419, z: 1891 });
  expect(PROPS.decorProps?.some((prop) => prop.key === 'workshopForge')).toBe(false);
  expect(
    PROPS.decorProps?.some(
      (prop) => prop.key === 'hexrBlacksmith' && prop.x === 435 && prop.z === 1891,
    ),
  ).toBe(true);
  expect(Math.hypot(byId.water.x - 428, byId.water.z - 1889)).toBeLessThan(10);
  for (const prop of FORGE_WORKSHOP_DRESSING) {
    expect(PROPS.decorProps).toContainEqual(prop);
    if (prop.key === 'hexSack') {
      expect(prop.terrainCalm).toBe(false);
    }
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const h = groundHeight(prop.x + dx, prop.z + dz, WORLD_SEED);
      expect(h).toBeGreaterThan(WATER_LEVEL + 1);
      expect(Math.abs(h - groundHeight(prop.x + dx + 1, prop.z + dz, WORLD_SEED))).toBeLessThan(
        0.6,
      );
    }
  }
});

it('keeps workshop fixtures on dry walkable ground clear of colliders and hostile camps', () => {
  // The built-in anvil and the town well are inside colliders: clicked remotely.
  const points = [
    ...FORGE_STATIONS.filter((station) => station.id !== 'tools' && station.id !== 'water'),
    FORGE_NPC_DEF.pos,
    { x: 428, z: 1893 },
  ];
  for (const point of points) {
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = point.x + dx;
      const z = point.z + dz;
      const height = groundHeight(x, z, WORLD_SEED);
      expect(height, `${x},${z}`).toBeGreaterThan(WATER_LEVEL + 1);
      expect(Math.abs(height - groundHeight(x + 1, z, WORLD_SEED))).toBeLessThan(0.6);
      expect(Math.abs(height - groundHeight(x, z + 1, WORLD_SEED))).toBeLessThan(0.6);
      expect(resolvePosition(WORLD_SEED, x, z, 1), `${x},${z}`).toEqual({ x, z });
    }
    for (const camp of CAMPS) {
      expect(
        Math.hypot(camp.center.x - point.x, camp.center.z - point.z) - camp.radius,
      ).toBeGreaterThan(15);
    }
  }
});

it('moves scenery out of Evergarden and leaves the Last Keep gate passage open', () => {
  for (const prop of FORGE_WORKSHOP_DRESSING) {
    expect(DRAKELANDS_PROPS.decorProps).toContainEqual(prop);
    expect(EVERGARDEN_PROPS.decorProps).not.toContainEqual(prop);
  }
  for (let x = 366; x <= 390; x += 0.25) {
    expect(resolvePosition(WORLD_SEED, x, 2030, 0.7)).toEqual({ x, z: 2030 });
  }
});
