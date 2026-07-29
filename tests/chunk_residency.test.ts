import { describe, expect, it } from 'vitest';
import {
  type ChunkGrid,
  fogFarForBuiltGround,
  type GroundPendingAt,
  nearestPendingGroundDistance,
  orderCellsForEntry,
  UNBUILT_GROUND_FOG_GUARD,
} from '../src/render/chunk_residency_core';
import { MAX_OUTDOOR_FOG_FAR, MIN_OUTDOOR_FOG_FAR } from '../src/render/zone_streaming';
import {
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
} from '../src/sim/data';

// The real lattice src/render/terrain.ts builds on: 18 x 44 cells of 60 yd.
const CHUNK_SIZE = 60;
const GRID: ChunkGrid = {
  size: CHUNK_SIZE,
  countX: Math.ceil((WORLD_MAX_X - WORLD_MIN_X) / CHUNK_SIZE),
  countZ: Math.ceil((WORLD_MAX_Z - WORLD_MIN_Z) / CHUNK_SIZE),
  originX: WORLD_MIN_X,
  originZ: WORLD_MIN_Z,
};

// The same ownership rule terrain.ts builds against: a cell belongs to the zone
// containing its CENTRE, and 96 of the 792 cells belong to no zone at all (the
// zone rectangles do not tile). Deliberately not zoneAt(), which clamps a gap
// to the nearest playable zone.
function cellOwner(cx: number, cz: number): string | null {
  const x = GRID.originX + (cx + 0.5) * GRID.size;
  const z = GRID.originZ + (cz + 0.5) * GRID.size;
  return (
    ZONES.find(
      (zone) =>
        z >= zone.zMin &&
        z < zone.zMax &&
        x >= (zone.xMin ?? STRIP_MIN_X) &&
        x < (zone.xMax ?? STRIP_MAX_X),
    )?.id ?? null
  );
}

/** Ground still owed everywhere except the cells owned by `built`. */
function pendingOutside(built: ReadonlySet<string>): GroundPendingAt {
  return (cx, cz) => {
    const owner = cellOwner(cx, cz);
    return owner !== null && !built.has(owner);
  };
}

// Independent re-implementation, so the equivalence checks below compare two
// separately written answers rather than one function against itself.
function cellDistance(cx: number, cz: number, x: number, z: number): number {
  const minX = GRID.originX + cx * GRID.size;
  const minZ = GRID.originZ + cz * GRID.size;
  const maxX = minX + GRID.size;
  const maxZ = minZ + GRID.size;
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  return Math.hypot(dx, dz);
}

function bruteForceNearest(isPending: GroundPendingAt, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let cz = 0; cz < GRID.countZ; cz++) {
    for (let cx = 0; cx < GRID.countX; cx++) {
      if (isPending(cx, cz)) best = Math.min(best, cellDistance(cx, cz, x, z));
    }
  }
  return best;
}

// Comfortably past the grid diagonal (~2852), so the bounded walk and the full
// scan must agree exactly rather than the walk stopping early.
const BEYOND_GRID = 4000;

const CAMERAS = [
  { x: 2, z: -2 }, // Eastbrook spawn
  { x: 217, z: 1871 }, // the reported Drakelands portal landing
  { x: -2, z: 580 }, // the reported Thornpeak login
  { x: 0, z: 0 },
  { x: 179, z: 0 }, // hard against a zone boundary
  { x: -530, z: 2400 }, // world corner
  { x: 500, z: 1000 },
  { x: -300, z: 300 },
  { x: 60, z: 1959 },
  { x: 120, z: 905 },
];

