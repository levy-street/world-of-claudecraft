import { describe, expect, it } from 'vitest';
import {
  type ChunkGrid,
  fogFarForBuiltGround,
  GROUND_VIEW_CONE_MARGIN,
  type GroundPendingAt,
  type GroundViewCone,
  groundViewConeHalfAngle,
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
  WORLD_MIN_Z,
  ZONES,
} from '../src/sim/data';

// The real lattice src/render/terrain.ts builds on: 18 x 44 cells of 60 yd.
const CHUNK_SIZE = 60;
const GRID: ChunkGrid = {
  size: CHUNK_SIZE,
  countX: Math.ceil((WORLD_MAX_X * 2) / CHUNK_SIZE),
  countZ: Math.ceil((WORLD_MAX_Z - WORLD_MIN_Z) / CHUNK_SIZE),
  originX: -WORLD_MAX_X,
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
    // 96 of the 792 cells are covered by no zone rectangle, so nothing will
    // ever build them. Treating "no geometry" as "pending" would pin the view
    // against a hole that never fills, which is worse than the zone clamp this
    // replaces. The whole world is resident here, so only unowned cells remain.
    const unowned: [number, number][] = [];
    for (let cz = 0; cz < GRID.countZ; cz++) {
      for (let cx = 0; cx < GRID.countX; cx++) {
        if (cellOwner(cx, cz) === null) unowned.push([cx, cz]);
      }
    }
    expect(unowned.length).toBe(96);
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
    nearestPendingGroundDistance(GRID, counted, 179, 0, MAX_OUTDOOR_FOG_FAR);
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
    // Farshore's nearest cell sits 178 yd from (2, -2), so the view is held at
    // 178 - guard = 170 no matter what the biome preset asked for.
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 2, -2, 500)).toBe(170);
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 2, -2, 900)).toBe(170);
  });

  it('contracts as the camera closes on unbuilt ground', () => {
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 60, 0, 500)).toBe(
      120 - UNBUILT_GROUND_FOG_GUARD,
    );
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 100, 0, 500)).toBe(
      80 - UNBUILT_GROUND_FOG_GUARD,
    );
  });

  it('never exposes unbuilt ground at point-blank range', () => {
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, 179, 0, 500)).toBe(MIN_OUTDOOR_FOG_FAR);
  });

  it('grants the full request once the ground within it is built', () => {
    const withFarshore = pendingOutside(new Set(['eastbrook_vale', 'farshore_isle']));
    expect(fogFarForBuiltGround(GRID, withFarshore, 179, 0, 170)).toBe(170);
  });

  it('caps every request at the rendering envelope even with the world built', () => {
    const all = pendingOutside(new Set(ZONES.map((zone) => zone.id)));
    expect(fogFarForBuiltGround(GRID, all, 0, 0, MAX_OUTDOOR_FOG_FAR + 500)).toBe(
      MAX_OUTDOOR_FOG_FAR,
    );
    expect(fogFarForBuiltGround(GRID, all, 0, 0, 80)).toBe(80);
  });
});

