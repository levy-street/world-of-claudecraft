import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { meadowBushPlacements } from '../src/render/meadow_bush_core';
import {
  applyMeadowPatchTint,
  createMeadowPatchSample,
  MEADOW_CLUMP_PEAK_MAX,
  MEADOW_CLUMP_PEAK_MIN,
  MEADOW_CLUMP_RIM_HEIGHT,
  MEADOW_COBBLE_FULL,
  MEADOW_LITTER_FULL,
  MEADOW_LITTER_SHORTEN,
  MEADOW_LITTER_START,
  MEADOW_LITTER_THIN,
  MEADOW_PATCH_MAX_STRETCH,
  MEADOW_PATCH_SOFTNESS,
  MEADOW_PATCH_THRESHOLD,
  MEADOW_ROAD_CLEAR,
  MEADOW_ROAD_TOE,
  MEADOW_ROAD_WANDER,
  type MeadowPatchContext,
  meadowClumpCover,
  meadowClumpHeight,
  meadowClumpPeak,
  meadowPatchAccent,
  meadowPatchContext,
  meadowPatchField,
  meadowPatchGrows,
  meadowTownWeight,
  paintedDirtWeight,
  sampleMeadowPatch,
} from '../src/render/meadow_patch_core';
import { meadowScopeDecorations, meadowScopeWeight } from '../src/render/meadow_scope_core';
import {
  clearPaintedGroundMacro,
  paintedGroundMacro,
  samplePaintedGroundMacro,
} from '../src/render/painted_ground_macro_core';
import {
  coverMasksAt,
  macroStatsOf,
  resolveCobbleLanes,
  resolveCobbleTowns,
  townCobbleAt,
} from '../src/render/terrain_painted_ground_core';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import type { WorldContent } from '../src/sim/types';
import { roadDistance, terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// every suite starts on a ground with no painted macro recorded (the Low tier's
// case); the painted-ground suite below records one through the real hand-off
beforeEach(() => clearPaintedGroundMacro());
afterEach(() => {
  setActiveWorldContent(null);
  clearPaintedGroundMacro();
});

const ctx = (): MeadowPatchContext => meadowPatchContext(WORLD_SEED, BUILTIN_WORLD);

/** Open vale ground: inside the scope, off every road, out of town and clear of
 *  every rock, trunk, bush and built edge, so only the clump field speaks. */
function openGroundCells(step: number): { x: number; z: number; rd: number }[] {
  const c = ctx();
  const scope = c.scope;
  if (!scope) throw new Error('scope expected');
  const decorations = meadowScopeDecorations(scope);
  const bodies = [
    ...decorations.rocks.map((d) => ({ x: d.x, z: d.z, r: d.scale * 1.05 + 3 })),
    ...decorations.trees.map((d) => ({ x: d.x, z: d.z, r: d.scale * 0.55 + 3 })),
    ...meadowBushPlacements(WORLD_SEED, BUILTIN_WORLD).map((b) => ({ x: b.x, z: b.z, r: 4 })),
  ];
  const out: { x: number; z: number; rd: number }[] = [];
  for (let x = -140; x < 140; x += step) {
    for (let z = -140; z < 140; z += step) {
      // the border feather blends toward the stock carpet: fully inside only
      if (meadowScopeWeight(scope, x, z) < 1) continue;
      const rd = roadDistance(x, z);
      if (rd < 10) continue;
      if (meadowTownWeight(c, x, z) > 0) continue;
      if (terrainHeight(x, z, WORLD_SEED) < WATER_LEVEL + 0.5) continue;
      if (bodies.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r)) continue;
      out.push({ x, z, rd });
    }
  }
  return out;
}