describe('nearest unbuilt ground', () => {
  it('matches a full-grid scan for a ZONE-shaped built set (a union of rectangles)', () => {
    // The shape builds take TODAY. A cached frontier radius is wrong here: the
    // built set is not a disc, so a radius reports a clamp that is too generous
    // and the player sees through a hole.
    const builtSets = [
      new Set<string>(),
      new Set(['eastbrook_vale']),
      new Set(['eastbrook_vale', 'farshore_isle']),
      new Set(['drakelands', 'frostveil', 'wraithwood']),
      new Set(['thornpeak_heights', 'mirefen_marsh']),
      new Set(ZONES.map((zone) => zone.id)),
    ];
    for (const built of builtSets) {
      const isPending = pendingOutside(built);
      for (const camera of CAMERAS) {
        const walked = nearestPendingGroundDistance(
          GRID,
          isPending,
          camera.x,
          camera.z,
          BEYOND_GRID,
        );
        const scanned = bruteForceNearest(isPending, camera.x, camera.z);
        const label = `built=[${[...built].join(',')}] at (${camera.x}, ${camera.z})`;
        if (!Number.isFinite(scanned)) expect(walked, label).toBe(Number.POSITIVE_INFINITY);
        else expect(walked, label).toBeCloseTo(scanned, 9);
      }
    }
  });

  it('matches a full-grid scan for a DISC-shaped built set (the nearest-first future)', () => {
    // Ordering builds globally nearest-first later turns the built set into a
    // disc around the player. The same query has to stay correct then, or this
    // work has to be unpicked to land it.
    for (const origin of CAMERAS) {
      for (const radius of [0, 45, 130, 400, 900]) {
        const isPending: GroundPendingAt = (cx, cz) =>
          cellOwner(cx, cz) !== null && cellDistance(cx, cz, origin.x, origin.z) > radius;
        for (const camera of CAMERAS) {
          const walked = nearestPendingGroundDistance(
            GRID,
            isPending,
            camera.x,
            camera.z,
            BEYOND_GRID,
          );
          const scanned = bruteForceNearest(isPending, camera.x, camera.z);
          const label = `disc r=${radius} about (${origin.x}, ${origin.z}) seen from (${camera.x}, ${camera.z})`;
          if (!Number.isFinite(scanned)) expect(walked, label).toBe(Number.POSITIVE_INFINITY);
          else expect(walked, label).toBeCloseTo(scanned, 9);
        }
      }
    }
  });

  it('never clamps against a cell no zone owns, or anything past the world rim', () => {
    // The Farshore's offshore campaign column deliberately adds a wide band of
    // open sea between zone rectangles. Those cells have no direct zone owner;
    // treating them as pending here would pin the view against water that no
    // adjacent realm build owns directly.
    const unowned: [number, number][] = [];
    for (let cz = 0; cz < GRID.countZ; cz++) {
      for (let cx = 0; cx < GRID.countX; cx++) {
        if (cellOwner(cx, cz) === null) unowned.push([cx, cz]);
      }
    }
    expect(unowned.length).toBe(645);
    const isPending = pendingOutside(new Set(ZONES.map((zone) => zone.id)));
    // Stand in the middle of an unowned cell: even at zero distance it must not
    // clamp, and the full biome request is granted.
    for (const [cx, cz] of unowned.slice(0, 12)) {
      const x = GRID.originX + (cx + 0.5) * GRID.size;
      const z = GRID.originZ + (cz + 0.5) * GRID.size;
      expect(nearestPendingGroundDistance(GRID, isPending, x, z, BEYOND_GRID)).toBe(
        Number.POSITIVE_INFINITY,
      );
      expect(fogFarForBuiltGround(GRID, isPending, x, z, 500)).toBe(500);
    }
  });

  it('reports no clamp for a camera off the overworld strip entirely', () => {
    // Dungeon and rift interiors sit 99k yards away (INSTANCE_X_BASE). The
    // renderer gates the outdoor clamp on fogState, but the query must not
    // invent one there either.
    const isPending = pendingOutside(new Set());
    expect(nearestPendingGroundDistance(GRID, isPending, 99_400, 0, MAX_OUTDOOR_FOG_FAR)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(fogFarForBuiltGround(GRID, isPending, 99_400, 0, 500)).toBe(500);
  });

  it('stops a ring or two past the first hit instead of scanning the grid', () => {
    // The clamped case is the one the player pays for, so it has to be the
    // cheap case. Every cell is visited at most once even in the worst case,
    // because Chebyshev rings partition the lattice.
    const isPending = pendingOutside(new Set(['eastbrook_vale']));
    let calls = 0;
    const counted: GroundPendingAt = (cx, cz) => {
      calls++;
      return isPending(cx, cz);
    };
    nearestPendingGroundDistance(GRID, counted, 0, 169, MAX_OUTDOOR_FOG_FAR);
    expect(calls).toBeLessThan(60);

    calls = 0;
    const allResident = pendingOutside(new Set(ZONES.map((zone) => zone.id)));
    const countedResident: GroundPendingAt = (cx, cz) => {
      calls++;
      return allResident(cx, cz);
    };
    nearestPendingGroundDistance(GRID, countedResident, 0, 0, MAX_OUTDOOR_FOG_FAR);
    expect(calls).toBeLessThanOrEqual(GRID.countX * GRID.countZ);
  });
});

describe('outdoor fog clamp on unbuilt ground', () => {
  const eastbrookOnly = pendingOutside(new Set(['eastbrook_vale']));

  it('clamps ahead of the nearest unbuilt ground at the Eastbrook spawn', () => {
    // The campaign's Farshore now sits offshore rather than against the Vale's
    // east edge. The nearest owed cell starts at z=170, 172 yd from spawn, so
    // the guard holds both biome requests at 164.
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 2, -2, 500)).toBe(164);
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 2, -2, 900)).toBe(164);
  });

  it('contracts as the camera closes on unbuilt ground', () => {
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 0, 60, 500)).toBe(
      110 - UNBUILT_GROUND_FOG_GUARD,
    );
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 0, 100, 500)).toBe(
      70 - UNBUILT_GROUND_FOG_GUARD,
    );
  });

  it('never exposes unbuilt ground at point-blank range', () => {
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 0, 169, 500)).toBe(MIN_OUTDOOR_FOG_FAR);
  });

  it('grants the full request once the ground within it is built', () => {
    const withMirefen = pendingOutside(new Set(['eastbrook_vale', 'mirefen_marsh']));
    expect(fogFarForBuiltGround(GRID, withMirefen, 0, 169, 170)).toBe(170);
  });

  it('caps every request at the rendering envelope even with the world built', () => {
    const all = pendingOutside(new Set(ZONES.map((zone) => zone.id)));
    expect(fogFarForBuiltGround(GRID, all, 0, 0, MAX_OUTDOOR_FOG_FAR + 500)).toBe(
      MAX_OUTDOOR_FOG_FAR,
    );
    expect(fogFarForBuiltGround(GRID, all, 0, 0, 80)).toBe(80);
  });
});

