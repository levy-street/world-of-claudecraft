// Geometry invariants for the Ashen Coliseum pit (ARENA_LAYOUT). The layout is
// the single source of truth for BOTH collision and the rendered interior, so
// these pins guard the fairness contract directly: both mirror symmetries,
// the frozen |x|=23 wall width (the KayKit wall modules fit exactly that), the
// spawn clear zones, walkable path widths between cover, and the Fiesta hazard
// ring covering the whole pit at bout start.
import { describe, expect, it } from 'vitest';
import { arenaCollidersForSlot, type Collider, lineOfSightClear } from '../src/sim/colliders';
import { arenaOrigin } from '../src/sim/data';
import {
  ARENA_LAYOUT,
  ARENA_SPAWN_A,
  ARENA_SPAWN_B,
  ARENA_SPAWNS_A_2v2,
  ARENA_SPAWNS_B_2v2,
  arenaMapForSlot,
  DROWNED_COURT_LAYOUT,
  DUNGEON_WALL_HW,
  DUNGEON_WALL_X,
  type DungeonLayout,
  layoutColliders,
  PILLAR_COLLIDER_R,
  TOMB_HD,
  TOMB_HW,
} from '../src/sim/dungeon_layout';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { FIESTA_RING_CX, FIESTA_RING_CZ, FIESTA_RING_START } from '../src/sim/social/fiesta';

// The pit is mirror-symmetric about x=0 AND about the z=sideWallZ centre line.
const MIRROR_Z = 2 * ARENA_LAYOUT.sideWallZ; // z -> MIRROR_Z - z

const ALL_SPAWNS = [ARENA_SPAWN_A, ARENA_SPAWN_B, ...ARENA_SPAWNS_A_2v2, ...ARENA_SPAWNS_B_2v2];

// Distance from a point to a collider's surface (0 when inside). Arena
// colliders are circles and rot-0 OBBs only.
function surfaceDistance(c: Collider, x: number, z: number): number {
  if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) - c.r;
  const dx = Math.max(Math.abs(x - c.x) - c.hw, 0);
  const dz = Math.max(Math.abs(z - c.z) - c.hd, 0);
  return Math.hypot(dx, dz);
}

// Surface-to-surface gap between two interior obstacles (circles / rot-0 OBBs).
function obstacleGap(a: Collider, b: Collider): number {
  if (a.type === 'circle' && b.type === 'circle') {
    return Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
  }
  if (a.type === 'circle') return surfaceDistance(b, a.x, a.z) - a.r;
  if (b.type === 'circle') return surfaceDistance(a, b.x, b.z) - b.r;
  const gx = Math.max(Math.abs(a.x - b.x) - a.hw - b.hw, 0);
  const gz = Math.max(Math.abs(a.z - b.z) - a.hd - b.hd, 0);
  return Math.hypot(gx, gz);
}

// Interior cover only (pillars + stubs + tombs), as colliders, straight from
// the layout record so the test cannot drift from what layoutColliders derives.
function coverColliders(layout: DungeonLayout = ARENA_LAYOUT): Collider[] {
  return [
    ...layout.pillars.map(
      (p): Collider => ({ type: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R }),
    ),
    ...layout.stubs.map(
      (s): Collider => ({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: 0 }),
    ),
    ...layout.tombs.map(
      (t): Collider => ({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 }),
    ),
  ];
}

