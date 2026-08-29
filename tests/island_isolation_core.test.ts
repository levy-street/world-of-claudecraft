// The Proving Shore's isolated presentation scope: which zones the client
// streams while a tutorial player stands on the island, which chunk cells
// still count as pending ground for the outdoor fog clamp, and the panorama's
// ground rect. Pure decisions, driven directly; the renderer and terrain
// consumers are pinned by their own seam tests below.

import { describe, expect, it } from 'vitest';
import { fogFarForBuiltGround } from '../src/render/chunk_residency_core';
import { horizonHazePlan } from '../src/render/far_terrain_core';
import {
  cellCountsAsPending,
  ISLAND_RECT,
  ISLAND_ZONE_ID,
  islandHorizonHaze,
  islandIsolationActive,
  islandScopeStreamsZone,
  islandVistaBounds,
} from '../src/render/island_isolation_core';
import { MIN_OUTDOOR_FOG_FAR } from '../src/render/zone_streaming';
import { isOnProvingShore, PROVING_SHORE_ARRIVAL } from '../src/sim/content/proving_shore';
import { ZONES } from '../src/sim/data';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('islandIsolationActive', () => {
  it('holds at the tutorial arrival and everywhere on the island', () => {
    expect(islandIsolationActive(PROVING_SHORE_ARRIVAL.x, PROVING_SHORE_ARRIVAL.z)).toBe(true);
    // The Gauntlet, the practice yard, the wreck line, the tide pool, camp.
    for (const [x, z] of [
      [-308, -23],
      [-336, -14],
      [-380, -42],
      [-398, -17],
      [-300, 50],
    ] as const) {
      expect(islandIsolationActive(x, z), `${x},${z}`).toBe(true);
    }
  });

  it('drops on the mainland, including the vale that sits closest', () => {
    // Eastbrook Vale's rectangle starts at x -180, 101 yd from the arrival:
    // close enough that the arrival streaming radius reaches it, which is the
    // whole reason this scope exists.
    expect(islandIsolationActive(0, 0)).toBe(false);
    expect(islandIsolationActive(-179, -18)).toBe(false);
    // ...and on the far zones that share the island's x column but not its z
    // band (the isOnProvingShore contract: BOTH axes, never x alone).
    expect(islandIsolationActive(-300, 400)).toBe(false);
    expect(islandIsolationActive(-300, -400)).toBe(false);
  });

  it('is exactly the content predicate, never a second opinion', () => {
    // A drifted copy of the island rectangle would isolate the wrong ground.
    for (const [x, z] of [
      [-281, -18],
      [-539, 179],
      [-181, -179],
      [-180, 0],
      [0, 0],
      [-300, 181],
    ] as const) {
      expect(islandIsolationActive(x, z), `${x},${z}`).toBe(isOnProvingShore(x, z));
    }
  });
});

describe('islandScopeStreamsZone', () => {
  it('streams the island and nothing else in the world', () => {
    expect(ZONES.some((z) => z.id === ISLAND_ZONE_ID)).toBe(true);
    const streamed = ZONES.filter((z) => islandScopeStreamsZone(z.id));
    expect(streamed.map((z) => z.id)).toEqual([ISLAND_ZONE_ID]);
    // Decisive: the continent has many zones, and the scope drops all of them.
    expect(ZONES.length).toBeGreaterThan(10);
  });
});

describe('cellCountsAsPending', () => {
  it('off the island, pending means exactly what it always meant', () => {
    expect(cellCountsAsPending(true, false, false)).toBe(true);
    expect(cellCountsAsPending(true, true, false)).toBe(true);
    expect(cellCountsAsPending(false, false, false)).toBe(false);
  });

  it('on the island, only island ground is still pending', () => {
    // The mainland will not be built while the player is here, so calling it
    // pending would pin the fog at ground nobody intends to draw.
    expect(cellCountsAsPending(true, false, true)).toBe(false);
    expect(cellCountsAsPending(true, true, true)).toBe(true);
    // Built island ground is not pending either way.
    expect(cellCountsAsPending(false, true, true)).toBe(false);
  });

  it('lifts the fog wall the unbuilt mainland would otherwise pin', () => {
    // The real mechanism, exercised through the real clamp. One 60 yd cell
    // grid: the island cell under the player is built, the mainland cell to
    // the east is not. Unscoped, the clamp pins the horizon at that unbuilt
    // neighbour; scoped, it opens to the request.
    const grid = { size: 60, countX: 6, countZ: 2, originX: -360, originZ: -60 };
    const mainlandOwner = (cx: number) => (cx >= 4 ? 'eastbrook_vale' : ISLAND_ZONE_ID);
    const built = (cx: number) => cx < 4; // only the island half is meshed
    const requested = 850;
    const pendingUnscoped = (cx: number) =>
      cellCountsAsPending(!built(cx), islandScopeStreamsZone(mainlandOwner(cx)), false);
    const pendingScoped = (cx: number) =>
      cellCountsAsPending(!built(cx), islandScopeStreamsZone(mainlandOwner(cx)), true);
    const camX = grid.originX + 3.5 * grid.size;
    const camZ = grid.originZ + 0.5 * grid.size;
    const walled = fogFarForBuiltGround(grid, (cx) => pendingUnscoped(cx), camX, camZ, requested);
    const open = fogFarForBuiltGround(grid, (cx) => pendingScoped(cx), camX, camZ, requested);
    expect(walled).toBeLessThan(requested);
    expect(walled).toBeGreaterThanOrEqual(MIN_OUTDOOR_FOG_FAR);
    expect(open).toBe(requested);
  });
});

