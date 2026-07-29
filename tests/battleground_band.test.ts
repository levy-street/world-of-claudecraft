// Thornhollow Fields at THORNHOLLOW: the sim-side pins for the authored field.
//
// The field is no longer code-defined geometry: the combat plan is built into
// data/battleground/thornhollow.map.json and compiled into
// src/sim/thornhollow_field.generated.ts, so these tests pin the five things
// that can actually regress:
//   1. terrain fidelity   - the compile-time chain, the runtime chain and the
//                           baked 1yd grid all agree, and groundHeight's band
//                           arm reads that same grid;
//   2. generated freshness - rebuilding the map and recompiling it reproduces
//                           both committed artifacts, byte for byte;
//   3. anchors            - the game-mode record the mode reasons about;
//   4. walkability        - a flood fill through the REAL collider grid reaches
//                           every anchor and both flags;
//   5. THE LAYOUT ITSELF  - the combat-tuned shape the field is dressed over:
//                           two crossings per curtain and no more, a keep whose
//                           mouth is the only way in, a heart ruin that seals
//                           the gate-to-gate lane, and rubble a runner rounds
//                           but a caster sees over.
// Plus collision honesty (walls block, the mouth is open, what blocks a cast is
// taller than the eye line) and the band's slot isolation.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BG_MATCH_DROP_RADIUS, BG_MATCH_INTEREST_RADIUS } from '../server/game';
import { BG_DRESSING_HALF_X, BG_DRESSING_HALF_Z } from '../src/render/battleground_core';
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
  isBlocked,
  lineOfSightClear,
  resolvePosition,
  SIGHT_HEIGHT,
  supportHeightAt,
} from '../src/sim/colliders';
import {
  ARENA_X,
  BG_BAND_X_MAX,
  BG_BAND_X_MIN,
  BG_SLOT_COUNT,
  BG_X,
  battlegroundOrigin,
  bgOriginAt,
  DELVE_BAND_X_MIN,
  DUNGEON_OVERFLOW_X_BASE,
  INSTANCE_X_BASE,
  isArenaPos,
  isBgPos,
  isDelvePos,
  isRiftPos,
  isYumiMazePos,
  YUMI_BAND_X_MAX,
} from '../src/sim/data';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { Sim } from '../src/sim/sim';
import { BG_PICKUP_RADIUS } from '../src/sim/social/battleground';
import { bgGraveyardSpot } from '../src/sim/spirit';
import {
  TH_COLLIDERS,
  TH_HEIGHT_PROBES,
  TH_LOCATIONS,
  TH_PLACEMENTS,
} from '../src/sim/thornhollow_field.generated';
import { groundHeight, terrainHeight } from '../src/sim/world';

const SEED = 42;
const ORIGIN = battlegroundOrigin(0);
/** The vendored per-asset collision table the compiler bakes bodies from. */
const ASSETS_PATH = 'data/battleground/thornhollow_assets.json';

const locationRect = (name: string) => {
  const rect = TH_LOCATIONS.find((l) => l.name === name);
  if (!rect) throw new Error(`no authored location named ${name}`);
  return rect;
};
const locationCentre = (name: string) => {
  const r = locationRect(name);
  return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
};

describe('Thornhollow Fields band: non-overlap with every other instance band', () => {
  it('sits on the instance plane, past every other band and the overflow zone', () => {
    // The band is an OFFSET FROM INSTANCE_X_BASE, never a raw world x: the
    // instance plane moved east wholesale, so a raw offset would put live
    // matches in the overworld.
    expect(BG_BAND_X_MIN).toBeGreaterThan(INSTANCE_X_BASE);
    expect(BG_BAND_X_MIN).toBeGreaterThanOrEqual(YUMI_BAND_X_MAX);
    expect(isBgPos(YUMI_BAND_X_MAX)).toBe(false);
    // Overflow dungeons grow east from DUNGEON_OVERFLOW_X_BASE at 600/dungeon.
    // The band starts far enough past it that adding dungeons cannot reach it.
    expect(BG_BAND_X_MIN - DUNGEON_OVERFLOW_X_BASE).toBeGreaterThan(600 * 20);
    // Two-sided cap: the band never claims everything east of itself.
    expect(BG_BAND_X_MAX).toBeGreaterThan(BG_BAND_X_MIN);
    expect(isBgPos(BG_BAND_X_MAX + 1)).toBe(false);
    // No overworld x is ever a battleground x.
    expect(isBgPos(0)).toBe(false);
    expect(isBgPos(16400)).toBe(false);
  });

  it('classifies exclusively: no x is ever in two bands', () => {
    // sweep the whole instanced range at 50yd steps
    for (let x = 500; x <= BG_BAND_X_MAX + 1000; x += 50) {
      const claims = [
        isArenaPos(x),
        isDelvePos(x),
        isYumiMazePos(x),
        isRiftPos(x),
        isBgPos(x),
      ].filter(Boolean).length;
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
    expect(isArenaPos(ARENA_X)).toBe(true);
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
        // slot spacing clears the full field length (2 x 140yd) with room over
        expect(Math.abs(o.z - prev.z)).toBeGreaterThan(BG_HALF_Z * 2);
      }
    }
  });
});

