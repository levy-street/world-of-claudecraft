import { expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import {
  LAST_KEEP_CANNON,
  NORTH_WATCH_CANNON,
  VEHICLE_STATIONS,
  WORLD_QUEST_CANNON,
  WORLD_QUEST_LAST_KEEP_CANNON,
} from '../src/sim/content/vehicle_stations';
import { CAMPS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  generateDecorationsInBounds,
  groundHeight as terrainHeight,
  WATER_LEVEL,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

it('offers the relocated battery at Wyrmwatch while retaining its existing reward claim identity', () => {
  expect(WORLD_QUEST_CANNON.zoneId).toBe('drakelands');
  expect(WORLD_QUEST_CANNON.id).toBe('wq_evergarden_cannon');
  expect(NORTH_WATCH_CANNON).toMatchObject({ x: 384, z: 1862 });
  const area = WORLD_QUEST_CANNON.area;
  expect(Math.hypot(NORTH_WATCH_CANNON.x - area.x, NORTH_WATCH_CANNON.z - area.z)).toBeLessThan(
    area.radius,
  );
});

it('adds a separate Last Keep battery without moving Wyrmwatch or reusing its reward identity', () => {
  expect(LAST_KEEP_CANNON).toMatchObject({ x: 375, z: 1964 });
  expect(WORLD_QUEST_LAST_KEEP_CANNON.zoneId).toBe('drakelands');
  expect(WORLD_QUEST_LAST_KEEP_CANNON.id).not.toBe(WORLD_QUEST_CANNON.id);
  expect(new Set(VEHICLE_STATIONS.map((station) => station.entityId)).size).toBe(
    VEHICLE_STATIONS.length,
  );
  const area = WORLD_QUEST_LAST_KEEP_CANNON.area;
  expect(Math.hypot(LAST_KEEP_CANNON.x - area.x, LAST_KEEP_CANNON.z - area.z)).toBeLessThan(
    area.radius,
  );
});

it.each(VEHICLE_STATIONS)('places $id on dry ground away from ambient hostile camps', (station) => {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
  expect(terrainHeight(station.x, station.z, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL + 1);
  const nearest = [...sim.entities.values()]
    .filter((entity) => entity.kind === 'mob' && entity.hostile)
    .map((entity) => ({
      id: entity.templateId,
      distance: Math.hypot(entity.pos.x - station.x, entity.pos.z - station.z),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  expect(nearest.distance, JSON.stringify(nearest)).toBeGreaterThan(25);
});

it.each(VEHICLE_STATIONS)(
  'keeps the entire $id firing field dry and free of procedural obstacles',
  (station) => {
    const field = station.field;
    expect(generateDecorationsInBounds(WORLD_SEED, field)).toEqual([]);
    for (let x = field.minX; x <= field.maxX; x++) {
      for (let z = field.minZ; z <= field.maxZ; z++) {
        const height = terrainHeight(x, z, WORLD_SEED);
        expect(height, `${x},${z}`).toBeGreaterThan(WATER_LEVEL + 1);
        expect(Math.abs(height - terrainHeight(x + 1, z, WORLD_SEED))).toBeLessThan(0.6);
        expect(Math.abs(height - terrainHeight(x, z + 1, WORLD_SEED))).toBeLessThan(0.6);
        expect(resolvePosition(WORLD_SEED, x, z, 1), `${x},${z}`).toEqual({ x, z });
      }
    }
    for (const camp of CAMPS) {
      const x = Math.max(field.minX, Math.min(field.maxX, camp.center.x));
      const z = Math.max(field.minZ, Math.min(station.z + 6, camp.center.z));
      expect(Math.hypot(camp.center.x - x, camp.center.z - z) - camp.radius).toBeGreaterThan(15);
    }
  },
);