describe('the island horizon haze', () => {
  // The live tier's envelope: renderer.ts passes farVista.envelopeFar, which
  // measures 2200 in the browser on this machine.
  const ENVELOPE = 2200;

  /** Re-measure the two distances the near edge is chosen between, from the
   *  real terrain rather than from the constants that quote them: how far the
   *  nearest dry MAINLAND ground is from the arrival (everything at or beyond
   *  it must be hazed), and how far the island's own dry ground reaches. */
  function shoreDistances(): { nearestMainland: number; furthestIsland: number } {
    const { x: ax, z: az } = PROVING_SHORE_ARRIVAL;
    let nearestMainland = Number.POSITIVE_INFINITY;
    let furthestIsland = 0;
    for (let x = ax - 260; x <= ax + 260; x++) {
      for (let z = az - 260; z <= az + 260; z++) {
        if (terrainHeight(x, z, WORLD_SEED) <= WATER_LEVEL) continue;
        const d = Math.hypot(x - ax, z - az);
        if (isOnProvingShore(x, z)) furthestIsland = Math.max(furthestIsland, d);
        else nearestMainland = Math.min(nearestMainland, d);
      }
    }
    return { nearestMainland, furthestIsland };
  }

  it('starts the band inside the nearest dry mainland ground', () => {
    const { nearestMainland, furthestIsland } = shoreDistances();
    // Guards the premise: the far shore really is close enough that the
    // envelope band would never reach it, and no radius separates the two
    // landmasses, so the near edge is a judgement between them and not a
    // clean split. If a content change ever moves either of these, the
    // constant is the thing to re-derive.
    expect(nearestMainland).toBeLessThan(200);
    expect(furthestIsland).toBeGreaterThan(nearestMainland);

    const onIsland = horizonHazePlan(ENVELOPE, {
      x: PROVING_SHORE_ARRIVAL.x,
      z: PROVING_SHORE_ARRIVAL.z,
    });
    expect(onIsland).toEqual(islandHorizonHaze());
    // Every piece of the far shore is inside the band.
    expect(onIsland.near).toBeLessThanOrEqual(nearestMainland);
    // The envelope band would have missed all of it, which is the bug.
    expect(horizonHazePlan(ENVELOPE).near).toBeGreaterThan(nearestMainland * 3);
  });

  it('leaves the whole coached run in front of the band', () => {
    const { x: ax, z: az } = PROVING_SHORE_ARRIVAL;
    const near = islandHorizonHaze().near;
    // Camp, the Gauntlet lanes, the practice yard, the wreck line, the tide
    // pool, the pearl cove: the island content a player stands in or fights
    // beside never wants an aerial tint on it.
    for (const [x, z] of [
      [-300, 50],
      [-308, -23],
      [-336, -14],
      [-380, -42],
      [-398, -17],
      [-280, 0],
    ] as const) {
      expect(Math.hypot(x - ax, z - az)).toBeLessThan(near);
    }
  });

  it('fades out well before the far mesh does, so the horizon melts', () => {
    const haze = islandHorizonHaze();
    expect(haze.far).toBeGreaterThan(haze.near * 3);
    expect(haze.far).toBeLessThan(ENVELOPE);
  });

  it('leaves every other viewpoint on the tier band, island included by id only', () => {
    expect(horizonHazePlan(ENVELOPE, { x: 0, z: 0 })).toEqual(horizonHazePlan(ENVELOPE));
    // No viewpoint at all is the old signature, unchanged.
    expect(horizonHazePlan(ENVELOPE)).toEqual({ near: ENVELOPE * 0.42, far: ENVELOPE * 1.35 });
  });
});

describe('islandVistaBounds', () => {
  it('covers the island rectangle, the panorama the horizon opens onto', () => {
    const b = islandVistaBounds();
    expect(b).toEqual({
      minX: ISLAND_RECT.minX,
      maxX: ISLAND_RECT.maxX,
      minZ: ISLAND_RECT.minZ,
      maxZ: ISLAND_RECT.maxZ,
    });
    // The whole island, arrival included, sits inside it.
    expect(PROVING_SHORE_ARRIVAL.x).toBeGreaterThan(b.minX);
    expect(PROVING_SHORE_ARRIVAL.x).toBeLessThan(b.maxX);
  });
});