describe('meadow patch core: the field', () => {
  it('is deterministic per seed and differs between seeds', () => {
    let differ = 0;
    let total = 0;
    for (let x = -100; x < 100; x += 3.7) {
      for (let z = -100; z < 100; z += 3.7) {
        const a = meadowPatchField(WORLD_SEED, x, z);
        expect(meadowPatchField(WORLD_SEED, x, z)).toBe(a);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        if (Math.abs(meadowPatchField(WORLD_SEED + 1, x, z) - a) > 0.02) differ++;
        total++;
      }
    }
    expect(differ / total).toBeGreaterThan(0.8);
    const s1 = sampleMeadowPatch(
      ctx(),
      12.3,
      40.7,
      roadDistance(12.3, 40.7),
      createMeadowPatchSample(),
    );
    const s2 = sampleMeadowPatch(
      ctx(),
      12.3,
      40.7,
      roadDistance(12.3, 40.7),
      createMeadowPatchSample(),
    );
    expect(s2).toEqual(s1);
  });

  it('keeps open vale ground roughly 15 to 35 percent grass, in soft-edged clumps', () => {
    const cells = openGroundCells(1.5);
    expect(cells.length).toBeGreaterThan(5000);
    const c = ctx();
    const sample = createMeadowPatchSample();
    let cover = 0;
    let bare = 0;
    let full = 0;
    let soft = 0;
    for (const cell of cells) {
      const s = sampleMeadowPatch(c, cell.x, cell.z, cell.rd, sample);
      // away from every edge the sample IS the clump field
      expect(s.cover).toBeCloseTo(
        meadowClumpCover(meadowPatchField(WORLD_SEED, cell.x, cell.z)),
        9,
      );
      cover += s.cover;
      if (s.cover === 0) bare++;
      else if (s.cover > 0.95) full++;
      else soft++;
    }
    const mean = cover / cells.length;
    expect(mean).toBeGreaterThan(0.15);
    expect(mean).toBeLessThan(0.35);
    // mostly bare painted ground, real clumps, and a soft rim between them
    expect(bare / cells.length).toBeGreaterThan(0.55);
    expect(full / cells.length).toBeGreaterThan(0.08);
    expect(soft / cells.length).toBeGreaterThan(0.04);
  });

  it('draws organic outlines: no grid, no edge favouring the world axes', () => {
    // boundary normals of the clump membership, folded into one quadrant: an
    // axis-aligned lattice shows as a pile-up near 0 and 90 degrees (raw
    // unrotated value noise puts 22 percent within 5 degrees of an axis)
    const bins = new Array(9).fill(0);
    let n = 0;
    let nearAxis = 0;
    const f = (x: number, z: number): number =>
      meadowClumpCover(meadowPatchField(WORLD_SEED, x, z));
    for (let x = -160; x < 160; x += 0.9) {
      for (let z = -160; z < 160; z += 0.9) {
        const v = f(x, z);
        if (v < 0.3 || v > 0.7) continue;
        const gx = f(x + 0.05, z) - f(x - 0.05, z);
        const gz = f(x, z + 0.05) - f(x, z - 0.05);
        if (Math.hypot(gx, gz) < 1e-6) continue;
        const a = ((((Math.atan2(gz, gx) * 180) / Math.PI) % 90) + 90) % 90;
        bins[Math.min(8, Math.floor(a / 10))]++;
        if (a < 5 || a > 85) nearAxis++;
        n++;
      }
    }
    expect(n).toBeGreaterThan(3000);
    for (const b of bins) {
      expect(b / n).toBeGreaterThan(0.08);
      expect(b / n).toBeLessThan(0.14);
    }
    expect(nearAxis / n).toBeLessThan(0.14);
  });

  it('stands clump hearts tall and rims short, within 0.5 to 1.4 of the shipped crop', () => {
    const rim = MEADOW_PATCH_THRESHOLD - MEADOW_PATCH_SOFTNESS;
    expect(meadowClumpHeight(rim, 1.3)).toBeCloseTo(MEADOW_CLUMP_RIM_HEIGHT, 9);
    expect(meadowClumpHeight(0.99, 1.3)).toBeCloseTo(1.3, 9);
    // deeper inside a clump is never shorter
    let prev = 0;
    for (let f = rim; f <= 1; f += 0.01) {
      const h = meadowClumpHeight(f, 1.25);
      expect(h).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = h;
    }
    // neighbouring clumps peak at different heights
    const peaks: number[] = [];
    for (let x = -150; x < 150; x += 4) {
      for (let z = -150; z < 150; z += 4) peaks.push(meadowClumpPeak(WORLD_SEED, x, z));
    }
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(MEADOW_CLUMP_PEAK_MIN);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(MEADOW_CLUMP_PEAK_MAX);
    const mean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const sd = Math.sqrt(peaks.reduce((a, b) => a + (b - mean) ** 2, 0) / peaks.length);
    expect(sd).toBeGreaterThan(0.08);
  });
});

