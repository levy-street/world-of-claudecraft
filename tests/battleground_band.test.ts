// Ravenrift at THORNHOLLOW: the sim-side pins for the authored field.
//
// The field is no longer code-defined geometry: it is compiled from
// data/battleground/thornhollow.map.json into src/sim/thornhollow_field.generated.ts,
// so these tests pin the four things that can actually regress:
//   1. terrain fidelity   - the compile-time chain, the runtime chain and the
//                           baked 1yd grid all agree, and groundHeight's band
//                           arm reads that same grid;
//   2. generated freshness - recompiling the map reproduces the committed module;
//   3. anchors            - the game-mode record the mode reasons about;
//   4. walkability        - a flood fill through the REAL collider grid reaches
//                           every anchor, both flags and the keep ramparts.
// Plus collision honesty (walls block, the keep mouth is open, what blocks a
// cast is taller than the eye line) and the band's slot isolation.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BG_MATCH_DROP_RADIUS, BG_MATCH_INTEREST_RADIUS } from '../server/game';
import { bgFieldExactHeight, bgFieldHeightLocal } from '../src/sim/battleground_field';
import {
  BG_BASES,
  BG_FLAG_Z,
  BG_GRAVEYARDS,
  BG_HALF_X,
  BG_HALF_Z,
  BG_PLAY_HALF_X,
  BG_PLAY_HALF_Z,
  BG_POWER_RUNES,
  BG_SPEED_RUNES,
  battlegroundColliders,
  bgFieldPlanWalls,
} from '../src/sim/battleground_layout';
import {
  cameraOcclusion,
  isBlocked,
  lineOfSightClear,
  resolvePosition,
  SIGHT_HEIGHT,
  supportHeightAt,
} from '../src/sim/colliders';
import {
  BG_BAND_X_MAX,
  BG_BAND_X_MIN,
  BG_SLOT_COUNT,
  BG_X,
  battlegroundOrigin,
  bgOriginAt,
  DELVE_BAND_X_MIN,
  isArenaPos,
  isBgPos,
  isDelvePos,
  isYumiMazePos,
  YUMI_BAND_X_MAX,
} from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { BG_PICKUP_RADIUS } from '../src/sim/social/battleground';
import { bgGraveyardSpot } from '../src/sim/spirit';
import {
  TH_HEIGHT_PROBES,
  TH_LOCATIONS,
  TH_PLACEMENTS,
} from '../src/sim/thornhollow_field.generated';
import { groundHeight } from '../src/sim/world';

const SEED = 42;
const ORIGIN = battlegroundOrigin(0);

const locationRect = (name: string) => {
  const rect = TH_LOCATIONS.find((l) => l.name === name);
  if (!rect) throw new Error(`no authored location named ${name}`);
  return rect;
};
const locationCentre = (name: string) => {
  const r = locationRect(name);
  return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
};

describe('Ravenrift band: non-overlap with every other instance band', () => {
  it('claims a band past the Yumi cap and stays west of the Vale Cup pitches', () => {
    expect(BG_BAND_X_MIN).toBeGreaterThanOrEqual(YUMI_BAND_X_MAX);
    // Vale Cup practice pitches sit at x = 30000 (vale_cup_layout.ts
    // vcPracticeOrigin); the two-sided cap keeps them unclassified as bg.
    expect(BG_BAND_X_MAX).toBeLessThanOrEqual(30000);
    expect(isBgPos(30000)).toBe(false);
  });

  it('classifies exclusively: no x is ever in two bands', () => {
    // sweep the whole instanced range at 50yd steps
    for (let x = 500; x <= 31000; x += 50) {
      const claims = [isArenaPos(x), isDelvePos(x), isYumiMazePos(x), isBgPos(x)].filter(
        Boolean,
      ).length;
      expect(claims, `x=${x} claimed by ${claims} bands`).toBeLessThanOrEqual(1);
    }
    // the band's own edges
    expect(isBgPos(BG_BAND_X_MIN)).toBe(true);
    expect(isBgPos(BG_BAND_X_MAX)).toBe(false);
    expect(isBgPos(BG_BAND_X_MIN - 1)).toBe(false);
    expect(isDelvePos(BG_X)).toBe(false);
    expect(isArenaPos(BG_X)).toBe(false);
    expect(isYumiMazePos(BG_X)).toBe(false);
    // the arena/delve bands are untouched by the addition
    expect(isArenaPos(4200)).toBe(true);
    expect(isDelvePos(DELVE_BAND_X_MIN)).toBe(true);
  });

  it('every slot footprint fits inside the band and slots never overlap', () => {
    for (let i = 0; i < BG_SLOT_COUNT; i++) {
      const o = battlegroundOrigin(i);
      expect(isBgPos(o.x - BG_HALF_X)).toBe(true);
      expect(isBgPos(o.x + BG_HALF_X)).toBe(true);
      expect(bgOriginAt(o.z).slot).toBe(i);
      if (i > 0) {
        const prev = battlegroundOrigin(i - 1);
        // slot spacing clears the full authored field length (2 x 226yd)
        expect(Math.abs(o.z - prev.z)).toBeGreaterThan(BG_HALF_Z * 2);
      }
    }
  });
});

