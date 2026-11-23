// Gourdlight Eve's indoor pumpkins (src/sim/seasonal_interior_pumpkins.ts) against the LIVE
// shipped world: six to ten across the three event cities, each inside a walk-in house
// (walls on all four sides), on a furniture top it fits on or snug on the floor, never in
// furniture, a wall, the doorway or a townsfolk's spot. Purely decorative: no collider, no
// interaction, never part of the Haunted Pumpkin hunt. The pin that turns red when a house
// is moved or refurnished under one.
import { describe, expect, it } from 'vitest';
import { wispPose } from '../src/render/seasonal_interior_wisps_core';
import { isBlocked, supportHeightAt } from '../src/sim/colliders';
import { GOURDLIGHT_PUMPKINS } from '../src/sim/content/gourdlight_pumpkins';
import { NPCS } from '../src/sim/data';
import { chapelAt } from '../src/sim/seasonal_decor_exclusions';
import { seasonalDecorLayout } from '../src/sim/seasonal_decor_layout';
import {
  enclosedAt,
  INTERIOR_PUMPKIN_RADIUS,
  INTERIOR_PUMPKINS_PER_CITY,
  interiorPumpkinJob,
  interiorPumpkins,
  resolveInteriorPumpkins,
} from '../src/sim/seasonal_interior_pumpkins';
import { SEASONAL_EVENT_TOWNS } from '../src/sim/seasonal_towns';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const list = resolveInteriorPumpkins(WORLD_SEED);

function inBox(
  box: { center: { x: number; z: number }; halfWidth: number; halfDepth: number; rotation: number },
  x: number,
  z: number,
): boolean {
  const dx = x - box.center.x;
  const dz = z - box.center.z;
  const c = Math.cos(box.rotation);
  const s = Math.sin(box.rotation);
  // inverse of the building yaw convention (localToWorld)
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= box.halfWidth && Math.abs(lz) <= box.halfDepth;
}

describe('the indoor pumpkins', () => {
  it('number six to ten, at least two in every event city, one per house at most', () => {
    expect(SEASONAL_EVENT_TOWNS.map((town) => town.id)).toEqual([
      'eastbrook',
      'fenbridge',
      'highwatch',
    ]);
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.length).toBeLessThanOrEqual(10);
    for (const town of SEASONAL_EVENT_TOWNS) {
      const ids = new Set(town.buildings.map((b) => b.id));
      const mine = list.filter((p) => ids.has(p.buildingId));
      expect(mine.length, town.id).toBeGreaterThanOrEqual(2);
      expect(mine.length, town.id).toBeLessThanOrEqual(INTERIOR_PUMPKINS_PER_CITY);
    }
    expect(new Set(list.map((p) => p.buildingId)).size).toBe(list.length);
  });

  it('sit inside a walk-in house body (never an annex), walled on all four sides', () => {
    for (const p of list) {
      const house = SEASONAL_EVENT_TOWNS.flatMap((t) => t.buildings).find(
        (b) => b.id === p.buildingId,
      );
      expect(house?.walkIn, p.anchor).toBe(true);
      if (!house) continue;
      const walls = {
        center: house.position,
        halfWidth: house.nativeDimensions.width / 2,
        halfDepth: house.nativeDimensions.depth / 2,
        rotation: house.rotation,
      };
      expect(inBox(walls, p.x, p.z), p.anchor).toBe(true);
      for (const annex of house.annexes)
        expect(inBox(annex, p.x, p.z), `${p.anchor} in ${annex.id}`).toBe(false);
      expect(enclosedAt(WORLD_SEED, p.x, p.z, house.rotation), p.anchor).toBe(true);
    }
  });

  it('rest on a top they fit on or snug on the floor, never inside furniture or a wall', () => {
    for (const p of list) {
      const floor = groundHeight(p.x, p.z, WORLD_SEED);
      if (p.surface === 'table') {
        expect(p.y).toBeGreaterThan(floor + 0.5);
        const top = supportHeightAt(WORLD_SEED, p.x, p.z, 0.2, p.y + 0.01);
        expect(top, p.anchor).toBeCloseTo(p.y, 3);
      } else {
        expect(p.y).toBeCloseTo(floor, 5);
        expect(isBlocked(WORLD_SEED, p.x, p.z, INTERIOR_PUMPKIN_RADIUS), p.anchor).toBe(false);
      }
      for (const n of Object.values(NPCS)) {
        expect(Math.hypot(n.pos.x - p.x, n.pos.z - p.z), `${p.anchor} on ${n.id}`).toBeGreaterThan(
          1.3,
        );
      }
    }
  });

  // Owner note 2026-10-18: no pumpkins at the church, inside included.
  it('never stand in a chapel', () => {
    const chapels = SEASONAL_EVENT_TOWNS.flatMap((t) => t.buildings).filter(
      (b) => b.kind === 'chapel',
    );
    expect(chapels.length).toBe(3);
    for (const p of list) {
      const house = SEASONAL_EVENT_TOWNS.flatMap((t) => t.buildings).find(
        (b) => b.id === p.buildingId,
      );
      expect(house?.kind, p.anchor).not.toBe('chapel');
      expect(chapelAt(p.x, p.z), p.anchor).toBeNull();
    }
  });

  it('are pure dressing: never in the street list the colliders read, never a hunt pumpkin', () => {
    const street = seasonalDecorLayout(WORLD_SEED);
    for (const p of list) {
      expect(street.ground.some((g) => g.anchor === p.anchor)).toBe(false);
      for (const h of GOURDLIGHT_PUMPKINS) {
        expect(Math.hypot(h.x - p.x, h.z - p.z)).toBeGreaterThan(2);
      }
    }
  });

  it('are deterministic and memoized per seed', () => {
    expect(resolveInteriorPumpkins(WORLD_SEED)).toEqual(list);
    expect(interiorPumpkins(WORLD_SEED)).toBe(interiorPumpkins(WORLD_SEED));
  });

  it('hang a wisp over each, held still under reduced motion', () => {
    const a = wispPose(1, 2, 3, 0.8, 4.2, 0.5, false);
    expect(a.y).toBeGreaterThan(2.3);
    expect(wispPose(1, 2, 3, 0.8, 4.2, 0.5, true)).toEqual(wispPose(1, 2, 3, 0.8, 9.9, 0.5, true));
  });
});

describe('the indoor pumpkins, a house a step', () => {
  it('the stepped job lands the same list as the one-shot resolve, one house per step', () => {
    const job = interiorPumpkinJob(WORLD_SEED + 1, false);
    let steps = 0;
    while (!job.step()) steps++;
    expect(steps).toBeGreaterThan(3);
    expect(job.result).toEqual(resolveInteriorPumpkins(WORLD_SEED + 1));
    expect(job.step()).toBe(true);
  });
});