describe('partially built neighbours (the reported walls)', () => {
  const thornpeakLogin = { x: -2, z: 580 };
  const loginCx = Math.floor((thornpeakLogin.x - GRID.originX) / GRID.size);
  const mirefenRows = Array.from({ length: GRID.countZ }, (_, cz) => cz).filter(
    (cz) => cellOwner(loginCx, cz) === 'mirefen_marsh',
  );

  it('lifts the Thornpeak login wall after two chunk rows, not a whole zone', () => {
    // Reported live: logging in at (-2, 580) put the player 40 yd from the
    // Mirefen rectangle, and the peaks preset's 850-yard vista sat at the
    // 45-yard floor for about a minute while a whole 36-chunk zone plus its
    // HDRI finished. The two rows against the border are the only ones that
    // were ever in the way. Derive their indices from the live grid: the
    // campaign's southern Farshore extent shifts originZ without changing
    // this behavior.
    const login = thornpeakLogin;
    expect(mirefenRows).toHaveLength(6);
    const northRows = mirefenRows.slice(-2);

    const builtZones = new Set(['thornpeak_heights']);
    const wholeZonePending = pendingOutside(builtZones);
    expect(
      fogFarForBuiltGround(GRID, wholeZonePending, login.x, login.z, MAX_OUTDOOR_FOG_FAR),
    ).toBe(MIN_OUTDOOR_FOG_FAR);

    // Now build ONLY Mirefen's two northern rows.
    const twoRowsBuilt: GroundPendingAt = (cx, cz) => {
      const owner = cellOwner(cx, cz);
      if (owner === null || builtZones.has(owner)) return false;
      if (owner === 'mirefen_marsh' && cz >= northRows[0]) return false;
      return true;
    };
    // The nearest ground still owed ends at the south edge of the first built
    // row, so the wall is gone for the cost of 12 chunks rather than a whole
    // zone plus an HDRI.
    const opened = fogFarForBuiltGround(GRID, twoRowsBuilt, login.x, login.z, MAX_OUTDOOR_FOG_FAR);
    const pendingNorthEdge = GRID.originZ + northRows[0] * GRID.size;
    expect(opened).toBe(login.z - pendingNorthEdge - UNBUILT_GROUND_FOG_GUARD);
    expect(opened).toBeGreaterThan(3 * MIN_OUTDOOR_FOG_FAR);
  });

  it('holds the Drakelands portal landing at the floor until Frostveil ground exists', () => {
    // The portal lands at (217, 1871) on the zone's western margin, with the
    // Frostveil rectangle 37 yd away. Measured live: near=25 far=45 still held
    // after 198 s, against an authored ember far of 360.
    const landing = { x: 217, z: 1871 };
    const destinationOnly = pendingOutside(new Set(['drakelands']));
    for (const requested of [200, 385]) {
      expect(fogFarForBuiltGround(GRID, destinationOnly, landing.x, landing.z, requested)).toBe(
        MIN_OUTDOOR_FOG_FAR,
      );
    }

    // With the arrival neighbourhood built the clamp stops binding entirely,
    // and even an unbounded request clears to the Amberfall 397 yd west.
    const neighbourhood = pendingOutside(new Set(['drakelands', 'frostveil', 'wraithwood']));
    for (const requested of [200, 385]) {
      expect(fogFarForBuiltGround(GRID, neighbourhood, landing.x, landing.z, requested)).toBe(
        requested,
      );
    }
    expect(
      fogFarForBuiltGround(GRID, neighbourhood, landing.x, landing.z, MAX_OUTDOOR_FOG_FAR),
    ).toBe(397 - UNBUILT_GROUND_FOG_GUARD);
  });

  it('opens progressively as a column of chunks lands, instead of jumping per zone', () => {
    // The behaviour change in one assertion: the fog frontier tracks the build
    // frontier. Each further built row buys a strictly wider view, where the
    // zone clamp returned the floor for every one of these states.
    const camera = thornpeakLogin;
    const builtThrough =
      (lowestBuiltRow: number): GroundPendingAt =>
      (cx, cz) => {
        const owner = cellOwner(cx, cz);
        if (owner === null || owner === 'thornpeak_heights') return false;
        if (owner === 'mirefen_marsh') return cz < lowestBuiltRow;
        return true;
      };
    const thresholds = [mirefenRows[mirefenRows.length - 1] + 1, ...mirefenRows.toReversed()];
    const opened = thresholds.map((row) =>
      fogFarForBuiltGround(GRID, builtThrough(row), camera.x, camera.z, MAX_OUTDOOR_FOG_FAR),
    );
    // Compare against an independently scanned frontier, then pin the useful
    // shape: it starts closed, never contracts as rows land, and opens well
    // beyond the point-blank floor before another zone takes over.
    const expected = thresholds.map((row) => {
      const distance = bruteForceNearest(builtThrough(row), camera.x, camera.z);
      return Math.min(
        MAX_OUTDOOR_FOG_FAR,
        Math.max(MIN_OUTDOOR_FOG_FAR, distance - UNBUILT_GROUND_FOG_GUARD),
      );
    });
    expect(opened).toEqual(expected);
    expect(opened[0]).toBe(MIN_OUTDOOR_FOG_FAR);
    for (let i = 1; i < opened.length; i++) {
      expect(opened[i]).toBeGreaterThanOrEqual(opened[i - 1]);
    }
    expect(opened.at(-1)).toBeGreaterThan(3 * MIN_OUTDOOR_FOG_FAR);
  });
});