describe('arena layout: mirror symmetries', () => {
  const pointKey = (x: number, z: number) => `${x},${z}`;
  const stubKey = (x: number, z: number, hw: number, hd: number) => `${x},${z},${hw},${hd}`;

  it('pillars are symmetric about x=0 and about z=sideWallZ', () => {
    const set = new Set(ARENA_LAYOUT.pillars.map((p) => pointKey(p.x, p.z)));
    expect(set.size).toBe(ARENA_LAYOUT.pillars.length); // no duplicate cover
    for (const p of ARENA_LAYOUT.pillars) {
      expect(set.has(pointKey(-p.x, p.z))).toBe(true);
      expect(set.has(pointKey(p.x, MIRROR_Z - p.z))).toBe(true);
    }
  });

  it('stubs are symmetric about x=0 and about z=sideWallZ', () => {
    const set = new Set(ARENA_LAYOUT.stubs.map((s) => stubKey(s.x, s.z, s.hw, s.hd)));
    expect(set.size).toBe(ARENA_LAYOUT.stubs.length);
    for (const s of ARENA_LAYOUT.stubs) {
      expect(set.has(stubKey(-s.x, s.z, s.hw, s.hd))).toBe(true);
      expect(set.has(stubKey(s.x, MIRROR_Z - s.z, s.hw, s.hd))).toBe(true);
    }
  });

  it('bounds and dais share the same centre line', () => {
    expect(ARENA_LAYOUT.zMin + ARENA_LAYOUT.zMax).toBe(MIRROR_Z);
    expect(ARENA_LAYOUT.dais.x).toBe(0);
    expect(ARENA_LAYOUT.dais.z).toBe(ARENA_LAYOUT.sideWallZ);
    // side wall slabs span the full pit: zMin..zMax exactly
    expect(ARENA_LAYOUT.sideWallZ - ARENA_LAYOUT.sideWallHd).toBe(ARENA_LAYOUT.zMin);
    expect(ARENA_LAYOUT.sideWallZ + ARENA_LAYOUT.sideWallHd).toBe(ARENA_LAYOUT.zMax);
  });

  it('spawn B is spawn A reflected through the centre line (1v1 and 2v2)', () => {
    expect(ARENA_SPAWN_B.x + ARENA_SPAWN_A.x).toBe(0);
    expect(ARENA_SPAWN_B.z).toBe(MIRROR_Z - ARENA_SPAWN_A.z);
    expect(ARENA_SPAWN_A.facing).toBe(0);
    expect(ARENA_SPAWN_B.facing).toBe(Math.PI);
    const bKeys = new Set(ARENA_SPAWNS_B_2v2.map((s) => pointKey(s.x, s.z)));
    for (const s of ARENA_SPAWNS_A_2v2) {
      expect(bKeys.has(pointKey(s.x, MIRROR_Z - s.z))).toBe(true);
      expect(bKeys.has(pointKey(-s.x, MIRROR_Z - s.z))).toBe(true);
    }
  });
});

describe('arena layout: frozen wall width', () => {
  it('keeps the side walls at the default |x|=23 (KayKit module contract)', () => {
    expect(ARENA_LAYOUT.wallX).toBeUndefined();
    expect(DUNGEON_WALL_X).toBe(23);
    const xExtents = layoutColliders(ARENA_LAYOUT)
      .filter((c) => c.type === 'obb' && Math.abs(c.x) === DUNGEON_WALL_X)
      .map((c) => Math.abs(c.x));
    expect(xExtents).toHaveLength(2); // exactly the two side wall slabs
  });
});