describe('the view wedge (turning on the spot must not move the horizon)', () => {
  // A 9x9 lattice of the real 60-yard cells centred on the origin, so the
  // camera at (0, 0) sits in the middle of cell (4, 4) and every distance below
  // is an exact cell edge. -Z is "ahead" for a forward of (0, -1).
  const SYNTH: ChunkGrid = { size: 60, countX: 9, countZ: 9, originX: -270, originZ: -270 };
  const onlyCell =
    (pendX: number, pendZ: number): GroundPendingAt =>
    (cx, cz) =>
      cx === pendX && cz === pendZ;
  const cone = (forwardX: number, forwardZ: number): GroundViewCone => ({
    forwardX,
    forwardZ,
    halfAngle: groundViewConeHalfAngle(Math.PI / 3, 16 / 9),
  });
  // Cell (4, 1) spans z -210..-150, so its near edge is 150 yd from the origin.
  const AHEAD = onlyCell(4, 1);
  const BEHIND = onlyCell(4, 7);
  const REQUEST = 500;

  it('covers the whole frame corner and never opens past a right angle', () => {
    const tanY = Math.tan(Math.PI / 6);
    const corner = Math.atan(Math.hypot(tanY * (16 / 9), tanY));
    expect(groundViewConeHalfAngle(Math.PI / 3, 16 / 9)).toBeCloseTo(
      corner + GROUND_VIEW_CONE_MARGIN,
      10,
    );
    // The corner, not the horizontal edge: a cell at the top of frame is inside.
    expect(corner).toBeGreaterThan(Math.atan(tanY * (16 / 9)));
    // Two half-planes only exclude the region behind the camera below 90 deg.
    expect(groundViewConeHalfAngle(Math.PI * 0.98, 4)).toBeLessThan(Math.PI / 2);
    expect(groundViewConeHalfAngle(Math.PI / 3, 16 / 9, 10)).toBeLessThan(Math.PI / 2);
  });

  it('clamps against unbuilt ground the camera is looking at, exactly as radially', () => {
    const radial = fogFarForBuiltGround(SYNTH, AHEAD, 0, 0, REQUEST);
    expect(radial).toBe(150 - UNBUILT_GROUND_FOG_GUARD);
    expect(fogFarForBuiltGround(SYNTH, AHEAD, 0, 0, REQUEST, cone(0, -1))).toBe(radial);
  });

  it('ignores unbuilt ground behind the camera, which can never show a hole', () => {
    // The whole bug in two assertions: the same pending cell, the same spot,
    // only the heading differs.
    expect(fogFarForBuiltGround(SYNTH, BEHIND, 0, 0, REQUEST, cone(0, 1))).toBe(
      150 - UNBUILT_GROUND_FOG_GUARD,
    );
    expect(fogFarForBuiltGround(SYNTH, BEHIND, 0, 0, REQUEST, cone(0, -1))).toBe(REQUEST);
  });

  it('keeps ground off to the side but still in frame', () => {
    // Cell (6, 1): x 90..150, z -210..-150, so its nearest corner sits about 31
    // degrees off a forward of (0, -1) and inside the frame.
    const offAxis = onlyCell(6, 1);
    const bearing = (Math.atan2(90, 150) * 180) / Math.PI;
    expect(bearing).toBeLessThan(45);
    expect(fogFarForBuiltGround(SYNTH, offAxis, 0, 0, REQUEST, cone(0, -1))).toBeLessThan(REQUEST);
  });

  it('falls back to the radial answer without a usable direction', () => {
    for (const isPending of [AHEAD, BEHIND]) {
      const radial = fogFarForBuiltGround(SYNTH, isPending, 0, 0, REQUEST);
      expect(fogFarForBuiltGround(SYNTH, isPending, 0, 0, REQUEST, null)).toBe(radial);
      expect(fogFarForBuiltGround(SYNTH, isPending, 0, 0, REQUEST, cone(0, 0))).toBe(radial);
    }
  });

  it('can only ever widen the horizon, never tighten it', () => {
    // Skipping cells can only push the nearest pending distance out, and the
    // clamp is monotone in it, so no heading may serve less than the radial
    // answer. Pins the whole family rather than the two headings above.
    const eastbrookOnly = pendingOutside(new Set(['eastbrook_vale']));
    for (const camera of CAMERAS) {
      const radial = fogFarForBuiltGround(
        GRID,
        eastbrookOnly,
        camera.x,
        camera.z,
        MAX_OUTDOOR_FOG_FAR,
      );
      for (let i = 0; i < 16; i++) {
        const yaw = (i * 2 * Math.PI) / 16;
        const served = fogFarForBuiltGround(
          GRID,
          eastbrookOnly,
          camera.x,
          camera.z,
          MAX_OUTDOOR_FOG_FAR,
          cone(Math.sin(yaw), Math.cos(yaw)),
        );
        expect(served, `(${camera.x}, ${camera.z}) at yaw ${i}`).toBeGreaterThanOrEqual(radial);
      }
    }
  });

  it('breaks the yaw coupling at the Eastbrook spawn that the report was about', () => {
    // Measured live before the fix, standing on the spawn and turning on the
    // spot against a 700-yard request: 170 yards served with the binding chunk
    // 90 degrees off the view axis, 235 with it 179 degrees off, i.e. squarely
    // behind the camera. Everything past that horizon is the coarse vista mesh,
    // which carries no splat texture and takes no shadows.
    const eastbrookOnly = pendingOutside(new Set(['eastbrook_vale']));
    const spawn = { x: 2, z: -2 };
    const served = [];
    for (let i = 0; i < 16; i++) {
      const yaw = (i * 2 * Math.PI) / 16;
      served.push(
        fogFarForBuiltGround(
          GRID,
          eastbrookOnly,
          spawn.x,
          spawn.z,
          MAX_OUTDOOR_FOG_FAR,
          cone(Math.sin(yaw), Math.cos(yaw)),
        ),
      );
    }
    // Radially every heading was pinned at the one binding chunk.
    expect(fogFarForBuiltGround(GRID, eastbrookOnly, spawn.x, spawn.z, MAX_OUTDOOR_FOG_FAR)).toBe(
      170,
    );
    // Facing away from it the player now gets the world back, by a wide margin
    // rather than a few yards.
    expect(Math.max(...served)).toBeGreaterThan(4 * 170);
    // And the headings that DO face it still clamp: this widens the horizon,
    // it does not remove the no-holes guarantee.
    expect(Math.min(...served)).toBe(170);
  });
});