describe('chunk build order (the which-chunk-next seam)', () => {
  const cells: [number, number][] = [];
  for (let cz = 0; cz < GRID.countZ; cz++) {
    for (let cx = 0; cx < GRID.countX; cx++) {
      if (cellOwner(cx, cz) === 'mirefen_marsh') cells.push([cx, cz]);
    }
  }

  it('builds outward from the entry point, nearest first', () => {
    const entry = { x: 0, z: 500 };
    const ordered = orderCellsForEntry(cells, GRID, entry, CHUNK_SIZE * 3);
    const distance = ([cx, cz]: [number, number]): number =>
      Math.hypot(
        GRID.originX + (cx + 0.5) * GRID.size - entry.x,
        GRID.originZ + (cz + 0.5) * GRID.size - entry.z,
      );
    const near = ordered.filter((cell) => distance(cell) <= CHUNK_SIZE * 3);
    expect(near.length).toBeGreaterThan(0);
    // The near neighbourhood comes first, sorted, so the chunk underfoot lands
    // before anything else in the zone.
    expect(ordered.slice(0, near.length)).toEqual(near);
    for (let i = 1; i < near.length; i++) {
      expect(distance(near[i])).toBeGreaterThanOrEqual(distance(near[i - 1]));
    }
  });

  it('keeps the tail in row-major order so the far-band super-chunk merge forms', () => {
    const entry = { x: 0, z: 500 };
    const near = CHUNK_SIZE * 3;
    const isNear = ([cx, cz]: [number, number]): boolean =>
      Math.hypot(
        GRID.originX + (cx + 0.5) * GRID.size - entry.x,
        GRID.originZ + (cz + 0.5) * GRID.size - entry.z,
      ) <= near;
    const ordered = orderCellsForEntry(cells, GRID, entry, near);
    const tail = ordered.filter((cell) => !isNear(cell));
    expect(tail.length).toBeGreaterThan(0);
    expect(tail).toEqual(cells.filter((cell) => !isNear(cell)));
  });

  it('returns the input order untouched with no entry point, and never mutates the input', () => {
    const snapshot = cells.map((cell) => cell.join(','));
    expect(orderCellsForEntry(cells, GRID, undefined, CHUNK_SIZE * 3)).toEqual(cells);
    orderCellsForEntry(cells, GRID, { x: 0, z: 500 }, CHUNK_SIZE * 3);
    expect(cells.map((cell) => cell.join(','))).toEqual(snapshot);
  });

  it('leaves order alone when nothing is within the near radius', () => {
    const ordered = orderCellsForEntry(cells, GRID, { x: 20_000, z: 20_000 }, CHUNK_SIZE * 3);
    expect(ordered).toEqual(cells);
  });
});