describe('arena layout: spawn clear zones', () => {
  it('every spawn sits inside the pit bounds', () => {
    for (const s of ALL_SPAWNS) {
      expect(Math.abs(s.x)).toBeLessThan(DUNGEON_WALL_X - DUNGEON_WALL_HW);
      expect(s.z).toBeGreaterThan(ARENA_LAYOUT.zMin + DUNGEON_WALL_HW);
      expect(s.z).toBeLessThan(ARENA_LAYOUT.zMax - DUNGEON_WALL_HW);
    }
  });

  it('no collider (wall or cover) within 4yd of any spawn point', () => {
    const colliders = layoutColliders(ARENA_LAYOUT);
    for (const s of ALL_SPAWNS) {
      for (const c of colliders) {
        expect(surfaceDistance(c, s.x, s.z)).toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe('arena layout: walkable paths', () => {
  it('every gap between cover pieces is walkable (>=3yd) or fully sealed', () => {
    // A gap narrower than a player body is a deliberate composite cover piece
    // (the approach screens' outer ends are capped by the mid-field posts); a
    // gap in between would be a trap a player can enter but not pass through.
    const sealed = 2 * PLAYER_BODY_RADIUS;
    const cover = coverColliders();
    let sealedPairs = 0;
    for (let i = 0; i < cover.length; i++) {
      for (let j = i + 1; j < cover.length; j++) {
        const gap = obstacleGap(cover[i], cover[j]);
        if (gap < 3) {
          expect(gap).toBeLessThanOrEqual(sealed);
          sealedPairs++;
        }
      }
    }
    // exactly the four screen+post caps, nothing else creeping shut
    expect(sealedPairs).toBe(4);
  });

  it('keeps at least a 3yd lane between every cover piece and the walls', () => {
    const innerX = DUNGEON_WALL_X - DUNGEON_WALL_HW;
    const innerZMin = ARENA_LAYOUT.zMin + DUNGEON_WALL_HW;
    const innerZMax = ARENA_LAYOUT.zMax - DUNGEON_WALL_HW;
    for (const c of coverColliders()) {
      const rx = c.type === 'circle' ? c.r : c.hw;
      const rz = c.type === 'circle' ? c.r : c.hd;
      expect(innerX - (Math.abs(c.x) + rx)).toBeGreaterThanOrEqual(3);
      expect(c.z - rz - innerZMin).toBeGreaterThanOrEqual(3);
      expect(innerZMax - (c.z + rz)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('arena layout: fiesta hazard ring', () => {
  it('is centred on the pit centre and covers the full z extent at bout start', () => {
    // The ring covers both axial z extents exactly; the pit CORNERS sit
    // outside it (they always have), so this deliberately pins the z reach
    // and the spawn margins, not corner coverage.
    expect(FIESTA_RING_CX).toBe(0);
    expect(FIESTA_RING_CZ).toBe(ARENA_LAYOUT.sideWallZ);
    expect(FIESTA_RING_START).toBeGreaterThanOrEqual(ARENA_LAYOUT.zMax - FIESTA_RING_CZ);
    expect(FIESTA_RING_START).toBeGreaterThanOrEqual(FIESTA_RING_CZ - ARENA_LAYOUT.zMin);
  });

  it('starts with every spawn at least 4yd inside the ring', () => {
    for (const s of ALL_SPAWNS) {
      const d = Math.hypot(s.x - FIESTA_RING_CX, s.z - FIESTA_RING_CZ);
      expect(FIESTA_RING_START - d).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('arena layout: cover intent (line of sight)', () => {
  // The arena band's colliders are static and the ground is flat, so any
  // seed selects the same geometry for lineOfSightClear.
  const SEED = 1;
  const o = arenaOrigin(0);
  const at = (p: { x: number; z: number }) => ({ x: o.x + p.x, z: o.z + p.z });

  it('the 1v1 spawns have no clear sightline to each other', () => {
    expect(lineOfSightClear(SEED, at(ARENA_SPAWN_A), at(ARENA_SPAWN_B))).toBe(false);
  });

  it('every 2v2 spawn is screened from the dais centre', () => {
    const centre = at({ x: ARENA_LAYOUT.dais.x, z: ARENA_LAYOUT.dais.z });
    for (const s of [...ARENA_SPAWNS_A_2v2, ...ARENA_SPAWNS_B_2v2]) {
      expect(lineOfSightClear(SEED, at(s), centre)).toBe(false);
    }
    // decisive negative arm: an open lane east of all cover IS clear, so the
    // blocked results above come from the cover, not from the checker
    expect(lineOfSightClear(SEED, at({ x: 16, z: -6 }), at({ x: 16, z: 6 }))).toBe(true);
  });

  it('keeps the wall-sweep test lanes clear of interior cover on BOTH maps', () => {
    // tests/arena.test.ts sweeps the walls along a per-map z row (Coliseum
    // z=-6, Drowned Court z=-2) and the shared x=19 column; pin those lanes
    // obstacle-free with body-radius margin so a future cover nudge fails
    // HERE with a readable message, not in a confusing wall-sweep assertion.
    const lanes: Array<{ layout: DungeonLayout; rowZ: number }> = [
      { layout: ARENA_LAYOUT, rowZ: -6 },
      { layout: DROWNED_COURT_LAYOUT, rowZ: -2 },
    ];
    for (const { layout, rowZ } of lanes) {
      for (const c of coverColliders(layout)) {
        const rx = c.type === 'circle' ? c.r : c.hw;
        const rz = c.type === 'circle' ? c.r : c.hd;
        expect(Math.abs(c.z - rowZ) - rz).toBeGreaterThan(PLAYER_BODY_RADIUS);
        expect(Math.abs(c.x - 19) - rx).toBeGreaterThan(PLAYER_BODY_RADIUS);
      }
    }
  });

  it('arena slots are spaced wider than the pit footprint', () => {
    const spacing = arenaOrigin(1).z - arenaOrigin(0).z;
    expect(spacing).toBeGreaterThan(ARENA_LAYOUT.zMax - ARENA_LAYOUT.zMin);
    expect(spacing).toBeGreaterThan(DROWNED_COURT_LAYOUT.zMax - DROWNED_COURT_LAYOUT.zMin);
  });
});

// ---------------------------------------------------------------------------
// The Drowned Court (odd slots): colonnade nave-and-aisle grammar.
// ---------------------------------------------------------------------------

const DC = DROWNED_COURT_LAYOUT;
const DC_MAP = arenaMapForSlot(1);
const DC_SPAWNS = [DC_MAP.spawnA, DC_MAP.spawnB, ...DC_MAP.spawnsA2v2, ...DC_MAP.spawnsB2v2];

describe('drowned court layout: bounds and symmetry', () => {
  const pointKey = (x: number, z: number) => `${x},${z}`;

  it('shares the exact pit bounds and wall contract with the Coliseum', () => {
    expect(DC.zMin).toBe(ARENA_LAYOUT.zMin);
    expect(DC.zMax).toBe(ARENA_LAYOUT.zMax);
    expect(DC.sideWallZ).toBe(ARENA_LAYOUT.sideWallZ);
    expect(DC.sideWallHd).toBe(ARENA_LAYOUT.sideWallHd);
    expect(DC.wallX).toBeUndefined();
    expect(DC.stubs).toHaveLength(0);
    expect(DC.dais).toEqual({ x: 0, z: 2, r: 6 });
  });

  it('pillars and reliquaries are symmetric about x=0 and about z=sideWallZ', () => {
    for (const list of [DC.pillars, DC.tombs]) {
      const set = new Set(list.map((p) => pointKey(p.x, p.z)));
      expect(set.size).toBe(list.length);
      for (const p of list) {
        expect(set.has(pointKey(-p.x, p.z))).toBe(true);
        expect(set.has(pointKey(p.x, MIRROR_Z - p.z))).toBe(true);
      }
    }
    // the approved colonnade grammar: two rows of five at |x|=8
    expect(DC.pillars).toHaveLength(10);
    expect(new Set(DC.pillars.map((p) => Math.abs(p.x)))).toEqual(new Set([8]));
    expect(DC.tombs).toHaveLength(4);
  });

  it('spawn B mirrors spawn A through the centre line (1v1 and 2v2)', () => {
    expect(DC_MAP.spawnB.x + DC_MAP.spawnA.x).toBe(0);
    expect(DC_MAP.spawnB.z).toBe(MIRROR_Z - DC_MAP.spawnA.z);
    expect(DC_MAP.spawnA.facing).toBe(0);
    expect(DC_MAP.spawnB.facing).toBe(Math.PI);
    const bKeys = new Set(DC_MAP.spawnsB2v2.map((s) => pointKey(s.x, s.z)));
    for (const s of DC_MAP.spawnsA2v2) {
      expect(bKeys.has(pointKey(s.x, MIRROR_Z - s.z))).toBe(true);
      expect(bKeys.has(pointKey(-s.x, MIRROR_Z - s.z))).toBe(true);
    }
  });
});

describe('drowned court layout: clear zones and walkable lanes', () => {
  it('every spawn sits inside the pit with no collider within 4yd', () => {
    const colliders = layoutColliders(DC);
    for (const s of DC_SPAWNS) {
      expect(Math.abs(s.x)).toBeLessThan(DUNGEON_WALL_X - DUNGEON_WALL_HW);
      expect(s.z).toBeGreaterThan(DC.zMin + DUNGEON_WALL_HW);
      expect(s.z).toBeLessThan(DC.zMax - DUNGEON_WALL_HW);
      for (const c of colliders) {
        expect(surfaceDistance(c, s.x, s.z)).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('every gap between cover pieces is walkable (>=3yd), nothing sealed', () => {
    const cover = coverColliders(DC);
    for (let i = 0; i < cover.length; i++) {
      for (let j = i + 1; j < cover.length; j++) {
        expect(obstacleGap(cover[i], cover[j])).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('nave and aisles hold their designed widths, and walls keep a 3yd lane', () => {
    // centre nave between the colonnades' inner faces
    expect(2 * (8 - PILLAR_COLLIDER_R)).toBeGreaterThanOrEqual(3);
    // aisle between a colonnade's outer face and the wall's inner face
    const innerX = DUNGEON_WALL_X - DUNGEON_WALL_HW;
    expect(innerX - (8 + PILLAR_COLLIDER_R)).toBeGreaterThanOrEqual(3);
    const innerZMin = DC.zMin + DUNGEON_WALL_HW;
    const innerZMax = DC.zMax - DUNGEON_WALL_HW;
    for (const c of coverColliders(DC)) {
      const rx = c.type === 'circle' ? c.r : c.hw;
      const rz = c.type === 'circle' ? c.r : c.hd;
      expect(innerX - (Math.abs(c.x) + rx)).toBeGreaterThanOrEqual(3);
      expect(c.z - rz - innerZMin).toBeGreaterThanOrEqual(3);
      expect(innerZMax - (c.z + rz)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('drowned court: line-of-sight grammar', () => {
  const SEED = 1;
  const odd = arenaOrigin(1);
  const at = (o: { x: number; z: number }, p: { x: number; z: number }) => ({
    x: o.x + p.x,
    z: o.z + p.z,
  });

  it('the nave is an open sightline: the 1v1 spawns SEE each other', () => {
    // deliberately opposite to the Coliseum's screened opener
    expect(lineOfSightClear(SEED, at(odd, DC_MAP.spawnA), at(odd, DC_MAP.spawnB))).toBe(true);
  });

  it('a colonnade pillar breaks cross-aisle sight, a reliquary breaks the aisle', () => {
    // across the west colonnade pillar at (-8,-6)
    expect(lineOfSightClear(SEED, at(odd, { x: -12, z: -6 }), at(odd, { x: -4, z: -6 }))).toBe(
      false,
    );
    // along the east aisle across the reliquary at (16,-8)
    expect(lineOfSightClear(SEED, at(odd, { x: 16, z: -13 }), at(odd, { x: 16, z: -3 }))).toBe(
      false,
    );
    // the same aisle run is open where there is no reliquary (z 2 band)
    expect(lineOfSightClear(SEED, at(odd, { x: 20, z: -13 }), at(odd, { x: 20, z: -3 }))).toBe(
      true,
    );
  });
});

describe('arena slot parity: per-slot colliders', () => {
  it('even slots derive Coliseum colliders, odd slots Drowned Court', () => {
    expect(arenaCollidersForSlot(0)).toEqual(layoutColliders(ARENA_LAYOUT));
    expect(arenaCollidersForSlot(2)).toEqual(layoutColliders(ARENA_LAYOUT));
    expect(arenaCollidersForSlot(1)).toEqual(layoutColliders(DROWNED_COURT_LAYOUT));
    expect(arenaCollidersForSlot(3)).toEqual(layoutColliders(DROWNED_COURT_LAYOUT));
    // one representative per map: the Coliseum's centre-diamond post exists
    // only on even slots, the Drowned Court's colonnade only on odd ones
    const diamond = (c: Collider) => c.type === 'circle' && c.x === 0 && c.z === -4;
    const colonnade = (c: Collider) => c.type === 'circle' && c.x === 8 && c.z === -6;
    expect(arenaCollidersForSlot(0).some(diamond)).toBe(true);
    expect(arenaCollidersForSlot(0).some(colonnade)).toBe(false);
    expect(arenaCollidersForSlot(1).some(diamond)).toBe(false);
    expect(arenaCollidersForSlot(1).some(colonnade)).toBe(true);
  });

  it('the world-level collision band resolves per slot (LoS proof)', () => {
    // (0,-8) to (0,2) crosses the Coliseum diamond post at (0,-4) on an even
    // slot; the Drowned Court's nave is open on the same local segment.
    const SEED = 1;
    const seg = (o: { x: number; z: number }) =>
      lineOfSightClear(SEED, { x: o.x, z: o.z - 8 }, { x: o.x, z: o.z + 2 });
    expect(seg(arenaOrigin(0))).toBe(false);
    expect(seg(arenaOrigin(2))).toBe(false);
    expect(seg(arenaOrigin(1))).toBe(true);
    expect(seg(arenaOrigin(3))).toBe(true);
  });
});