describe('meadow patch core: paths, town and edges', () => {
  it('keeps roads and paths bare behind a feathered border', () => {
    const c = ctx();
    const sample = createMeadowPatchSample();
    // on every Eastbrook road and path, along its whole length (fully inside
    // the scope: on the border feather the stock carpet's own road gate rules)
    let onRoad = 0;
    for (const road of BUILTIN_WORLD.roads) {
      for (const p of road) {
        if (meadowScopeWeight(c.scope, p.x, p.z) < 1) continue;
        const rd = roadDistance(p.x, p.z);
        if (rd > MEADOW_ROAD_CLEAR - MEADOW_ROAD_WANDER) continue;
        expect(sampleMeadowPatch(c, p.x, p.z, rd, sample).cover).toBe(0);
        onRoad++;
      }
    }
    expect(onRoad).toBeGreaterThan(30);
    // anywhere inside the clear line, whatever the field says
    let inside = 0;
    for (let x = -170; x < 170; x += 1.1) {
      for (let z = -170; z < 170; z += 1.1) {
        const rd = roadDistance(x, z);
        if (rd >= MEADOW_ROAD_CLEAR - MEADOW_ROAD_WANDER) continue;
        if (meadowScopeWeight(c.scope, x, z) < 1) continue;
        expect(sampleMeadowPatch(c, x, z, rd, sample).cover).toBe(0);
        inside++;
      }
    }
    expect(inside).toBeGreaterThan(1000);
    // a transect off a road rises through the feather instead of stepping
    let feathered = 0;
    let transects = 0;
    for (let x = -10; x < 40; x += 5) {
      // the north road runs near x 0..-30 between z -30 and 140
      for (const z of [10, 40, 70, 100]) {
        const rd0 = roadDistance(x, z);
        if (!(rd0 > 6 && rd0 < 30)) continue;
        transects++;
        let prev = -1;
        let sawMid = false;
        let maxJump = 0;
        // walk toward the road from rd0 down to the centreline
        for (let t = 0; t <= 1; t += 0.004) {
          const px = x;
          const pz = z;
          // step along the road-distance gradient (toward the road)
          const e = 0.3;
          const gx = roadDistance(px + e, pz) - roadDistance(px - e, pz);
          const gz = roadDistance(px, pz + e) - roadDistance(px, pz - e);
          const len = Math.hypot(gx, gz) || 1;
          const qx = px - (gx / len) * rd0 * t;
          const qz = pz - (gz / len) * rd0 * t;
          const rd = roadDistance(qx, qz);
          const cover = sampleMeadowPatch(c, qx, qz, rd, sample).cover;
          if (prev >= 0) maxJump = Math.max(maxJump, Math.abs(cover - prev));
          if (
            cover > 0.05 &&
            cover < 0.95 &&
            rd < MEADOW_ROAD_CLEAR + MEADOW_ROAD_WANDER + MEADOW_ROAD_TOE
          ) {
            sawMid = true;
          }
          prev = cover;
        }
        expect(maxJump).toBeLessThan(0.45);
        if (sawMid) feathered++;
      }
    }
    expect(transects).toBeGreaterThan(4);
    expect(feathered / transects).toBeGreaterThan(0.5);
  });

  it('keeps the town ground all but bare', () => {
    const c = ctx();
    const sample = createMeadowPatchSample();
    const hub = { x: -14, z: -100 };
    let cover = 0;
    let n = 0;
    for (let x = hub.x - 60; x < hub.x + 60; x += 1.3) {
      for (let z = hub.z - 45; z < hub.z + 55; z += 1.3) {
        if (meadowTownWeight(c, x, z) < 0.99) continue;
        if (terrainHeight(x, z, WORLD_SEED) < WATER_LEVEL + 0.5) continue;
        cover += sampleMeadowPatch(c, x, z, roadDistance(x, z), sample).cover;
        n++;
      }
    }
    expect(n).toBeGreaterThan(1500);
    // only sparse tufts at the house walls and rocks survive in town
    expect(cover / n).toBeLessThan(0.1);
    // the hub's own disc and every town building sit inside the town ground
    expect(meadowTownWeight(c, hub.x, hub.z)).toBe(1);
    for (const b of EASTBROOK_LAYOUT.buildings) {
      expect(meadowTownWeight(c, b.position.x, b.position.z), b.id).toBe(1);
    }
    // far out in the vale there is no town
    expect(meadowTownWeight(c, 40, 60)).toBe(0);
  });

  it('grows thicker, slightly taller growth along path verges than on open ground', () => {
    const c = ctx();
    const sample = createMeadowPatchSample();
    let vergeCover = 0;
    let vergeHeight = 0;
    let vergeN = 0;
    for (let x = -170; x < 170; x += 0.8) {
      for (let z = -170; z < 170; z += 0.8) {
        const rd = roadDistance(x, z);
        // just past the toe: the verge
        if (rd < MEADOW_ROAD_CLEAR + MEADOW_ROAD_WANDER + MEADOW_ROAD_TOE || rd > 5.2) continue;
        if (meadowTownWeight(c, x, z) > 0) continue;
        const s = sampleMeadowPatch(c, x, z, rd, sample);
        if (s.scope < 1) continue;
        vergeCover += s.cover;
        vergeHeight += s.height * s.cover;
        vergeN++;
      }
    }
    expect(vergeN).toBeGreaterThan(1000);
    let openCover = 0;
    let openHeight = 0;
    const open = openGroundCells(2);
    for (const cell of open) {
      const s = sampleMeadowPatch(c, cell.x, cell.z, cell.rd, sample);
      openCover += s.cover;
      openHeight += s.height * s.cover;
    }
    const verge = vergeCover / vergeN;
    const openMean = openCover / open.length;
    expect(verge).toBeGreaterThan(0.5);
    expect(verge).toBeGreaterThan(2 * openMean);
    // edge growth stands taller than the average open clump
    expect(vergeHeight / vergeCover).toBeGreaterThan(1.1);
    expect(vergeHeight / vergeCover).toBeGreaterThan(openHeight / openCover);
  });

  it('rings rocks and building bases with growth, and nothing grows inside them', () => {
    const c = ctx();
    const scope = c.scope;
    if (!scope) throw new Error('scope expected');
    const sample = createMeadowPatchSample();
    let ringCover = 0;
    let ringN = 0;
    for (const rock of meadowScopeDecorations(scope).rocks) {
      if (meadowScopeWeight(scope, rock.x, rock.z) < 1) continue;
      const r = rock.scale * 1.05;
      // inside the stone: bare
      expect(sampleMeadowPatch(c, rock.x, rock.z, roadDistance(rock.x, rock.z), sample).cover).toBe(
        0,
      );
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = rock.x + Math.cos(a) * (r + 0.5);
        const z = rock.z + Math.sin(a) * (r + 0.5);
        const s = sampleMeadowPatch(c, x, z, roadDistance(x, z), sample);
        if (s.scope < 1) continue;
        ringCover += s.cover;
        ringN++;
      }
    }
    expect(ringN).toBeGreaterThan(100);
    expect(ringCover / ringN).toBeGreaterThan(0.4);
    // a building base in town: growth hugs the wall where open ground is bare
    const bank = EASTBROOK_LAYOUT.buildings.find((b) => b.id === 'eastbrook_bank');
    if (!bank) throw new Error('bank expected');
    const reach = bank.reach;
    let wallCover = 0;
    let wallN = 0;
    for (let t = -0.9; t <= 0.9; t += 0.05) {
      for (const side of [1, -1]) {
        // 1.4 yards out from the reach box's long sides
        const lx = t * reach.halfWidth;
        const lz = side * (reach.halfDepth + 0.6 + 1.0);
        const cos = Math.cos(reach.rotation);
        const sin = Math.sin(reach.rotation);
        const x = reach.center.x + lx * cos + lz * sin;
        const z = reach.center.z - lx * sin + lz * cos;
        const rd = roadDistance(x, z);
        if (rd < 6) continue;
        wallCover += sampleMeadowPatch(c, x, z, rd, sample).cover;
        wallN++;
      }
    }
    expect(wallN).toBeGreaterThan(10);
    expect(wallCover / wallN).toBeGreaterThan(0.15);
    // inside the bank's footprint nothing grows
    expect(
      sampleMeadowPatch(
        c,
        reach.center.x,
        reach.center.z,
        roadDistance(reach.center.x, reach.center.z),
        sample,
      ).cover,
    ).toBe(0);
  });

  it('keeps every height within the band and the average at the shipped knee height', () => {
    const c = ctx();
    const sample = createMeadowPatchSample();
    let weighted = 0;
    let weight = 0;
    for (let x = -175; x < 175; x += 1.2) {
      for (let z = -175; z < 175; z += 1.2) {
        const s = sampleMeadowPatch(c, x, z, roadDistance(x, z), sample);
        if (s.scope < 1 || s.cover <= 0) continue;
        expect(s.height).toBeGreaterThanOrEqual(MEADOW_CLUMP_RIM_HEIGHT - 1e-9);
        expect(s.height).toBeLessThanOrEqual(MEADOW_CLUMP_PEAK_MAX + 1e-9);
        expect(s.width).toBeLessThanOrEqual(MEADOW_PATCH_MAX_STRETCH);
        weighted += s.height * s.cover;
        weight += s.cover;
      }
    }
    // the art bible's cap is an actor's knee ON AVERAGE: the shipped crop
    // averages there, so the patch's grass-weighted mean stays near 1
    const mean = weighted / weight;
    expect(mean).toBeGreaterThan(0.85);
    expect(mean).toBeLessThan(1.05);
  });

  it('leans each clump subtly between sunlit yellow-green and shaded teal-green', () => {
    const c = ctx();
    const sample = createMeadowPatchSample();
    let sunny = 0;
    let shaded = 0;
    for (let x = -150; x < 150; x += 2.3) {
      for (let z = -150; z < 150; z += 2.3) {
        const s = sampleMeadowPatch(c, x, z, roadDistance(x, z), sample);
        for (const k of [s.tintR, s.tintG, s.tintB]) {
          expect(k).toBeGreaterThan(0.85);
          expect(k).toBeLessThan(1.1);
        }
        if (s.tintR > 1.01 && s.tintB < 0.99) sunny++;
        if (s.tintB > 1.01 && s.tintR < 0.99) shaded++;
      }
    }
    expect(sunny).toBeGreaterThan(200);
    expect(shaded).toBeGreaterThan(200);
    // the tint multiplies a colour; the accent helper folds the same tint in
    const color = { r: 0.5, g: 0.5, b: 0.5 };
    const s = sampleMeadowPatch(c, 30, 30, roadDistance(30, 30), sample);
    applyMeadowPatchTint(s, color);
    expect(color.r).toBeCloseTo(0.5 * s.tintR, 12);
    expect(color.b).toBeCloseTo(0.5 * s.tintB, 12);
    const accent = meadowPatchAccent(s, [1, 0.9, 0.8]);
    expect(accent[0]).toBeCloseTo(s.tintR, 12);
    expect(accent[2]).toBeCloseTo(0.8 * s.tintB, 12);
  });
});