describe('Thornhollow terrain: one surface for the compiler, the sim and the grid', () => {
  it('the runtime stamp chain reproduces every build-time probe to 1e-3', () => {
    // TH_HEIGHT_PROBES are heights the COMPILER measured with its own copy of
    // the stamp chain. bgFieldExactHeight is the sim's copy. If the two ports
    // ever drift (a brush falloff, the level/add mode), every collider seat and
    // placement seat the compiler baked is wrong.
    // Vacuity floor, kept near the real count (42: the compiler's 40 scattered
    // samples plus one per flag) rather than far under it. A floor with room to
    // spare is what lets most of the scatter vanish while the sweep stays green.
    expect(TH_HEIGHT_PROBES.length).toBeGreaterThanOrEqual(40);
    let worst = 0;
    for (const p of TH_HEIGHT_PROBES) {
      const d = Math.abs(bgFieldExactHeight(p.x, p.z) - p.h);
      if (d > worst) worst = d;
      expect(d, `exact chain at (${p.x}, ${p.z})`).toBeLessThan(1e-3);
    }
    // Pin the observed order of magnitude too (pure float/rounding), so a real
    // drift cannot hide under the 1e-3 gate.
    expect(worst).toBeLessThan(5e-4);
  });

  it('the baked 1yd grid reproduces every build-time probe within 0.1yd', () => {
    // The shipped heightfield is a 1yd, 1cm-quantized bilinear grid, so it
    // rounds curvature between nodes.
    let worst = 0;
    for (const p of TH_HEIGHT_PROBES) {
      const d = Math.abs(bgFieldHeightLocal(p.x, p.z) - p.h);
      if (d > worst) worst = d;
      expect(d, `baked grid at (${p.x}, ${p.z})`).toBeLessThan(0.1);
    }
    expect(worst).toBeGreaterThan(0); // interpolation error is real, not a stub
  });

  it('at a grid NODE the baked value is the exact chain to within quantization', () => {
    // Between nodes the grid interpolates; ON a node it must be the chain
    // itself, give or take the 1cm store. This is what proves the bake is the
    // same surface rather than a plausible-looking second one.
    let worst = 0;
    for (let x = -49; x <= 49; x += 7) {
      for (let z = -140; z <= 140; z += 11) {
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
      ['Crimson flag terrace', 0, -BG_FLAG_Z, 2.13],
      ['Azure flag terrace', 0, BG_FLAG_Z, 2.13],
      ['Crimson keep centre', keep.x, keep.z, 2.06],
      ['Ruin Courtyard floor', 0, 0, -2.29],
      ['Crimson field chamber', 0, -80, -0.1],
      ['main gate threshold', 13, -56, 0.03],
    ];
    for (const [name, lx, lz, expected] of marks) {
      const world = groundHeight(ORIGIN.x + lx, ORIGIN.z + lz, SEED);
      expect(world, `${name} world height`).toBeCloseTo(bgFieldHeightLocal(lx, lz), 9);
      expect(world, `${name} authored height`).toBeCloseTo(expected, 1);
    }
    // The keeps stand on terraces over the sunken courtyard: that relief is the
    // field. It is deliberately shallow, because the LAYOUT under it was tuned
    // on flat ground, so this is a floor and not a target.
    expect(
      groundHeight(ORIGIN.x, ORIGIN.z - BG_FLAG_Z, SEED) - groundHeight(ORIGIN.x, ORIGIN.z, SEED),
    ).toBeGreaterThan(4);
    // Every slot reads the SAME field (the arm resolves the origin by z band).
    for (let slot = 0; slot < BG_SLOT_COUNT; slot++) {
      const o = battlegroundOrigin(slot);
      expect(groundHeight(o.x, o.z, SEED)).toBeCloseTo(bgFieldHeightLocal(0, 0), 9);
      expect(groundHeight(o.x - 40, o.z + 90, SEED)).toBeCloseTo(bgFieldHeightLocal(-40, 90), 9);
    }
  });

  it('the terrain is point-symmetric: neither team plays different ground', () => {
    // The layout is mirrored by construction; the GROUND has to be too, or one
    // team runs uphill into the courtyard and the other runs down.
    let worst = 0;
    for (let x = -49; x <= 49; x += 3) {
      for (let z = -139; z <= 139; z += 3) {
        worst = Math.max(worst, Math.abs(bgFieldExactHeight(x, z) - bgFieldExactHeight(-x, -z)));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('pins the authored 236-yard flag run', () => {
    expect(BG_FLAG_Z).toBe(118);
    expect(BG_FLAG_Z * 2).toBe(236);
  });

  it('the field outside the band is untouched: groundHeight only branches on x', () => {
    // A band arm that leaked into the open world would break every other zone.
    // "Not the field height" alone is weak (two unrelated surfaces disagree by
    // default), so pin the POSITIVE: at open-world coordinates groundHeight is
    // still exactly the un-branched terrain function, at scattered points well
    // clear of the walkable-lift features (stands, beacon, castle, docks) that
    // are the only other thing that arm adds.
    expect(isBgPos(BG_BAND_X_MIN - 1)).toBe(false);
    const openSamples: [number, number][] = [
      [0, 0],
      [137, -262],
      [-311, 184],
      [903, -655],
      [-1480, 1207],
      [2570, 341],
    ];
    for (const [x, z] of openSamples) {
      expect(isBgPos(x), `(${x}, ${z}) must be open world for this pin`).toBe(false);
      expect(groundHeight(x, z, SEED), `groundHeight at (${x}, ${z})`).toBe(
        terrainHeight(x, z, SEED),
      );
      // ...and the two surfaces really are different functions, so the equality
      // above is not comparing a stub against itself.
      expect(groundHeight(x, z, SEED)).not.toBeCloseTo(bgFieldHeightLocal(x, z), 3);
    }
  });
});

describe('Thornhollow generated artifacts: fresh against the plan', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));

  const rebuild = (script: string, out: string) =>
    execFileSync(process.execPath, [join(root, script), out], {
      cwd: root,
      stdio: 'pipe',
      timeout: 180000,
    });

  it('rebuilding the map document reproduces data/battleground/thornhollow.map.json', () => {
    // The map is BUILT from the combat plan (a couple of thousand placements
    // and half a million painted cells that have to stay point-symmetric), so
    // a plan edit that was never rebuilt is invisible until someone walks
    // through a wall that moved.
    const dir = mkdtempSync(join(tmpdir(), 'ravenrift-map-'));
    try {
      const out = join(dir, 'thornhollow.map.json');
      rebuild('scripts/assets/build_battleground_map.mjs', out);
      const fresh = readFileSync(out, 'utf8');
      const committed = readFileSync(join(root, 'data/battleground/thornhollow.map.json'), 'utf8');
      expect(fresh.length).toBeGreaterThan(100000); // the builder really ran
      expect(
        fresh === committed,
        'data/battleground/thornhollow.map.json is stale: re-run ' +
          '`node scripts/assets/build_battleground_map.mjs` and commit the result',
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240000);

  it('recompiling the map reproduces the committed field module', () => {
    // The generated module is the only thing the game reads. Recompile into a
    // temp path (the compiler takes an out-path argument for exactly this) and
    // diff; the working tree is never touched.
    const dir = mkdtempSync(join(tmpdir(), 'thornhollow-'));
    try {
      const out = join(dir, 'thornhollow_field.generated.ts');
      rebuild('scripts/assets/compile_thornhollow.mjs', out);
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
  }, 240000);
});

describe('Thornhollow Fields anchors: the game-mode record, authored symmetric', () => {
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
    // This is the "neither team is favoured" pin, and it is the one that
    // catches a plan edit that moved one side only.
    expect(mirrorDist(BG_BASES[0].flag, BG_BASES[1].flag)).toBeLessThan(1e-6);
    expect(mirrorDist(BG_GRAVEYARDS[0], BG_GRAVEYARDS[1])).toBeLessThan(1e-6);
    expect(BG_GRAVEYARDS[1].hw).toBe(BG_GRAVEYARDS[0].hw);
    expect(BG_GRAVEYARDS[1].hd).toBe(BG_GRAVEYARDS[0].hd);
    // Spawn rings mirror as SETS, exactly.
    for (const s of BG_BASES[0].spawns) {
      const twin = BG_BASES[1].spawns.find((t) => mirrorDist(s, t) < 1e-6);
      expect(twin, `spawn (${s.x}, ${s.z}) has no mirrored twin`).toBeTruthy();
    }
    expect(setMirrorError([...BG_BASES[0].spawns, ...BG_BASES[1].spawns])).toBeLessThan(1e-6);
    expect(mirrorDist(BG_BASES[0].banner, BG_BASES[1].banner)).toBeLessThan(1e-6);
  });

  it('four sprint pads and two power pads, point-mirrored as sets', () => {
    expect(BG_SPEED_RUNES).toHaveLength(4);
    expect(BG_POWER_RUNES).toHaveLength(2);
    expect(setMirrorError(BG_SPEED_RUNES)).toBeLessThan(1e-6);
    expect(setMirrorError(BG_POWER_RUNES)).toBeLessThan(1e-6);
    // Every pad inside the play rect, and none of them buried in a collider.
    for (const r of [...BG_SPEED_RUNES, ...BG_POWER_RUNES]) {
      expect(Math.abs(r.x), `rune (${r.x}, ${r.z}) x`).toBeLessThanOrEqual(BG_PLAY_HALF_X);
      expect(Math.abs(r.z), `rune (${r.x}, ${r.z}) z`).toBeLessThanOrEqual(BG_PLAY_HALF_Z);
      const p = resolvePosition(SEED, ORIGIN.x + r.x, ORIGIN.z + r.z, 0.5);
      expect(p.x, `rune (${r.x}, ${r.z}) is walkable`).toBeCloseTo(ORIGIN.x + r.x, 5);
      expect(p.z, `rune (${r.x}, ${r.z}) is walkable`).toBeCloseTo(ORIGIN.z + r.z, 5);
    }
    // One sprint pad on each team's flag approach, and the two flank pads on
    // the halfway line where neither side starts closer.
    expect(BG_SPEED_RUNES.filter((r) => r.z < 0)).toHaveLength(1);
    expect(BG_SPEED_RUNES.filter((r) => r.z > 0)).toHaveLength(1);
    expect(BG_SPEED_RUNES.filter((r) => r.z === 0)).toHaveLength(2);
    // One power pad in each half, at the courtyard mouth of a main gate.
    expect(BG_POWER_RUNES.filter((r) => r.z < 0)).toHaveLength(1);
    expect(BG_POWER_RUNES.filter((r) => r.z > 0)).toHaveLength(1);
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
      // A spot that lands inside a headstone footprint gets pushed clear, which
      // is survivable; what is not survivable is a spot the solver cannot
      // settle, or one shoved out of its own plot.
      const nudge = Math.hypot(r.x - spot.x, r.z - spot.z);
      expect(nudge, `spot for ${pid} nudge`).toBeLessThan(2);
      const settled = resolvePosition(SEED, r.x, r.z, 0.5);
      expect(settled.x, `spot for ${pid} settles`).toBeCloseTo(r.x, 6);
      expect(settled.z, `spot for ${pid} settles`).toBeCloseTo(r.z, 6);
      const team = pid >= 200 ? 1 : 0;
      const plot = BG_GRAVEYARDS[team];
      expect(Math.abs(r.x - (ORIGIN.x + plot.x))).toBeLessThanOrEqual(plot.hw);
      expect(Math.abs(r.z - (ORIGIN.z + plot.z))).toBeLessThanOrEqual(plot.hd);
    }
  });

  it('spawn rings and flag stands are seated on the keep terrace', () => {
    for (const base of BG_BASES) {
      for (const s of base.spawns) {
        const p = resolvePosition(SEED, ORIGIN.x + s.x, ORIGIN.z + s.z, 0.5);
        expect(p.x, `spawn (${s.x}, ${s.z})`).toBeCloseTo(ORIGIN.x + s.x, 5);
        expect(p.z, `spawn (${s.x}, ${s.z})`).toBeCloseTo(ORIGIN.z + s.z, 5);
        // On the terrace, not down its ramp, and never on the flag stand.
        expect(bgFieldHeightLocal(s.x, s.z), `spawn (${s.x}, ${s.z}) height`).toBeGreaterThan(1.5);
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

const FLOOD_CELL = 0.5; // fine enough to thread the 5yd gatehouse doors; the
// whole flood still runs in well under a second.
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

describe('Thornhollow Fields walkability: one connected field, both keeps included', () => {
  const flood = floodPlayRect();
  // "Standable" = the flood reached a cell inside one flood cell of the point.
  const reaches = (x: number, z: number) => flood.nearest(x, z) <= FLOOD_CELL + 1e-9;

  it('the flood covers most of the play rect from a single Crimson spawn', () => {
    // A field that fell into disconnected pockets (a wall closed a lane, a
    // gatehouse door sealed) collapses this number; a field that lost its
    // colliders entirely would push it near 100%.
    const share = flood.reached / (flood.cols * flood.rows);
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.95);
  });

  it('reaches BOTH spawn rings, so the two teams share one field', () => {
    for (const base of BG_BASES) {
      for (const s of base.spawns) {
        expect(reaches(s.x, s.z), `team ${base.team} spawn (${s.x}, ${s.z})`).toBe(true);
      }
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

  it('reaches the Ruin Courtyard and both field chambers', () => {
    // A walkable point in each named region, checked BOTH ways: the flood has
    // to reach it, and it has to actually lie inside the rectangle the map
    // labelled, so the location record and the ground cannot drift apart.
    // (A region's centre is not usable as the probe: the courtyard's is the
    // heart ruin, which is solid on purpose.)
    for (const [name, px, pz] of [
      ['The Ruin Courtyard', 0, -30],
      ['Crimson Field', 0, -82],
      ['Azure Field', 0, 82],
    ] as const) {
      const r = locationRect(name);
      expect(px >= r.minX && px <= r.maxX && pz >= r.minZ && pz <= r.maxZ, `${name} rect`).toBe(
        true,
      );
      expect(reaches(px, pz), name).toBe(true);
    }
    // The courtyard really is the sunken middle and the keeps really are up:
    // reaching a flat field would pass the check above but not this one.
    expect(bgFieldHeightLocal(0, 0)).toBeLessThan(-1.5);
    expect(bgFieldHeightLocal(0, -BG_FLAG_Z)).toBeGreaterThan(1.5);
    expect(bgFieldHeightLocal(0, BG_FLAG_Z)).toBeGreaterThan(1.5);
  });

  it('a stand within the flag pickup radius is reachable at BOTH flags', () => {
    // The stand is paved ground, not a plinth, so a runner walks right onto it;
    // if dressing ever fenced a flag in, this is what catches it.
    for (const base of BG_BASES) {
      const d = flood.nearest(base.flag.x, base.flag.z);
      expect(d, `team ${base.team} flag reach`).toBeLessThanOrEqual(BG_PICKUP_RADIUS);
    }
  });

  it('EVERY crossing the layout authors is open, in both directions', () => {
    // The layout's whole shape is "two crossings per curtain, and no more".
    // Reachability of two endpoints does NOT say the crossing between them is
    // open: the flood can arrive the long way round, and two points on the same
    // side of a wall stay connected whatever the door does. So each opening is
    // walked as a straight segment THROUGH it at 0.25yd steps, and the line the
    // segment has to straddle is spelled out and asserted, so a pair that
    // stopped crossing anything fails instead of passing quietly. A dressing
    // pass that leaned a crate into a doorway or thickened a gate jamb closes
    // one of these and quietly halves the map.
    const crossings: [string, number, number, number, number, number][] = [
      // name, from x/z, to x/z, the z line the crossing pierces
      // The keep mouth line is 10yd field-side of the flag; the run is offset
      // off centre because the mouth barricade deliberately breaks the straight
      // line from the field to the flag.
      ['Crimson keep mouth', 8, -113, 8, -103, -108],
      ['Azure keep mouth', -8, 113, -8, 103, 108],
      // The 10yd main gate through each curtain (curtain line |z| = 56).
      ['south main gate', 13, -62, 13, -50, -56],
      ['north main gate', -13, 62, -13, 50, 56],
      // The gatehouse doors are OFFSET across its room, so each is walked on
      // its own x line: the field-side wall sits at |z| = 65, the courtyard
      // side at |z| = 47, and the room straddles the curtain between them.
      ['south gatehouse field door', -22.5, -68, -22.5, -61, -65],
      ['south gatehouse court door', -30, -51, -30, -43, -47],
      ['north gatehouse field door', 22.5, 68, 22.5, 61, 65],
      ['north gatehouse court door', 30, 51, 30, 43, 47],
    ];
    for (const [name, ax, az, bx, bz, lineZ] of crossings) {
      expect(
        (az - lineZ) * (bz - lineZ) < 0,
        `${name}: the probe segment must straddle z = ${lineZ}`,
      ).toBe(true);
      expect(reaches(ax, az), `${name}: approach`).toBe(true);
      expect(reaches(bx, bz), `${name}: far side`).toBe(true);
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        expect(
          isBlocked(SEED, ORIGIN.x + x, ORIGIN.z + z, BODY_RADIUS),
          `${name}: closed at (${x.toFixed(2)}, ${z.toFixed(2)})`,
        ).toBe(false);
      }
    }
  });

  it('the flood is bounded by real geometry, not by the rect edge', () => {
    // Sanity that the walk is honest: cells inside a wall footprint are NOT
    // reached even though they sit well inside the play rect.
    for (const [name, lx, lz] of [
      ['heart ruin', 0, 0],
      ['Crimson keep back wall', 0, -128],
      ['Azure keep back wall', 0, 128],
      ['south curtain', 0, -56],
      ['north curtain', 0, 56],
      ['west rampart', -50, 0],
    ] as const) {
      expect(flood.visitedAt(lx, lz), `${name} footprint (${lx}, ${lz})`).toBe(false);
      expect(isBlocked(SEED, ORIGIN.x + lx, ORIGIN.z + lz, BODY_RADIUS), name).toBe(true);
    }
    // and the flood really did stop somewhere: a fully open rect would be 100%
    expect(flood.reached).toBeLessThan(flood.cols * flood.rows);
  });
});

describe('Thornhollow Fields layout: the combat shape the dressing is laid over', () => {
  const local = (x: number, z: number) => ({ x: ORIGIN.x + x, z: ORIGIN.z + z });
  const sight = (a: [number, number], b: [number, number]) => {
    const from = local(a[0], a[1]);
    const to = local(b[0], b[1]);
    return lineOfSightClear(
      SEED,
      { ...from, y: groundHeight(from.x, from.z, SEED) },
      { ...to, y: groundHeight(to.x, to.z, SEED) },
    );
  };

  it('the caller-supplied eye height is scoped to the band, never the open world', () => {
    // The band takes a fighter's REAL feet height for sight (its field is the
    // one instanced region with sculpted terrain and standable decks, and its
    // cover was authored against that). The open world must keep its historical
    // terrain-derived eye, because both live callers pass an Entity.pos that
    // always carries a y: applying it everywhere would silently retune spell
    // line of sight for every player in the game. This pins the scoping itself,
    // which is the only thing standing between the two behaviors.
    // The probe line has to be one that is BLOCKED from the ground and would
    // CLEAR if the caller's y were honoured, or "the answer did not move" is
    // vacuous: over open ground both arms read true whatever eyeAt does, and
    // deleting the isBgPos guard would leave this green. At seed 42 this span
    // runs into a world prop whose top sits just above the ground eye line and
    // well under a lifted one, so the two arms are only equal because the open
    // world ignores y.
    const OPEN_A = { x: -186, z: 168 };
    const OPEN_B = { x: -166, z: 168 };
    expect(isBgPos(OPEN_A.x), 'the open-world probe must not be in the band').toBe(false);
    const openGround = lineOfSightClear(
      SEED,
      { ...OPEN_A, y: groundHeight(OPEN_A.x, OPEN_A.z, SEED) },
      { ...OPEN_B, y: groundHeight(OPEN_B.x, OPEN_B.z, SEED) },
    );
    expect(openGround, 'the open-world probe line must be blocked at ground eye height').toBe(
      false,
    );
    // Lift BOTH endpoints a body's height off the ground: in the open world the
    // answer must not move, because y is ignored there. Still blocked.
    const openLifted = lineOfSightClear(
      SEED,
      { ...OPEN_A, y: groundHeight(OPEN_A.x, OPEN_A.z, SEED) + 3 },
      { ...OPEN_B, y: groundHeight(OPEN_B.x, OPEN_B.z, SEED) + 3 },
    );
    expect(openLifted, 'open-world sight moved with the caller y').toBe(openGround);
    // ...and omitting y entirely is the same answer again, which is what makes
    // the probe callers and the entity callers agree out there.
    expect(lineOfSightClear(SEED, OPEN_A, OPEN_B)).toBe(openGround);
    // Inside the band the y IS honoured: standing on the mouth barricade's own
    // top clears the sight line the same span refuses from the ground.
    const a = local(-3, -108);
    const b = local(-3, -104);
    const groundLine = lineOfSightClear(
      SEED,
      { ...a, y: groundHeight(a.x, a.z, SEED) },
      { ...b, y: groundHeight(b.x, b.z, SEED) },
    );
    const overTheTop = lineOfSightClear(
      SEED,
      { ...a, y: groundHeight(a.x, a.z, SEED) + 4 },
      { ...b, y: groundHeight(b.x, b.z, SEED) + 4 },
    );
    expect(groundLine, 'the barricade should block at ground eye height').toBe(false);
    expect(overTheTop, 'the band must honour the caller eye height').toBe(true);
  });

  it('the heart ruin seals the main-gate-to-main-gate lane', () => {
    // The single most load-bearing sight property of the layout: the two main
    // gates are point mirrors, so the straight line between them runs through
    // the middle of the field. The 16yd heart ruin is what stops a caster in
    // one gate holding the other. A ruin dressed as a walk-through shell (or
    // one whose sealed core went missing) opens it.
    expect(sight([13, -56], [-13, 56])).toBe(false);
    // and so is the flag-to-flag line, which crosses it too.
    expect(sight([0, -BG_FLAG_Z], [0, BG_FLAG_Z])).toBe(false);
  });

  it('a curtain blocks sight across it, and its own gate does not', () => {
    // Sealed run: two points 8yd apart either side of the south curtain.
    expect(sight([30, -60], [30, -52])).toBe(false);
    expect(sight([-40, -60], [-40, -52])).toBe(false);
    // The main gate is a real opening: the same span, through the arch.
    expect(sight([13, -62], [13, -50])).toBe(true);
  });

  it('the mouth barricade is sight cover and the rubble deliberately is not', () => {
    // The barricade tops out ABOVE the eye line: a defender behind it breaks
    // line of sight into the keep mouth, which is the whole point of it.
    expect(sight([0, -110], [0, -102])).toBe(false);
    // The rubble formations top out BELOW it: they are movement cover a runner
    // rounds or vaults, never sight cover, exactly as on the code-defined field
    // where they were low circles with a 1.4yd sight top. Dressing them as
    // proper boulders is what would break this.
    expect(sight([43, -18], [43, -30])).toBe(true);
    expect(sight([-43, 18], [-43, 30])).toBe(true);
  });

  it('the keep mouth is the only way into a keep court', () => {
    // Walk the keep enclosure: the back wall and both side walls block, the
    // mouth line is clear all the way across.
    for (const z of [-128, 128]) {
      for (const x of [-14, -8, 0, 8, 14]) {
        expect(isBlocked(SEED, ORIGIN.x + x, ORIGIN.z + z, 0.5), `back wall (${x}, ${z})`).toBe(
          true,
        );
      }
    }
    for (const x of [-16, 16]) {
      for (const z of [-126, -118, -110, 110, 118, 126]) {
        expect(isBlocked(SEED, ORIGIN.x + x, ORIGIN.z + z, 0.5), `side wall (${x}, ${z})`).toBe(
          true,
        );
      }
    }
    for (const x of [-10, -5, 0, 5, 10]) {
      for (const z of [-108, 108]) {
        expect(isBlocked(SEED, ORIGIN.x + x, ORIGIN.z + z, 0.5), `mouth (${x}, ${z})`).toBe(false);
      }
    }
  });

  it('each curtain is pierced by exactly its two authored crossings', () => {
    // Sample the whole curtain line. Everything outside the main gate and the
    // gatehouse room must block; a third hole is a lane the mode was never
    // balanced around.
    const SEALED_SOUTH = [-46, -40, -36, -14, -8, 0, 4, 20, 26, 32, 40, 46];
    const OPEN_SOUTH = [10, 13, 16, -30, -26, -22];
    for (const x of SEALED_SOUTH) {
      expect(isBlocked(SEED, ORIGIN.x + x, ORIGIN.z - 56, 0.5), `south curtain x=${x}`).toBe(true);
      expect(isBlocked(SEED, ORIGIN.x - x, ORIGIN.z + 56, 0.5), `north curtain x=${-x}`).toBe(true);
    }
    for (const x of OPEN_SOUTH) {
      expect(isBlocked(SEED, ORIGIN.x + x, ORIGIN.z - 56, 0.5), `south crossing x=${x}`).toBe(
        false,
      );
      expect(isBlocked(SEED, ORIGIN.x - x, ORIGIN.z + 56, 0.5), `north crossing x=${-x}`).toBe(
        false,
      );
    }
  });

  it('the perimeter rampart holds a mover inside the field', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, noPlayer: true });
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const start = {
        x: ORIGIN.x + dx * 40,
        y: groundHeight(ORIGIN.x + dx * 40, ORIGIN.z + dz * 100, SEED),
        z: ORIGIN.z + dz * 100,
      };
      const mover = { templateId: 'forest_wolf', pos: start, facing: 0 };
      const dest = { x: ORIGIN.x + dx * 90, y: start.y, z: ORIGIN.z + dz * 200 };
      for (let tick = 0; tick < 60; tick++) {
        (
          sim as unknown as { moveToward(e: typeof mover, d: typeof dest, speed: number): boolean }
        ).moveToward(mover, dest, 7);
      }
      expect(Math.abs(mover.pos.x - ORIGIN.x), `rampart ${dx},${dz} x`).toBeLessThan(BG_HALF_X);
      expect(Math.abs(mover.pos.z - ORIGIN.z), `rampart ${dx},${dz} z`).toBeLessThan(BG_HALF_Z);
    }
  });
});

describe('Thornhollow collision honesty: what blocks, blocks; what opens, opens', () => {
  it('every structural wall stands above the eye line where it stands', () => {
    // bgFieldPlanWalls is the projection the minimap draws: the blocking boxes
    // that stand taller than a step and wider than a post. A wall whose camera
    // top sat under SIGHT_HEIGHT would block a cast the player can see straight
    // over (issue #1668's shape). Standable decks are exempt: a tread is meant
    // to be low.
    const walls = bgFieldPlanWalls();
    expect(walls.length).toBeGreaterThan(250);
    for (const w of walls) {
      const ground = bgFieldHeightLocal(w.x, w.z);
      expect(w.top - ground).toBeCloseTo(w.height, 6); // the plan reports its own rise
      expect(w.top, `wall at (${w.x}, ${w.z}) tops out under the eye line`).toBeGreaterThan(
        ground + SIGHT_HEIGHT,
      );
      // and it is a wall, not a speck: a drum's crenellation posts are eight
      // yards up on a deck nobody reaches, and drawing them would speckle the
      // map with marks a runner never meets.
      expect(Math.max(w.hw, w.hd), `plan mark at (${w.x}, ${w.z}) is post-sized`).toBeGreaterThan(
        0.5,
      );
    }
  });

  it('every collider that blocks sight is tall enough to deserve it', () => {
    // This used to pin the chase camera's own occlusion set. The release removed
    // geometry-driven camera zoom (occluders fade instead), so `camGhost` and
    // the classification behind it are gone; what survives is the claim that
    // still matters, which is about SIGHT: a piece tall enough to stop a cast
    // has to be tall enough that a player cannot see over it either.
    const blockers = battlegroundColliders().filter(
      (c) => (c.cameraTopY ?? 0) - bgFieldHeightLocal(c.x, c.z) >= SIGHT_HEIGHT,
    );
    expect(blockers.length).toBeGreaterThan(100);
    // Nothing inside the flag stands' own footprint blocks sight: a fight on the
    // stand is the most contested ground in the mode and must stay readable.
    for (const base of BG_BASES) {
      const near = blockers.filter((c) => Math.hypot(c.x - base.flag.x, c.z - base.flag.z) < 8);
      expect(near, `sight-blocking geometry sits on team ${base.team}'s stand`).toHaveLength(0);
    }
  });

  it('the standable tops exist in useful numbers and carry a movement top', () => {
    const decks = battlegroundColliders().filter((c) => c.standable);
    expect(decks.length).toBeGreaterThan(300);
    for (const d of decks) {
      expect(d.moveTopY, `standable at (${d.x}, ${d.z}) has no moveTopY`).toBeTypeOf('number');
    }
    // Every collider carrying a movement top is standable and vice versa: a
    // moveTopY without `standable` is a prop a body passes over but cannot land
    // on, which is not a thing this field authors.
    expect(battlegroundColliders().filter((c) => c.moveTopY !== undefined)).toHaveLength(
      decks.length,
    );
  });

  it('authors no walkable stairs, and nothing that reads like one', () => {
    // From playtesting. A stair GLB's baked collision is a ramp deck the
    // movement kernel only honours from the tread a body already stands on, so
    // a staircase invites a climb and then refuses it. Every stair came off the
    // field rather than being half-fixed, and these two pins are what stop one
    // creeping back: no collider claims a sloped top...
    expect(battlegroundColliders().filter((c) => c.topSlope !== undefined)).toHaveLength(0);
    // ...and no stair MODEL is placed either, which is the cause rather than
    // the symptom (a stair with its collision stripped still invites the climb).
    expect(TH_PLACEMENTS.filter((p) => /stair/i.test(p.assetId)).map((p) => p.assetId)).toEqual([]);
  });

  it('leaves the pocket behind each keep as open ground, not a false platform', () => {
    // Also from playtesting: a raised stone plinth stood back there and read as
    // a platform without being walkable. The pocket runs from the keep's back
    // wall (|z| 128) to the rampart (140), inside the keep's own width.
    for (const sign of [-1, 1]) {
      const pocket = battlegroundColliders().filter(
        (c) =>
          Math.sign(c.z) === sign &&
          Math.abs(c.z) > 129 &&
          Math.abs(c.z) < 139.5 &&
          Math.abs(c.x) < 16,
      );
      expect(
        pocket.filter((c) => c.standable),
        `something standable stands in the pocket behind keep ${sign}`,
      ).toHaveLength(0);
    }
  });

  it('the flag stand is ground, not a fortress: dais steps stride, nothing blocks the flag', () => {
    // The stand's whole contract, pinned so a later scale or position tweak
    // cannot silently break it: the dais under the flag is a stepped SURFACE a
    // body walks straight onto (every standable top in the court rises under
    // the physics step height), and no blocking collider stands inside the
    // pickup radius, so contesting the flag is never a fight with furniture.
    // The court's ceremony hangs on its walls (see the dressing pass): nothing
    // stands free around the stand.
    const distToObb = (
      c: { x: number; z: number; hw: number; hd: number; rot: number },
      px: number,
      pz: number,
    ) => {
      const dx = px - c.x;
      const dz = pz - c.z;
      const lx = dx * Math.cos(c.rot) - dz * Math.sin(c.rot);
      const lz = dx * Math.sin(c.rot) + dz * Math.cos(c.rot);
      return Math.hypot(Math.max(Math.abs(lx) - c.hw, 0), Math.max(Math.abs(lz) - c.hd, 0));
    };
    for (const base of BG_BASES) {
      // The sibling test pins every band collider as an obb; the narrow here
      // is for the type system, not a real filter.
      const court = battlegroundColliders().filter(
        (c): c is Extract<ReturnType<typeof battlegroundColliders>[number], { type: 'obb' }> =>
          c.type === 'obb' && Math.hypot(c.x - base.flag.x, c.z - base.flag.z) < 9,
      );
      // A dais is authored under the flag: standable steps exist...
      expect(
        court.filter((c) => c.standable && distToObb(c, base.flag.x, base.flag.z) === 0).length,
        `team ${base.team} flag has no dais under it`,
      ).toBeGreaterThanOrEqual(2);
      // ...and every one of them is a stride, not a ledge.
      for (const c of court) {
        if (!c.standable || c.moveTopY === undefined) continue;
        expect(
          c.moveTopY - bgFieldHeightLocal(c.x, c.z),
          `standable top at (${c.x}, ${c.z}) gates a stride`,
        ).toBeLessThanOrEqual(MAX_STEP_HEIGHT);
      }
      // Nothing that BLOCKS reaches the pickup radius (with a body radius of
      // clearance past it), so the scrum on the stand never snags on a prop.
      for (const c of court) {
        if (c.standable) continue;
        expect(
          distToObb(c, base.flag.x, base.flag.z),
          `blocking collider at (${c.x}, ${c.z}) crowds team ${base.team}'s flag`,
        ).toBeGreaterThan(BG_PICKUP_RADIUS + 0.5);
      }
    }
  });

  it('every collider is a box, seated inside the field rect', () => {
    const cs = battlegroundColliders();
    expect(cs.length).toBeGreaterThan(1000);
    for (const c of cs) {
      expect(c.type, `collider at (${c.x}, ${c.z})`).toBe('obb');
      // Nothing that BLOCKS leaves the field: only a mural drum's own radius
      // reaches past the rampart line it projects from.
      expect(Math.abs(c.x)).toBeLessThanOrEqual(BG_HALF_X + 4);
      expect(Math.abs(c.z)).toBeLessThanOrEqual(BG_HALF_Z + 4);
    }
    // Mutating the returned set never touches the generated record.
    const first = cs[0];
    const before = first.x;
    first.x += 100;
    expect(battlegroundColliders()[0].x).toBe(before);
  });

  it('a spirit walks out of its graveyard: the plot is a yard, not a maze', () => {
    // From playtesting. A released spirit rises on a FIXED five-spot grid
    // (spirit.ts bgGraveyardSpot) and leaves by the one gap the plan opens in
    // the rails. The yard used to carry twelve headstones, every one of them
    // taller than the eye line, so a spirit could not even see the way out.
    // Both halves of the fix are pinned: how much stands in there, and that the
    // walk out is actually clear from every spot a spirit can rise on.
    for (const [i, plot] of BG_GRAVEYARDS.entries()) {
      const inside = battlegroundColliders().filter(
        (c) => Math.abs(c.x - plot.x) <= plot.hw && Math.abs(c.z - plot.z) <= plot.hd,
      );
      // The four rail volumes bound the plot and are the plan's, not clutter;
      // everything else standing in there is a headstone or a lantern.
      expect(inside.length, `graveyard ${i} clutter`).toBeLessThanOrEqual(10);
      const m = i === 0 ? 1 : -1;
      const gapX = plot.x - 6 * m;
      const gapZ = plot.z + 6 * m;
      const mouth = { x: gapX, z: plot.z + (plot.hd - 1.5) * m };
      for (let idx = 0; idx < 5; idx++) {
        const spot = {
          x: plot.x + ((idx % 2) * 6 - 3) * m,
          z: plot.z + (Math.floor(idx / 2) - 1) * 3 * m,
        };
        // A spirit must RISE somewhere it can stand, unshoved.
        const settled = resolvePosition(SEED, ORIGIN.x + spot.x, ORIGIN.z + spot.z, BODY_RADIUS);
        expect(
          Math.hypot(settled.x - (ORIGIN.x + spot.x), settled.z - (ORIGIN.z + spot.z)),
          `graveyard ${i} rise spot ${idx} is inside something`,
        ).toBeLessThan(0.05);
        // ...and then walk the two legs a player actually walks: across to the
        // gap mouth, then straight out through it.
        for (const [a, b] of [
          [spot, mouth],
          [mouth, { x: gapX, z: gapZ + 2 * m }],
        ]) {
          for (let k = 0; k <= 40; k++) {
            const t = k / 40;
            const x = a.x + (b.x - a.x) * t;
            const z = a.z + (b.z - a.z) * t;
            expect(
              isBlocked(SEED, ORIGIN.x + x, ORIGIN.z + z, BODY_RADIUS),
              `graveyard ${i} spot ${idx}: blocked walking out at (${x.toFixed(1)}, ${z.toFixed(1)})`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('everything that renders solid also blocks: no walk-through props', () => {
    // The playtest finding this exists for: posts, lanterns, fallen columns,
    // braziers and fifteen-yard trees that rendered as objects and had no
    // collision at all. The map builder audits this at BUILD time; this is the
    // same claim checked against the COMPILED field, which is what the game
    // actually loads, so a compiler change cannot quietly drop the bodies.
    const assets = JSON.parse(
      readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), ASSETS_PATH), 'utf8'),
    ) as Record<
      string,
      { boxes?: { x: number; y: number; z: number; hx: number; hy: number; hz: number }[] }
    >;
    const NON_COLLIDING_BY_DESIGN = new Set(['dungeon/torch_mounted', 'dungeon/fence_broken']);
    let checked = 0;
    for (const p of TH_PLACEMENTS) {
      // Out-of-play slope dressing is unreachable by construction.
      if (Math.abs(p.x) > BG_HALF_X || Math.abs(p.z) > BG_HALF_Z) continue;
      if (NON_COLLIDING_BY_DESIGN.has(p.assetId)) continue;
      const boxes = assets[p.assetId]?.boxes;
      if (!boxes || boxes.length === 0) continue;
      let spanX = 0;
      let spanZ = 0;
      let top = 0;
      for (const b of boxes) {
        spanX = Math.max(spanX, Math.abs(b.x) + b.hx);
        spanZ = Math.max(spanZ, Math.abs(b.z) + b.hz);
        top = Math.max(top, b.y + b.hy);
      }
      const s = p.scale > 0 ? p.scale : 1;
      if (
        Math.min(spanX * s * (p.scaleX ?? 1), spanZ * s * (p.scaleZ ?? 1)) < 0.2 ||
        top * s * (p.scaleY ?? 1) < 0.5
      ) {
        continue;
      }
      checked++;
      const reach = Math.max(spanX, spanZ) * s * Math.max(p.scaleX ?? 1, p.scaleZ ?? 1) + 1.5;
      const hit = TH_COLLIDERS.some(
        (c) => Math.abs(c.x - p.x) <= reach && Math.abs(c.z - p.z) <= reach,
      );
      expect(hit, `${p.assetId} at (${p.x}, ${p.z}) renders solid but nothing blocks there`).toBe(
        true,
      );
    }
    // Vacuity floor, kept near the real count (712) rather than far under it:
    // a floor with room to spare is what lets a whole family drop out of the
    // sweep unnoticed.
    expect(checked).toBeGreaterThan(650);
  });

  it('the art the map placed stays inside the declared dressing bound', () => {
    // Art may reach past the ramparts: the hollow's wooded lip is authored out
    // there so a rampart top has forest behind it rather than the edge of the
    // world. It may not reach past the bound the render layer declares, and
    // (see above) nothing that blocks may leave the field rect at all.
    expect(TH_PLACEMENTS.length).toBeGreaterThan(1000);
    for (const p of TH_PLACEMENTS) {
      expect(Math.abs(p.x), `placement ${p.assetId}`).toBeLessThanOrEqual(BG_DRESSING_HALF_X);
      expect(Math.abs(p.z), `placement ${p.assetId}`).toBeLessThanOrEqual(BG_DRESSING_HALF_Z);
      expect(Number.isFinite(p.seatY), `placement ${p.assetId} seat`).toBe(true);
      expect(p.scale).toBeGreaterThan(0);
    }
  });
});

describe('Thornhollow Fields slots: isolated from each other, whole inside one match', () => {
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