describe('Thornhollow terrain: one surface for the compiler, the sim and the grid', () => {
  it('the runtime stamp chain reproduces every build-time probe to 1e-3', () => {
    // TH_HEIGHT_PROBES are heights the COMPILER measured with its own copy of
    // the stamp chain. bgFieldExactHeight is the sim's copy. If the two ports
    // ever drift (a brush falloff, the splatter mask, the level/add mode),
    // every collider seat and placement seat the compiler baked is wrong.
    expect(TH_HEIGHT_PROBES.length).toBeGreaterThanOrEqual(24);
    let worst = 0;
    for (const p of TH_HEIGHT_PROBES) {
      const d = Math.abs(bgFieldExactHeight(p.x, p.z) - p.h);
      if (d > worst) worst = d;
      expect(d, `exact chain at (${p.x}, ${p.z})`).toBeLessThan(1e-3);
    }
    // Measured max: 2.24e-4 (pure float/rounding). Pin the observed order of
    // magnitude too, so a real drift cannot hide under the 1e-3 gate.
    expect(worst).toBeLessThan(5e-4);
  });

  it('the baked 1yd grid reproduces every build-time probe within 0.1yd', () => {
    // The shipped heightfield is a 1yd, 1cm-quantized bilinear grid, so it
    // rounds curvature between nodes. Measured max error over the 42 authored
    // probes: 0.0644yd; the pin sits just above it.
    let worst = 0;
    for (const p of TH_HEIGHT_PROBES) {
      const d = Math.abs(bgFieldHeightLocal(p.x, p.z) - p.h);
      if (d > worst) worst = d;
      expect(d, `baked grid at (${p.x}, ${p.z})`).toBeLessThan(0.1);
    }
    expect(worst).toBeGreaterThan(0); // interpolation error is real, not a stub
    expect(worst).toBeLessThan(0.08);
  });

  it('at a grid NODE the baked value is the exact chain to within quantization', () => {
    // Between nodes the grid interpolates; ON a node it must be the chain
    // itself, give or take the 1cm store. This is what proves the bake is the
    // same surface rather than a plausible-looking second one.
    let worst = 0;
    for (let x = -110; x <= 110; x += 7) {
      for (let z = -220; z <= 220; z += 11) {
        worst = Math.max(worst, Math.abs(bgFieldExactHeight(x, z) - bgFieldHeightLocal(x, z)));
      }
    }
    expect(worst).toBeLessThan(0.011); // 1cm quantization plus float slop
  });

  it('groundHeight in the band IS the field grid, at every landmark', () => {
    // The whole design rests on one surface: sim movement, sight, the camera,
    // the renderer and the server all sample groundHeight. Probe the landmarks
    // the mode is built around, in WORLD coordinates, through the real arm.
    const keep = locationCentre('Crimson Keep');
    const marks: [string, number, number, number][] = [
      // name, local x, local z, expected height
      ['Crimson flag plateau', 0, -BG_FLAG_Z, 11],
      ['Azure flag plateau', 0, BG_FLAG_Z, 11],
      ['Crimson keep centre', keep.x, keep.z, 11],
      ['Fightpit floor', 0, 0, -8.99],
      ['Whistlerock Ridge', -70, 0, 7.21],
      ['Sablepine Ridge', 70, 0, 7.09],
    ];
    for (const [name, lx, lz, expected] of marks) {
      const world = groundHeight(ORIGIN.x + lx, ORIGIN.z + lz, SEED);
      expect(world, `${name} world height`).toBeCloseTo(bgFieldHeightLocal(lx, lz), 9);
      expect(world, `${name} authored height`).toBeCloseTo(expected, 1);
    }
    // The keeps stand two storeys over the Fightpit: that relief is the field.
    expect(
      groundHeight(ORIGIN.x, ORIGIN.z - BG_FLAG_Z, SEED) - groundHeight(ORIGIN.x, ORIGIN.z, SEED),
    ).toBeGreaterThan(18);
    // Every slot reads the SAME field (the arm resolves the origin by z band).
    for (let slot = 0; slot < BG_SLOT_COUNT; slot++) {
      const o = battlegroundOrigin(slot);
      expect(groundHeight(o.x, o.z, SEED)).toBeCloseTo(bgFieldHeightLocal(0, 0), 9);
      expect(groundHeight(o.x - 40, o.z + 90, SEED)).toBeCloseTo(bgFieldHeightLocal(-40, 90), 9);
    }
  });

  it('pins the authored 334-yard flag run', () => {
    expect(BG_FLAG_Z).toBe(167);
    expect(BG_FLAG_Z * 2).toBe(334);
  });

  it('the field outside the band is untouched: groundHeight only branches on x', () => {
    // A band arm that leaked into the open world would break every other zone.
    expect(isBgPos(BG_BAND_X_MIN - 1)).toBe(false);
    expect(groundHeight(0, 0, SEED)).not.toBeCloseTo(bgFieldHeightLocal(0, 0), 3);
  });
});