describe('meadow patch core: scope and fairness', () => {
  it('samples the stock carpet in every other zone and on authored maps', () => {
    const c = ctx();
    const sample = createMeadowPatchSample();
    const stock = createMeadowPatchSample();
    // Mirefen, the Proving Shore, the Farshore and the far north
    for (const [x, z] of [
      [0, 300],
      [-300, 50],
      [300, 70],
      [-40, 1030],
      [0, 660],
    ] as const) {
      expect(sampleMeadowPatch(c, x, z, roadDistance(x, z), sample)).toEqual(stock);
    }
    // an authored map (not the built-in world) is stock even in Eastbrook
    const authored: WorldContent = { ...BUILTIN_WORLD, zones: [...BUILTIN_WORLD.zones] };
    const authoredCtx = meadowPatchContext(WORLD_SEED, authored);
    expect(authoredCtx.scope).toBeNull();
    for (const [x, z] of [
      [0, 0],
      [40, 60],
      [-14, -100],
    ] as const) {
      expect(sampleMeadowPatch(authoredCtx, x, z, roadDistance(x, z), sample)).toEqual(stock);
      expect(meadowPatchGrows(authoredCtx, x, z, roadDistance(x, z), 0.999)).toBe(true);
    }
    // the stock taper still applies outside the scope (scope weight 0)
    expect(sampleMeadowPatch(c, 0, 300, roadDistance(0, 300), sample).scope).toBe(0);
  });

  it('blends into the full carpet across a shared border with no step', () => {
    const c = ctx();
    const sample = createMeadowPatchSample();
    for (const z of [-60, 20, 95]) {
      let prev = sampleMeadowPatch(c, 120, z, roadDistance(120, z), sample).scope;
      for (let x = 120.25; x <= 180; x += 0.25) {
        const s = sampleMeadowPatch(c, x, z, roadDistance(x, z), sample);
        expect(Math.abs(s.scope - prev)).toBeLessThan(0.04);
        prev = s.scope;
      }
      expect(prev).toBe(0);
    }
  });

  it('shares one context across the grass layers and gates with the shared sample', () => {
    const c = ctx();
    expect(meadowPatchContext(WORLD_SEED, BUILTIN_WORLD)).toBe(c);
    let grew = 0;
    for (let x = -100; x < 100; x += 2.1) {
      const rd = roadDistance(x, 30);
      const roll = (x + 100) / 200;
      const g = meadowPatchGrows(c, x, 30, rd, roll);
      expect(g).toBe(roll < c.sample.cover);
      if (g) grew++;
    }
    expect(grew).toBeGreaterThan(0);
  });

  it('reads nothing a graphics tier sets, and every grass layer asks it', () => {
    const core = readFileSync(
      new URL('../src/render/meadow_patch_core.ts', import.meta.url),
      'utf8',
    );
    // tier-blind by construction: density may differ by tier, never colour or shape
    expect(core).not.toMatch(/from '\.\/gfx'/);
    expect(core).not.toMatch(/\bGFX\./);
    expect(core).not.toMatch(/from 'three'/);
    for (const file of ['blade_grass.ts', 'blade_grass_band.ts']) {
      const src = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(src, file).toContain('meadowPatchContext(seed, activeContent)');
      expect(src, file).toContain('meadowPatchGrows(meadowPatch, x, z, rd, hash(ci, cj, 7))');
      expect(src, file).toContain('grassEdgeWidthScale(edgeTaper) * patch.width');
      expect(src, file).toContain('patch.height');
      expect(src, file).toContain('applyMeadowPatchTint(patch, c)');
      expect(src, file).toContain('meadowScopedEdgeTaper(');
    }
    const foliage = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');
    expect(foliage).toContain('const patch = meadowPatchContext(seed, activeContent);');
    expect(foliage).toContain('if (!meadowPatchGrows(patch, x, z, rd, hashAt(i, j, 7))) continue;');
    expect(foliage).toContain('meadowPatchAccent(patch.sample, GRASS_ACCENT[tuftBiome])');
  });
});

