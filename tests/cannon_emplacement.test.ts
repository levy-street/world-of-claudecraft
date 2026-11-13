import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { CANNON_EMPLACEMENT_PROPS } from '../src/sim/content/cannon_emplacement';
import { STUDIO_REWORK_PROP_EDITS } from '../src/sim/content/studio_rework_props';
import { NORTH_WATCH_CANNON, VEHICLE_STATIONS } from '../src/sim/content/vehicle_stations';
import { PROPS } from '../src/sim/data';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

it('registers a bounded artillery dressing set using shipped non-explosive props', () => {
  expect(CANNON_EMPLACEMENT_PROPS).toHaveLength(7 * VEHICLE_STATIONS.length);
  // The Studio town rework (#4593) took the North Watch battery's seven dressing
  // props off the map: each is retired by its own studio prop edit, so the live
  // props carry only the other stations' sets.
  const retired = (p: { x: number; z: number }) =>
    STUDIO_REWORK_PROP_EDITS.some(
      (e) => e.table === 'decorProps' && e.remove && e.at.x === p.x && e.at.z === p.z,
    );
  const atNorthWatch = (p: { x: number; z: number }) =>
    Math.hypot(p.x - NORTH_WATCH_CANNON.x, p.z - NORTH_WATCH_CANNON.z) < 10;
  expect(CANNON_EMPLACEMENT_PROPS.filter(retired)).toEqual(
    CANNON_EMPLACEMENT_PROPS.filter(atNorthWatch),
  );
  expect(CANNON_EMPLACEMENT_PROPS.filter(retired)).toHaveLength(7);
  for (const prop of CANNON_EMPLACEMENT_PROPS) {
    if (retired(prop)) expect(PROPS.decorProps).not.toContainEqual(prop);
    else expect(PROPS.decorProps).toContainEqual(prop);
    expect(prop.key.toLowerCase()).not.toContain('barrel');
    expect(prop.terrainCalm).toBe(false);
  }
  for (const path of [
    'biome/hex_crate_big',
    'biome/hex_crate_open',
    'biome/hex_cannonballs',
    'biome/hex_sack',
    'dungeon/crates_stacked',
  ])
    expect(existsSync(`public/models/${path}.glb`)).toBe(true);
});

it.each(VEHICLE_STATIONS)(
  'keeps $id dressing dry, behind the firing field, and away from the cannon approach',
  (station) => {
    const props = CANNON_EMPLACEMENT_PROPS.filter(
      (p) => Math.hypot(p.x - station.x, p.z - station.z) < 10,
    );
    expect(props).toHaveLength(7);
    for (const p of props) {
      expect(p.z - (p.r ?? 0.6)).toBeGreaterThan(station.field.maxZ + 4);
      expect(Math.abs(p.x - station.x) - (p.r ?? 0.6)).toBeGreaterThan(2);
      const center = terrainHeight(p.x, p.z, WORLD_SEED);
      expect(center).toBeGreaterThan(WATER_LEVEL + 1);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        expect(Math.abs(center - terrainHeight(p.x + dx, p.z + dz, WORLD_SEED))).toBeLessThan(0.3);
    }
    for (let z = station.z - 3; z <= station.z + 8; z++)
      for (const x of [station.x - 1, station.x, station.x + 1])
        expect(resolvePosition(WORLD_SEED, x, z, 0.5)).toEqual({ x, z });
  },
);