describe('Thornhollow generated module: fresh against the authored map', () => {
  it('recompiling data/battleground/*.json reproduces the committed field module', () => {
    // The generated module is the only thing the game reads, so a map edit that
    // was never recompiled is invisible until someone walks through a wall.
    // Recompile into a temp path (the compiler takes an out-path argument for
    // exactly this) and diff; the working tree is never touched.
    const root = fileURLToPath(new URL('..', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'thornhollow-'));
    try {
      const out = join(dir, 'thornhollow_field.generated.ts');
      execFileSync(process.execPath, [join(root, 'scripts/assets/compile_thornhollow.mjs'), out], {
        cwd: root,
        stdio: 'pipe',
        timeout: 120000,
      });
      const fresh = readFileSync(out, 'utf8');
      const committed = readFileSync(join(root, 'src/sim/thornhollow_field.generated.ts'), 'utf8');
      expect(fresh.length).toBeGreaterThan(10000); // the compiler really ran
      expect(
        fresh === committed,
        'src/sim/thornhollow_field.generated.ts is stale: re-run ' +
          '`node scripts/assets/compile_thornhollow.mjs` and commit the result',
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180000);
});

describe('Thornhollow anchors: the game-mode record, authored symmetric', () => {
  const mirrorDist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.hypot(a.x + b.x, a.z + b.z);
  // Worst "nearest point mirror" over a whole set: the anchors mirror as SETS
  // (the spawn ring's two wings are authored in opposite index order).
  const setMirrorError = (list: readonly { x: number; z: number }[]) => {
    let worst = 0;
    for (const a of list) {
      let best = Infinity;
      for (const b of list) best = Math.min(best, mirrorDist(a, b));
      worst = Math.max(worst, best);
    }
    return worst;
  };

  it('both teams get exactly one flag, five spawns, one banner and one plot', () => {
    expect(BG_BASES).toHaveLength(2);
    expect(BG_BASES.map((b) => b.team).sort()).toEqual([0, 1]);
    for (const base of BG_BASES) {
      expect(base.spawns, `team ${base.team} spawn ring`).toHaveLength(5);
      // Distinct spots: a duplicated spawn would stack two fighters.
      const spots = new Set(base.spawns.map((s) => `${s.x}|${s.z}`));
      expect(spots.size).toBe(5);
      expect(Math.sign(base.flag.z)).toBe(base.team === 0 ? -1 : 1);
      expect(Math.sign(base.banner.z)).toBe(Math.sign(base.flag.z));
      for (const s of base.spawns) expect(Math.sign(s.z)).toBe(Math.sign(base.flag.z));
    }
    expect(BG_GRAVEYARDS).toHaveLength(2);
    expect(Math.sign(BG_GRAVEYARDS[0].z)).toBe(-1);
    expect(Math.sign(BG_GRAVEYARDS[1].z)).toBe(1);
  });

  it('flags sit on the |z| = BG_FLAG_Z line, centred and inside the play rect', () => {
    for (const base of BG_BASES) {
      expect(Math.abs(base.flag.z)).toBe(BG_FLAG_Z);
      expect(base.flag.x).toBe(0);
      expect(Math.abs(base.flag.z)).toBeLessThan(BG_PLAY_HALF_Z);
    }
    // The flag stands are inside their authored keep rects.
    for (const [team, name] of [
      [0, 'Crimson Keep'],
      [1, 'Azure Keep'],
    ] as const) {
      const r = locationRect(name);
      const f = BG_BASES[team].flag;
      expect(f.x).toBeGreaterThan(r.minX);
      expect(f.x).toBeLessThan(r.maxX);
      expect(f.z).toBeGreaterThan(r.minZ);
      expect(f.z).toBeLessThan(r.maxZ);
    }
  });

  it('flags, spawn rings, graveyards and banners point-mirror between the teams', () => {
    // Unlike the organic art scatter, the ANCHORS are authored symmetric: this
    // is the "neither team is favoured" pin, and it is the one that catches a
    // map edit that moved one side only.
    expect(mirrorDist(BG_BASES[0].flag, BG_BASES[1].flag)).toBeLessThan(1e-6);
    expect(mirrorDist(BG_GRAVEYARDS[0], BG_GRAVEYARDS[1])).toBeLessThan(1e-6);
    expect(BG_GRAVEYARDS[1].hw).toBe(BG_GRAVEYARDS[0].hw);
    expect(BG_GRAVEYARDS[1].hd).toBe(BG_GRAVEYARDS[0].hd);
    // Spawn rings mirror as SETS, exactly (measured worst 0).
    for (const s of BG_BASES[0].spawns) {
      const twin = BG_BASES[1].spawns.find((t) => mirrorDist(s, t) < 1e-6);
      expect(twin, `spawn (${s.x}, ${s.z}) has no mirrored twin`).toBeTruthy();
    }
    expect(setMirrorError([...BG_BASES[0].spawns, ...BG_BASES[1].spawns])).toBeLessThan(1e-6);
    // The banners are placed art, seated by hand: measured mirror offset 0.90yd.
    // Pinned at 1.5yd so a banner that wandered to the wrong side of a keep
    // fails while the authored jitter passes.
    expect(mirrorDist(BG_BASES[0].banner, BG_BASES[1].banner)).toBeLessThan(1.5);
  });

  it('six speed pads and four power pads, point-mirrored as sets', () => {
    expect(BG_SPEED_RUNES).toHaveLength(6);
    expect(BG_POWER_RUNES).toHaveLength(4);
    // Measured set-mirror error: speed 0.0075yd (one pad seated by hand),
    // power 0. A pad moved to one team's half breaks these by yards.
    expect(setMirrorError(BG_SPEED_RUNES)).toBeLessThan(0.05);
    expect(setMirrorError(BG_POWER_RUNES)).toBeLessThan(1e-6);
    // Every pad inside the play rect, and none of them buried in a collider.
    for (const r of [...BG_SPEED_RUNES, ...BG_POWER_RUNES]) {
      expect(Math.abs(r.x), `rune (${r.x}, ${r.z}) x`).toBeLessThanOrEqual(BG_PLAY_HALF_X);
      expect(Math.abs(r.z), `rune (${r.x}, ${r.z}) z`).toBeLessThanOrEqual(BG_PLAY_HALF_Z);
      const p = resolvePosition(SEED, ORIGIN.x + r.x, ORIGIN.z + r.z, 0.5);
      expect(p.x, `rune (${r.x}, ${r.z}) is walkable`).toBeCloseTo(ORIGIN.x + r.x, 5);
      expect(p.z, `rune (${r.x}, ${r.z}) is walkable`).toBeCloseTo(ORIGIN.z + r.z, 5);
    }
    // The two lane pads and the two ridge pads are on opposite halves.
    expect(BG_SPEED_RUNES.filter((r) => r.z < 0)).toHaveLength(2);
    expect(BG_SPEED_RUNES.filter((r) => r.z > 0)).toHaveLength(2);
    expect(BG_POWER_RUNES.filter((r) => r.z < 0)).toHaveLength(2);
    expect(BG_POWER_RUNES.filter((r) => r.z > 0)).toHaveLength(2);
  });

  it('graveyard release spots settle inside their own plot, clear of geometry', () => {
    for (const plot of BG_GRAVEYARDS) {
      expect(Math.abs(plot.x) + plot.hw).toBeLessThanOrEqual(BG_PLAY_HALF_X);
      expect(Math.abs(plot.z) + plot.hd).toBeLessThanOrEqual(BG_PLAY_HALF_Z);
    }
    const fakeMatch = {
      slot: 0,
      teams: [
        [101, 102, 103, 104, 105],
        [201, 202, 203, 204, 205],
      ],
    } as unknown as Parameters<typeof bgGraveyardSpot>[0];
    for (const pid of [...fakeMatch.teams[0], ...fakeMatch.teams[1]]) {
      const spot = bgGraveyardSpot(fakeMatch, pid);
      const r = resolvePosition(SEED, spot.x, spot.z, 0.5);
      // Two of the five spots per team sit inside a headstone footprint and
      // get pushed clear (measured 0.91yd and 0.66yd). That is survivable, a
      // spirit never lands INSIDE the stone; what is not survivable is a spot
      // the solver cannot settle, or one shoved out of its own plot.
      const nudge = Math.hypot(r.x - spot.x, r.z - spot.z);
      expect(nudge, `spot for ${pid} nudge`).toBeLessThan(1);
      const settled = resolvePosition(SEED, r.x, r.z, 0.5);
      expect(settled.x, `spot for ${pid} settles`).toBeCloseTo(r.x, 6);
      expect(settled.z, `spot for ${pid} settles`).toBeCloseTo(r.z, 6);
      const team = pid >= 200 ? 1 : 0;
      const plot = BG_GRAVEYARDS[team];
      expect(Math.abs(r.x - (ORIGIN.x + plot.x))).toBeLessThanOrEqual(plot.hw);
      expect(Math.abs(r.z - (ORIGIN.z + plot.z))).toBeLessThanOrEqual(plot.hd);
    }
  });

  it('spawn rings and flag stands are seated on the keep plateau', () => {
    for (const base of BG_BASES) {
      for (const s of base.spawns) {
        const p = resolvePosition(SEED, ORIGIN.x + s.x, ORIGIN.z + s.z, 0.5);
        expect(p.x, `spawn (${s.x}, ${s.z})`).toBeCloseTo(ORIGIN.x + s.x, 5);
        expect(p.z, `spawn (${s.x}, ${s.z})`).toBeCloseTo(ORIGIN.z + s.z, 5);
        // On the plateau, not down the keep face, and never on the flag stand.
        expect(bgFieldHeightLocal(s.x, s.z), `spawn (${s.x}, ${s.z}) height`).toBeGreaterThan(9);
        expect(Math.hypot(s.x - base.flag.x, s.z - base.flag.z)).toBeGreaterThan(BG_PICKUP_RADIUS);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Walkability: the decisive test. A breadth-first flood over the play rect,
// through the SAME collider grid, ground arm and standable-support query the
// movement kernel uses, at the body radius and the physics step-up limit.
// ---------------------------------------------------------------------------

const FLOOD_CELL = 0.5; // fine enough to thread the keep-gate mouth and the
// stair runs onto the flag plinth (a 1yd lattice misses the plinth steps by
// half a cell and reports the Azure flag 6yd out of reach); the whole flood
// still runs in about 0.6s.
const BODY_RADIUS = 0.5;
const STEP_UP = 0.9; // src/sim/physics/character.ts MAX_STEP_HEIGHT
const MANTLE = 0.7; // src/sim/colliders.ts MANTLE_REACH
const MAX_DROP = 6;

interface Flood {
  cols: number;
  rows: number;
  /** Distance from (x, z) to the nearest cell the flood reached. */
  nearest: (x: number, z: number) => number;
  /** Did the flood reach the cell that (x, z) itself falls in? */
  visitedAt: (x: number, z: number) => boolean;
  reached: number;
}

function floodPlayRect(): Flood {
  const cols = Math.round((BG_PLAY_HALF_X * 2) / FLOOD_CELL) + 1;
  const rows = Math.round((BG_PLAY_HALF_Z * 2) / FLOOD_CELL) + 1;
  const idx = (c: number, r: number) => c * rows + r;
  const cellX = (c: number) => -BG_PLAY_HALF_X + c * FLOOD_CELL;
  const cellZ = (r: number) => -BG_PLAY_HALF_Z + r * FLOOD_CELL;
  // The surface a body would stand on: terrain, or an authored deck top within
  // reach of the feet (what the movement kernel maxes against the terrain).
  const surfaceAt = (lx: number, lz: number, feetY: number) =>
    Math.max(
      groundHeight(ORIGIN.x + lx, ORIGIN.z + lz, SEED),
      supportHeightAt(SEED, ORIGIN.x + lx, ORIGIN.z + lz, BODY_RADIUS, feetY + MANTLE),
    );
  const freeAt = (lx: number, lz: number, feetY: number) => {
    const wx = ORIGIN.x + lx;
    const wz = ORIGIN.z + lz;
    const res = resolvePosition(SEED, wx, wz, BODY_RADIUS, false, undefined, {
      y: feetY + 0.05,
      lift: 0,
    });
    return Math.abs(res.x - wx) < 1e-3 && Math.abs(res.z - wz) < 1e-3;
  };

  const visited = new Uint8Array(cols * rows);
  const heightOf = new Float32Array(cols * rows);
  const start = BG_BASES[0].spawns[0];
  const c0 = Math.round((start.x + BG_PLAY_HALF_X) / FLOOD_CELL);
  const r0 = Math.round((start.z + BG_PLAY_HALF_Z) / FLOOD_CELL);
  const stack: number[] = [idx(c0, r0)];
  visited[idx(c0, r0)] = 1;
  heightOf[idx(c0, r0)] = surfaceAt(cellX(c0), cellZ(r0), Number.POSITIVE_INFINITY);
  const NB = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let reached = 1;
  while (stack.length) {
    const cur = stack.pop() as number;
    const c = Math.floor(cur / rows);
    const r = cur % rows;
    const y = heightOf[cur];
    for (const [dc, dr] of NB) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = idx(nc, nr);
      if (visited[ni]) continue;
      const lx = cellX(nc);
      const lz = cellZ(nr);
      const ny = surfaceAt(lx, lz, y + STEP_UP);
      if (ny - y > STEP_UP) continue; // too tall to stride onto
      if (y - ny > MAX_DROP) continue; // a fall, not a walk
      if (!freeAt(lx, lz, ny)) continue; // a collider stands there
      visited[ni] = 1;
      heightOf[ni] = ny;
      reached++;
      stack.push(ni);
    }
  }
  const nearest = (x: number, z: number) => {
    let best = Number.POSITIVE_INFINITY;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!visited[idx(c, r)]) continue;
        const d = Math.hypot(cellX(c) - x, cellZ(r) - z);
        if (d < best) best = d;
      }
    }
    return best;
  };
  const visitedAt = (x: number, z: number) => {
    const c = Math.round((x + BG_PLAY_HALF_X) / FLOOD_CELL);
    const r = Math.round((z + BG_PLAY_HALF_Z) / FLOOD_CELL);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    return visited[idx(c, r)] === 1;
  };
  return { cols, rows, nearest, visitedAt, reached };
}

describe('Thornhollow walkability: one connected field, both keeps included', () => {
  const flood = floodPlayRect();
  // "Standable" = the flood reached a cell inside one flood cell of the point.
  const reaches = (x: number, z: number) => flood.nearest(x, z) <= FLOOD_CELL + 1e-9;

  it('the flood covers most of the play rect from a single Crimson spawn', () => {
    // A field that fell into disconnected pockets (a wall closed a lane, the
    // ravine sealed a ridge) collapses this number; a field that lost its
    // colliders entirely would push it near 100%.
    const share = flood.reached / (flood.cols * flood.rows);
    expect(share).toBeGreaterThan(0.6);
    expect(share).toBeLessThan(0.95);
  });

  it('reaches BOTH spawn rings, so the two teams share one field', () => {
    for (const base of BG_BASES) {
      for (const s of base.spawns) {
        expect(reaches(s.x, s.z), `team ${base.team} spawn (${s.x}, ${s.z})`).toBe(true);
      }
      // The banner point is the pole itself (a collider), so what has to be
      // walkable is the ground beside it.
      expect(
        flood.nearest(base.banner.x, base.banner.z),
        `team ${base.team} banner surround`,
      ).toBeLessThan(2);
    }
  });

  it('reaches both graveyards and every rune pad', () => {
    for (const [i, g] of BG_GRAVEYARDS.entries()) {
      expect(reaches(g.x, g.z), `graveyard ${i}`).toBe(true);
    }
    for (const r of [...BG_SPEED_RUNES, ...BG_POWER_RUNES]) {
      expect(reaches(r.x, r.z), `rune (${r.x}, ${r.z})`).toBe(true);
    }
  });

  it('reaches the Fightpit floor and both flank ridges', () => {
    for (const name of ['The Fightpit', 'Whistlerock Ridge', 'Sablepine Ridge']) {
      const c = locationCentre(name);
      expect(reaches(c.x, c.z), name).toBe(true);
    }
    // The Fightpit really is the sunken middle and the ridges really are high:
    // reaching a flat field would pass the check above but not this one.
    expect(bgFieldHeightLocal(0, 0)).toBeLessThan(-8);
    expect(bgFieldHeightLocal(-70, 0)).toBeGreaterThan(6);
    expect(bgFieldHeightLocal(70, 0)).toBeGreaterThan(6);
  });

  it('a stand within the flag pickup radius is reachable at BOTH flags', () => {
    // The flag sits on an authored plinth; only the plinth stairs put a body
    // in reach. Measured nearest reachable stand: Crimson 3.00yd, Azure 3.50yd
    // against a 4yd reach, so a plinth step that stopped working fails here.
    for (const base of BG_BASES) {
      const d = flood.nearest(base.flag.x, base.flag.z);
      expect(d, `team ${base.team} flag reach`).toBeLessThanOrEqual(BG_PICKUP_RADIUS);
    }
  });

  it('the keep rampart decks are reachable, proving the authored stairs work', () => {
    // The rampart deck over each keep gate sits at moveTopY 16.7, 5.7yd over
    // the keep plateau: unreachable without the authored stair runs, so this
    // is the standable-deck path end to end (support query, step-up, mantle).
    for (const [lx, lz] of [
      [-26, -137.5],
      [26, 137.5],
    ]) {
      expect(reaches(lx, lz), `rampart deck (${lx}, ${lz})`).toBe(true);
      // and it really is a deck ABOVE the plateau, not just open ground
      expect(supportHeightAt(SEED, ORIGIN.x + lx, ORIGIN.z + lz, BODY_RADIUS, 999)).toBeGreaterThan(
        groundHeight(ORIGIN.x + lx, ORIGIN.z + lz, SEED) + 5,
      );
    }
  });

  it('the flood is bounded by real geometry, not by the rect edge', () => {
    // Sanity that the walk is honest: the cells inside a keep curtain
    // footprint are NOT reached even though they sit well inside the play
    // rect, and neither is the deep ravine wall behind the west ridge.
    for (const [lx, lz] of [
      [-20, -134],
      [20, -134],
      [-20, 134],
      [20, 134],
    ]) {
      expect(flood.visitedAt(lx, lz), `curtain footprint (${lx}, ${lz})`).toBe(false);
      expect(isBlocked(SEED, ORIGIN.x + lx, ORIGIN.z + lz, BODY_RADIUS)).toBe(true);
    }
    // and the flood really did stop somewhere: a fully open rect would be 100%
    expect(flood.reached).toBeLessThan(flood.cols * flood.rows);
  });
});

describe('Thornhollow collision honesty: what blocks, blocks; what opens, opens', () => {
  it('keeps ordinary movers from climbing both authored ridge walls', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, noPlayer: true });
    for (const sign of [-1, 1]) {
      const start = {
        x: ORIGIN.x + sign * 87,
        y: groundHeight(ORIGIN.x + sign * 87, ORIGIN.z + sign * 54, SEED),
        z: ORIGIN.z + sign * 54,
      };
      const mover = { templateId: 'forest_wolf', pos: start, facing: 0 };
      const dest = { x: ORIGIN.x + sign * 94, y: 30, z: ORIGIN.z + sign * 54 };
      for (let tick = 0; tick < 20; tick++) {
        (
          sim as unknown as { moveToward(e: typeof mover, d: typeof dest, speed: number): boolean }
        ).moveToward(mover, dest, 7);
      }
      expect(mover.pos.y, `ridge side ${sign}`).toBeLessThan(10);
      expect(Math.abs(mover.pos.x - ORIGIN.x), `ridge side ${sign}`).toBeLessThan(89);
    }
  });

  it('uses elevated deck height for battleground spell sight', () => {
    const from = { x: ORIGIN.x - 26, z: ORIGIN.z - 137.5 };
    const to = { x: ORIGIN.x - 43.5, z: ORIGIN.z - 144 };
    const fromY = supportHeightAt(SEED, from.x, from.z, 0.45, 999);
    const toY = supportHeightAt(SEED, to.x, to.z, 0.45, 999);
    expect(fromY).toBeCloseTo(16.7, 4);
    expect(toY).toBeCloseTo(16.7, 4);
    expect(lineOfSightClear(SEED, { ...from, y: fromY }, { ...to, y: toY })).toBe(true);
    expect(lineOfSightClear(SEED, from, to)).toBe(false);
  });

  it('routes the chase-camera sweep through battleground colliders', () => {
    const zFrom = ORIGIN.z - 130;
    const zTo = ORIGIN.z - 137;
    const wall = cameraOcclusion(SEED, ORIGIN.x - 5.13, 13, zFrom, ORIGIN.x - 5.13, 13, zTo);
    const gate = cameraOcclusion(SEED, ORIGIN.x, 13, zFrom, ORIGIN.x, 13, zTo);
    expect(wall).toBeGreaterThan(0);
    expect(wall).toBeLessThan(1);
    expect(gate).toBe(1);
  });

  it('the keep curtain blocks along its whole run, both keeps', () => {
    for (const z of [-134, -136, -138, -140, 134, 136, 138, 140]) {
      for (const x of [-40, -30, -20, -10, 10, 20, 30, 40]) {
        expect(isBlocked(SEED, ORIGIN.x + x, ORIGIN.z + z, 0.5), `curtain at (${x}, ${z})`).toBe(
          true,
        );
      }
    }
  });

  it('the keep gate mouth is open through the curtain', () => {
    for (const z of [-134, -136, -138, -140, 134, 136, 138, 140]) {
      for (const x of [-2, 0, 2]) {
        expect(isBlocked(SEED, ORIGIN.x + x, ORIGIN.z + z, 0.5), `gate mouth at (${x}, ${z})`).toBe(
          false,
        );
      }
    }
  });

  it('every structural wall stands above the eye line where it stands', () => {
    // bgFieldPlanWalls is the projection the minimap draws: the blocking boxes
    // that stand taller than a step. A wall whose camera top sat under
    // SIGHT_HEIGHT would block a cast the player can see straight over (issue
    // #1668's shape). Standable decks are exempt: a tread is meant to be low.
    const walls = bgFieldPlanWalls();
    expect(walls.length).toBeGreaterThan(300);
    for (const w of walls) {
      const ground = bgFieldHeightLocal(w.x, w.z);
      expect(w.top - ground).toBeCloseTo(w.height, 6); // the plan reports its own rise
      expect(w.top, `wall at (${w.x}, ${w.z}) tops out under the eye line`).toBeGreaterThan(
        ground + SIGHT_HEIGHT,
      );
    }
  });

  it('camera-solid colliders are only the pieces a body genuinely cannot see over', () => {
    // The chase camera pulls in on real walls and glides over everything else.
    // Getting this wrong is not cosmetic: when the flag podium's own stone base
    // counted as camera-solid, the boom collapsed to first person in the flag
    // court, the most contested ground in the mode.
    const solid = battlegroundColliders().filter((c) => !c.camGhost);
    expect(solid.length).toBeGreaterThan(100);
    for (const c of solid) {
      const ground = bgFieldHeightLocal(c.x, c.z);
      expect(
        (c.cameraTopY ?? 0) - ground,
        `camera-solid collider at (${c.x}, ${c.z}) is too short to occlude`,
      ).toBeGreaterThanOrEqual(3.5);
    }
    // Nothing inside the flag stands' own footprint occludes: standing at a
    // stand must never jam the camera.
    for (const base of BG_BASES) {
      const near = solid.filter((c) => Math.hypot(c.x - base.flag.x, c.z - base.flag.z) < 8);
      expect(near, `camera-solid geometry sits on team ${base.team}'s stand`).toHaveLength(0);
    }
  });

  it('the standable decks exist in useful numbers and carry a movement top', () => {
    const decks = battlegroundColliders().filter((c) => c.standable);
    expect(decks.length).toBeGreaterThan(500);
    for (const d of decks) {
      expect(d.moveTopY, `standable at (${d.x}, ${d.z}) has no moveTopY`).toBeTypeOf('number');
    }
    // Every collider carrying a movement top is standable and vice versa: a
    // moveTopY without `standable` is a prop a body passes over but cannot
    // land on, which is not a thing this field authors.
    expect(battlegroundColliders().filter((c) => c.moveTopY !== undefined)).toHaveLength(
      decks.length,
    );
    // The keep ramparts are among them, at the authored deck height.
    const rampart = decks.find((c) => c.x === -26 && c.z === -137.5);
    expect(rampart?.moveTopY).toBeCloseTo(16.7, 3);
    expect(rampart?.standable).toBe(true);
  });

  it('every collider is a box, seated inside the field rect', () => {
    const cs = battlegroundColliders();
    expect(cs.length).toBeGreaterThan(2000);
    for (const c of cs) {
      expect(c.type, `collider at (${c.x}, ${c.z})`).toBe('obb');
      expect(Math.abs(c.x)).toBeLessThanOrEqual(BG_HALF_X + 4);
      expect(Math.abs(c.z)).toBeLessThanOrEqual(BG_HALF_Z + 4);
    }
    // Mutating the returned set never touches the generated record.
    const first = cs[0];
    const before = first.x;
    first.x += 100;
    expect(battlegroundColliders()[0].x).toBe(before);
  });

  it('the art the map placed is seated inside the rect too', () => {
    expect(TH_PLACEMENTS.length).toBeGreaterThan(1000);
    for (const p of TH_PLACEMENTS) {
      expect(Math.abs(p.x), `placement ${p.assetId}`).toBeLessThanOrEqual(BG_HALF_X + 8);
      expect(Math.abs(p.z), `placement ${p.assetId}`).toBeLessThanOrEqual(BG_HALF_Z + 8);
      expect(Number.isFinite(p.seatY), `placement ${p.assetId} seat`).toBe(true);
      expect(p.scale).toBeGreaterThan(0);
    }
  });
});

describe('Ravenrift slots: isolated from each other, whole inside one match', () => {
  it('a same-slot match fits inside the raised interest radius', () => {
    // Whole-match interest is the design: every fighter is in every other
    // fighter's mirror. The two longest same-slot spans have to fit.
    const o = battlegroundOrigin(0);
    const crimson = { x: o.x + BG_BASES[0].flag.x, z: o.z + BG_BASES[0].flag.z };
    const azure = { x: o.x + BG_BASES[1].flag.x, z: o.z + BG_BASES[1].flag.z };
    expect(Math.hypot(crimson.x - azure.x, crimson.z - azure.z)).toBeLessThan(
      BG_MATCH_INTEREST_RADIUS,
    );
    const playDiagonal = Math.hypot(2 * BG_PLAY_HALF_X, 2 * BG_PLAY_HALF_Z);
    expect(playDiagonal).toBeLessThan(BG_MATCH_INTEREST_RADIUS);
    expect(BG_MATCH_DROP_RADIUS).toBeGreaterThan(BG_MATCH_INTEREST_RADIUS);
  });

  it('cross-slot pairs stay beyond the drop radius, corner to corner', () => {
    // Slot spacing must clear the WIDENED radius even for the two nearest
    // corners of adjacent slots, or one match would leak into the next.
    for (let slot = 1; slot < BG_SLOT_COUNT; slot++) {
      const a = battlegroundOrigin(slot - 1);
      const b = battlegroundOrigin(slot);
      const nearestGap = Math.abs(b.z - a.z) - 2 * BG_PLAY_HALF_Z;
      expect(nearestGap, `slots ${slot - 1}/${slot} play-rect gap`).toBeGreaterThan(
        BG_MATCH_DROP_RADIUS,
      );
      // and the same for the full dressed rect the renderer draws
      expect(Math.abs(b.z - a.z) - 2 * BG_HALF_Z).toBeGreaterThan(0);
    }
    // A fighter at each slot's Azure flag and the next slot's Crimson flag:
    // the closest cross-slot pair the mode can actually produce.
    for (let slot = 1; slot < BG_SLOT_COUNT; slot++) {
      const a = battlegroundOrigin(slot - 1);
      const b = battlegroundOrigin(slot);
      const d = Math.abs(b.z + BG_BASES[0].flag.z - (a.z + BG_BASES[1].flag.z));
      expect(d, `cross-slot flag pair ${slot - 1}/${slot}`).toBeGreaterThan(BG_MATCH_DROP_RADIUS);
    }
  });
});