/** A 256px macro readback drawn the way textures.ts macroNoiseTexture draws its
 *  canvas: a grey floor under 160 wrapped radial blobs (radius 18 to 64 px,
 *  value 40 to 215, alpha 0.3 fading to 0, source-over), from its LCG. */
function syntheticMacroReadback(): Uint8ClampedArray {
  const size = 256;
  let state = 4242;
  const rnd = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const value = new Float32Array(size * size).fill(128);
  for (let b = 0; b < 160; b++) {
    const bx = rnd() * size;
    const by = rnd() * size;
    const r = 18 + rnd() * 46;
    const v = 40 + rnd() * 175;
    for (let y = Math.floor(by - r); y <= Math.ceil(by + r); y++) {
      for (let x = Math.floor(bx - r); x <= Math.ceil(bx + r); x++) {
        const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by);
        if (d >= r) continue;
        const a = 0.3 * (1 - d / r);
        const i = (((y % size) + size) % size) * size + (((x % size) + size) % size);
        value[i] = value[i] * (1 - a) + v * a;
      }
    }
  }
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = Math.round(value[i]);
    out[i * 4 + 1] = out[i * 4];
    out[i * 4 + 2] = out[i * 4];
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe('meadow patch core: the painted ground agrees', () => {
  /** Record the synthetic macro the way terrain.ts does (its stats readback). */
  function recordMacro() {
    const stats = macroStatsOf(syntheticMacroReadback(), 4);
    const macro = paintedGroundMacro();
    if (!macro) throw new Error('macro expected');
    const sampler = (u: number, v: number) => samplePaintedGroundMacro(macro, u, v);
    return { stats, sampler };
  }

  it('mirrors the dirt weight the terrain lays its cobbles on', () => {
    expect(paintedDirtWeight(0, 100)).toBeCloseTo(0.88, 12);
    expect(paintedDirtWeight(1.89, 100)).toBeCloseTo(0.88, 12);
    expect(paintedDirtWeight(2.75, 100)).toBeCloseTo(0.44, 6);
    expect(paintedDirtWeight(3.6, 100)).toBe(0);
    expect(paintedDirtWeight(Number.POSITIVE_INFINITY, 0)).toBeCloseTo(0.75, 12);
    expect(paintedDirtWeight(Number.POSITIVE_INFINITY, 12.5)).toBeCloseTo(0.375, 12);
    expect(paintedDirtWeight(Number.POSITIVE_INFINITY, 14)).toBe(0);
    // the source those numbers are copied from (terrain_chunk_build.ts
    // sampleVertex, the splat tiers' arm): a change there reds here
    const src = readFileSync(
      new URL('../src/render/terrain_chunk_build.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('const rdCore = lowShade ? Math.max(2.1, stepX * 0.62) : 1.9;');
    expect(src).toContain('const rdSpan = lowShade ? Math.max(2.1, stepX * 0.72) : 1.7;');
    expect(src).toContain('lerpSplat(w, 1, 0.88);');
    expect(src).toContain('const t = 0.88 * u * u * (3 - 2 * u);');
    expect(src).toContain('if (dHub < 14) {');
    expect(src).toContain('const hubT = clamp01((14 - dHub) / 3);');
    expect(src).toContain('lerpSplat(w, 1, 0.75 * hubT);');
  });

  it('picks up the terrain macro even when the context was built first', () => {
    const c = ctx();
    expect(c.ground).toBeNull();
    recordMacro();
    sampleMeadowPatch(c, 30, 40, roadDistance(30, 40), createMeadowPatchSample());
    expect(c.ground).not.toBeNull();
    clearPaintedGroundMacro();
    sampleMeadowPatch(c, 30, 40, roadDistance(30, 40), createMeadowPatchSample());
    expect(c.ground).toBeNull();
  });

  it('thins blades strongly on leaf litter and bare earth, and only there', () => {
    const c = ctx();
    const scope = c.scope;
    if (!scope) throw new Error('scope expected');
    const cells: { x: number; z: number; rd: number; cover: number; height: number }[] = [];
    const sample = createMeadowPatchSample();
    for (let x = -150; x < 150; x += 1.7) {
      for (let z = -150; z < 150; z += 1.7) {
        if (meadowScopeWeight(scope, x, z) < 1) continue;
        // away from the town footprint and its cobble lanes, so no cobble enters
        if (Math.hypot(x - scope.hub.x, z - scope.hub.z) < 60) continue;
        if (townCobbleAt(x, z, [], 3, resolveCobbleLanes(BUILTIN_WORLD.zones)) > 0) continue;
        const rd = roadDistance(x, z);
        const s = sampleMeadowPatch(c, x, z, rd, sample);
        if (s.cover <= 0) continue;
        cells.push({ x, z, rd, cover: s.cover, height: s.height });
      }
    }
    expect(cells.length).toBeGreaterThan(3000);
    const { stats, sampler } = recordMacro();
    let thick = 0;
    let clean = 0;
    for (const cell of cells) {
      const m = coverMasksAt(cell.x, cell.z, 1, sampler, stats);
      const litter = m.leaf + m.earth;
      const s = sampleMeadowPatch(c, cell.x, cell.z, cell.rd, sample);
      if (litter >= MEADOW_LITTER_FULL) {
        // the heart of a patch keeps only the turf poking through
        expect(s.cover).toBeCloseTo(cell.cover * (1 - MEADOW_LITTER_THIN), 9);
        expect(s.height).toBeCloseTo(cell.height * (1 - MEADOW_LITTER_SHORTEN), 9);
        thick++;
      } else if (litter <= MEADOW_LITTER_START) {
        // clean grass ground: exactly the patch as it was
        expect(s.cover).toBeCloseTo(cell.cover, 12);
        expect(s.height).toBeCloseTo(cell.height, 12);
        clean++;
      } else {
        expect(s.cover).toBeLessThanOrEqual(cell.cover + 1e-12);
      }
    }
    expect(thick).toBeGreaterThan(100);
    expect(clean).toBeGreaterThan(100);
  });

  it('keeps every blade off the town cobbles', () => {
    const { stats, sampler } = recordMacro();
    const c = ctx();
    const scope = c.scope;
    if (!scope) throw new Error('scope expected');
    const towns = resolveCobbleTowns(BUILTIN_WORLD.zones);
    const sample = createMeadowPatchSample();
    let onCobble = 0;
    let offTown = 0;
    for (let x = scope.hub.x - 50; x < scope.hub.x + 50; x += 0.6) {
      for (let z = scope.hub.z - 50; z < scope.hub.z + 50; z += 0.6) {
        const rd = roadDistance(x, z);
        const hubDist = Math.hypot(x - scope.hub.x, z - scope.hub.z);
        const m = coverMasksAt(x, z, 1, sampler, stats);
        const lane = townCobbleAt(x, z, towns, m.repeatZ) * paintedDirtWeight(rd, hubDist);
        if (lane < MEADOW_COBBLE_FULL) continue;
        expect(sampleMeadowPatch(c, x, z, rd, sample).cover).toBe(0);
        onCobble++;
      }
    }
    expect(onCobble).toBeGreaterThan(200);
    // the main street's cobble lane, out past the footprint to the docks: no blade on it
    const lanes = resolveCobbleLanes(BUILTIN_WORLD.zones);
    let onLane = 0;
    for (const [ax, az, bx, bz] of lanes.filter((l) => l[0] < 1e4)) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const hubDist = Math.hypot(x - scope.hub.x, z - scope.hub.z);
        if (hubDist <= towns[0][3]) continue;
        const rd = roadDistance(x, z);
        const m = coverMasksAt(x, z, 1, sampler, stats);
        const lane = townCobbleAt(x, z, towns, m.repeatZ, lanes) * paintedDirtWeight(rd, hubDist);
        if (lane < MEADOW_COBBLE_FULL) continue;
        expect(sampleMeadowPatch(c, x, z, rd, sample).cover).toBe(0);
        onLane++;
      }
    }
    expect(onLane).toBeGreaterThan(20);
    // the cobbles are the town's: a street shoulder far out in the vale, off the town's own
    // streets, keeps its verge (only the stock road clear applies there)
    for (const road of BUILTIN_WORLD.roads) {
      for (const p of road) {
        if (meadowScopeWeight(scope, p.x, p.z) < 1) continue;
        if (Math.hypot(p.x - scope.hub.x, p.z - scope.hub.z) < 70) continue;
        if (townCobbleAt(p.x, p.z, [], 3, lanes) > 0) continue;
        expect(townCobbleAt(p.x, p.z, towns, 0, lanes)).toBe(0);
        offTown++;
      }
    }
    expect(offTown).toBeGreaterThan(10);
  });
});