describe('partially built neighbours (the reported walls)', () => {
  it('lifts the Thornpeak login wall after two chunk rows, not a whole zone', () => {
    // Reported live: logging in at (-2, 580) put the player 40 yd from the
    // Mirefen rectangle, and the peaks preset's 850-yard vista sat at the
    // 45-yard floor for about a minute while a whole 36-chunk zone plus its
    // HDRI finished. Mirefen occupies cell rows 6 to 11; the two rows against
    // the border are the only ones that were ever in the way.
    const login = { x: -2, z: 580 };
    const mirefenRow = (cz: number): boolean => cellOwner(8, cz) === 'mirefen_marsh';
    expect([6, 7, 8, 9, 10, 11].every(mirefenRow)).toBe(true);

    const builtZones = new Set(['thornpeak_heights']);
    const wholeZonePending = pendingOutside(builtZones);
    expect(
      fogFarForBuiltGround(GRID, wholeZonePending, login.x, login.z, MAX_OUTDOOR_FOG_FAR),
    ).toBe(MIN_OUTDOOR_FOG_FAR);

    // Now build ONLY Mirefen's two northern rows (cz 10 and 11, z 420 to 540).
    const twoRowsBuilt: GroundPendingAt = (cx, cz) => {
      const owner = cellOwner(cx, cz);
      if (owner === null || builtZones.has(owner)) return false;
      if (owner === 'mirefen_marsh' && cz >= 10) return false;
      return true;
    };
    // The nearest ground still owed is Mirefen row 9, whose north edge is
    // z = 420: 160 yd out instead of 40, so the wall is gone for the cost of
    // 12 chunks rather than 36 chunks plus an HDRI.
    const opened = fogFarForBuiltGround(GRID, twoRowsBuilt, login.x, login.z, MAX_OUTDOOR_FOG_FAR);
    expect(opened).toBe(160 - UNBUILT_GROUND_FOG_GUARD);
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
    const camera = { x: -2, z: 580 };
    const builtThrough =
      (lowestBuiltRow: number): GroundPendingAt =>
      (cx, cz) => {
        const owner = cellOwner(cx, cz);
        if (owner === null || owner === 'thornpeak_heights') return false;
        if (owner === 'mirefen_marsh') return cz < lowestBuiltRow;
        return true;
      };
    const opened = [12, 11, 10, 9, 8, 7, 6].map((row) =>
      fogFarForBuiltGround(GRID, builtThrough(row), camera.x, camera.z, MAX_OUTDOOR_FOG_FAR),
    );
    // Each row lands 60 yd further out, so the view earns 60 yd back per row
    // until a different zone becomes the binding constraint: the Willowfen,
    // 178 yd west, which caps the sequence at 170. Under the zone clamp every
    // one of these states returned the 45-yard floor.
    expect(opened).toEqual([
      MIN_OUTDOOR_FOG_FAR, // no Mirefen ground: the border is 40 yd off
      100 - UNBUILT_GROUND_FOG_GUARD, // row 11 built, row 10's edge at z=480
      160 - UNBUILT_GROUND_FOG_GUARD, // rows 10 and 11, row 9's edge at z=420
      178 - UNBUILT_GROUND_FOG_GUARD, // the Willowfen takes over from here
      178 - UNBUILT_GROUND_FOG_GUARD,
      178 - UNBUILT_GROUND_FOG_GUARD,
      178 - UNBUILT_GROUND_FOG_GUARD,
    ]);
  });
});

describe('chunk build order (the which-chunk-next seam)', () => {
  const cells: [number, number][] = [];
  for (let cz = 6; cz <= 11; cz++) for (let cx = 6; cx <= 11; cx++) cells.push([cx, cz]);

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
