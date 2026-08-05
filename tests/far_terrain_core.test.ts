import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLASSIC_CAMERA_FAR,
  createFarTileBuilder,
  detailCullFar,
  FAR_MESH_DROP,
  FAR_TILE_FOG_MARGIN,
  FAR_TILE_SIZE,
  FAR_WORLD_MARGIN,
  type FarTile,
  FOGLESS_DETAIL_FAR,
  farGridIndices,
  farGridSide,
  farGroundColor,
  farTileBuildOrder,
  farTileVisible,
  farVertexHeight,
  farVistaPlan,
  horizonHazePlan,
  planFarTiles,
  srgbHexToLinear,
} from '../src/render/far_terrain_core';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z } from '../src/sim/data';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 20061; // the fixed built-in world seed (src/main.ts)
const MAX_OUTDOOR = 850; // zone_streaming.ts envelope

// The whole-world diagonal the vista must cover for "see the whole game".
const WORLD_DIAGONAL = Math.hypot(WORLD_MAX_X - WORLD_MIN_X, WORLD_MAX_Z - WORLD_MIN_Z);

describe('farVistaPlan: per-tier vista envelopes', () => {
  it('low tier and constrained devices keep the classic renderer exactly', () => {
    for (const plan of [
      farVistaPlan('low', false),
      farVistaPlan('low', true),
      farVistaPlan('high', true),
      farVistaPlan('ultra', true),
    ]) {
      expect(plan.enabled).toBe(false);
      expect(plan.cameraFar).toBe(CLASSIC_CAMERA_FAR);
    }
  });

  it('high and ultra see the whole world: envelope beats the map diagonal', () => {
    for (const tier of ['high', 'ultra'] as const) {
      const plan = farVistaPlan(tier, false);
      expect(plan.enabled).toBe(true);
      expect(plan.envelopeFar).toBeGreaterThanOrEqual(WORLD_DIAGONAL);
      expect(plan.cameraFar).toBeGreaterThan(plan.envelopeFar);
    }
  });

  it('medium opens a shorter vista, still far past the classic envelope', () => {
    const plan = farVistaPlan('medium', false);
    expect(plan.enabled).toBe(true);
    expect(plan.envelopeFar).toBeGreaterThan(MAX_OUTDOOR * 2);
    expect(plan.envelopeFar).toBeLessThan(farVistaPlan('high', false).envelopeFar);
  });

  it('every enabled spacing divides the tile size (shared-edge grid, no cracks)', () => {
    for (const tier of ['medium', 'high', 'ultra'] as const) {
      const plan = farVistaPlan(tier, false);
      expect(FAR_TILE_SIZE % plan.spacing).toBe(0);
    }
  });
});

describe('detailCullFar: the classic envelope still bounds the detail subsystems', () => {
  it('caps the subsystem view at the classic envelope', () => {
    expect(detailCullFar(3200, MAX_OUTDOOR)).toBe(MAX_OUTDOOR);
    expect(detailCullFar(510, MAX_OUTDOOR)).toBe(510);
  });

  it('the fog-free detail horizon never exceeds what the fogged clear realms drew', () => {
    // 700 is the widest preset the fogged clear realms ever culled at
    // (renderer BIOME_FOG); the fog-free arm must not widen any detail
    // subsystem's workload beyond that, and must stay inside the classic cap.
    expect(FOGLESS_DETAIL_FAR).toBe(700);
    expect(FOGLESS_DETAIL_FAR).toBeLessThanOrEqual(MAX_OUTDOOR);
  });

  it('the horizon haze never touches gameplay range and saturates past the world', () => {
    for (const tier of ['medium', 'high', 'ultra', 'insane'] as const) {
      const plan = farVistaPlan(tier, false);
      const haze = horizonHazePlan(plan.envelopeFar);
      // the band starts in the outer half of the vista, past everything the
      // detail subsystems draw (700u), with a third again of clear margin on
      // the tightest tier: gameplay range and the handoff line stay crystal
      // clear on every vista tier
      expect(haze.near).toBeGreaterThan(FOGLESS_DETAIL_FAR * 1.3);
      expect(haze.near).toBeGreaterThanOrEqual(plan.envelopeFar * 0.35);
      // full atmosphere only past the whole-world envelope: the sea horizon
      // melts, the world itself stays readable
      expect(haze.far).toBeGreaterThan(plan.envelopeFar);
      expect(haze.near).toBeLessThan(plan.envelopeFar);
    }
  });

  it('mid-range content takes exactly zero haze, the world rim takes most of it', () => {
    // The two halves of "slight atmosphere so the very far objects fade away":
    // nothing the detail subsystems draw may be tinted at all (the fog color
    // is the biome preset times the day/night grade, so a band that reached
    // inward would repaint mid-distance sprites at dawn), and the far rim has
    // to pick up enough of it to actually read as distance.
    const fogAt = (d: number, haze: { near: number; far: number }): number =>
      Math.max(0, Math.min(1, (d - haze.near) / (haze.far - haze.near)));
    for (const tier of ['medium', 'high', 'ultra', 'insane'] as const) {
      const plan = farVistaPlan(tier, false);
      const haze = horizonHazePlan(plan.envelopeFar);
      expect(fogAt(FOGLESS_DETAIL_FAR, haze)).toBe(0);
      const atRim = fogAt(plan.envelopeFar, haze);
      expect(atRim).toBeGreaterThan(0.5); // the horizon genuinely softens
      expect(atRim).toBeLessThan(0.75); // but never washes the world out
    }
  });
});

describe('planFarTiles: the whole grown world, aligned, no gaps', () => {
  const tiles = planFarTiles(WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Z, WORLD_MAX_Z);

  it('covers the world rect plus the margin on every side', () => {
    const minX = Math.min(...tiles.map((t) => t.x0));
    const maxX = Math.max(...tiles.map((t) => t.x0 + t.size));
    const minZ = Math.min(...tiles.map((t) => t.z0));
    const maxZ = Math.max(...tiles.map((t) => t.z0 + t.size));
    expect(minX).toBe(WORLD_MIN_X - FAR_WORLD_MARGIN);
    expect(minZ).toBe(WORLD_MIN_Z - FAR_WORLD_MARGIN);
    expect(maxX).toBeGreaterThanOrEqual(WORLD_MAX_X + FAR_WORLD_MARGIN);
    expect(maxZ).toBeGreaterThanOrEqual(WORLD_MAX_Z + FAR_WORLD_MARGIN);
  });

  it('tiles align to one global grid (neighbours share sample columns)', () => {
    for (const tile of tiles) {
      expect((tile.x0 - (WORLD_MIN_X - FAR_WORLD_MARGIN)) % FAR_TILE_SIZE).toBe(0);
      expect((tile.z0 - (WORLD_MIN_Z - FAR_WORLD_MARGIN)) % FAR_TILE_SIZE).toBe(0);
    }
    const keys = new Set(tiles.map((t) => `${t.x0}:${t.z0}`));
    expect(keys.size).toBe(tiles.length);
  });

  it('stays a few dozen frustum-cullable draws, not hundreds', () => {
    expect(tiles.length).toBeGreaterThan(10);
    expect(tiles.length).toBeLessThan(80);
  });

  it('build order walks outward from the priority point', () => {
    const order = farTileBuildOrder(tiles, 0, 0);
    expect(order.length).toBe(tiles.length);
    const d = (i: number) => tiles[order[i]].cx ** 2 + tiles[order[i]].cz ** 2;
    for (let i = 1; i < order.length; i++) {
      expect(d(i)).toBeGreaterThanOrEqual(d(i - 1));
    }
  });
});

describe('far tile visibility: the view envelope is the cull', () => {
  const tileAt = (x0: number, z0: number, size = 960): FarTile => ({
    x0,
    z0,
    size,
    cx: x0 + size / 2,
    cz: z0 + size / 2,
  });

  it('the tile under the camera always draws', () => {
    const tile = tileAt(0, 0);
    expect(farTileVisible(tile, 480, 480, 100)).toBe(true);
  });

  it('a tile hides once its nearest edge sits past the envelope plus margin', () => {
    const tile = tileAt(1000, 0);
    // nearest edge along +x from a camera at the origin row: 1000 away
    expect(farTileVisible(tile, 0, 480, 1000 - FAR_TILE_FOG_MARGIN + 1)).toBe(true);
    expect(farTileVisible(tile, 0, 480, 1000 - FAR_TILE_FOG_MARGIN - 1)).toBe(false);
  });

  it('a shrunk view (an indoor state) sheds distant tiles', () => {
    const shrunk = 124;
    expect(farTileVisible(tileAt(0, 0), 100, 100, shrunk)).toBe(true);
    expect(farTileVisible(tileAt(960, 0), 100, 100, shrunk)).toBe(false);
    expect(farTileVisible(tileAt(0, 960), 100, 100, shrunk)).toBe(false);
  });

  it('the whole-world envelope keeps every tile visible from anywhere', () => {
    for (const tile of planFarTiles(WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Z, WORLD_MAX_Z)) {
      expect(farTileVisible(tile, 0, 1120, 3200)).toBe(true);
    }
  });
});

describe('far grid geometry', () => {
  it('side counts and index buffers are exact for every shipped spacing', () => {
    for (const spacing of [10, 12, 16]) {
      const side = farGridSide(FAR_TILE_SIZE, spacing);
      expect(side).toBe(FAR_TILE_SIZE / spacing + 1);
      const indices = farGridIndices(side);
      expect(indices.length).toBe((side - 1) * (side - 1) * 6);
      let max = 0;
      const seen = new Set<number>();
      for (const i of indices) {
        if (i > max) max = i;
        seen.add(i);
      }
      expect(max).toBe(side * side - 1);
      expect(seen.size).toBe(side * side); // every vertex is referenced
    }
  });

  it('srgbHexToLinear matches the sRGB transfer curve', () => {
    expect(srgbHexToLinear(0xffffff)).toEqual([1, 1, 1]);
    expect(srgbHexToLinear(0x000000)).toEqual([0, 0, 0]);
    const [mid] = srgbHexToLinear(0x808080);
    expect(mid).toBeCloseTo(0.2158, 3);
  });

  it('refuses a grid side that would overflow the shared Uint16 index buffer', () => {
    expect(() => farGridIndices(257)).toThrow(/Uint16/);
  });
});

describe('createFarTileBuilder: real heights, deterministic, incremental', () => {
  const tile: FarTile = { x0: -240, z0: -120, size: 480, cx: 0, cz: 120 };
  const SPACING = 24; // coarse test spacing, divides 480

  const buildAll = (rowsPerStep: number) => {
    const b = createFarTileBuilder(tile, SPACING, SEED);
    while (!b.step(rowsPerStep)) {
      // drain
    }
    return b.result();
  };

  it('positions carry the crest-preserving height minus the anti-poke drop', () => {
    const data = buildAll(64);
    const side = farGridSide(tile.size, SPACING);
    expect(data.positions.length).toBe(side * side * 3);
    for (const [ix, iz] of [
      [0, 0],
      [side - 1, 0],
      [7, 13],
      [side - 1, side - 1],
    ]) {
      const vi = (iz * side + ix) * 3;
      const x = tile.x0 + ix * SPACING;
      const z = tile.z0 + iz * SPACING;
      expect(data.positions[vi]).toBe(x);
      expect(data.positions[vi + 2]).toBe(z);
      // farVertexHeight, not the raw point sample: the crest max keeps ridge
      // silhouettes truthful now that no fog hides the shaving.
      expect(data.positions[vi + 1]).toBeCloseTo(
        farVertexHeight(x, z, SPACING, SEED) - FAR_MESH_DROP,
        4,
      );
      expect(data.positions[vi + 1]).toBeGreaterThanOrEqual(
        terrainHeight(x, z, SEED) - FAR_MESH_DROP - 1e-4,
      );
    }
    expect(data.minY).toBeLessThanOrEqual(data.maxY);
  });

  it('a one-row-at-a-time build is byte-identical to a one-shot build', () => {
    const slow = buildAll(1);
    const fast = buildAll(1024);
    expect(slow.positions).toEqual(fast.positions);
    expect(slow.normals).toEqual(fast.normals);
    expect(slow.colors).toEqual(fast.colors);
  });

  it('colors are finite unit-range linear triples with unit normals', () => {
    const data = buildAll(64);
    for (let i = 0; i < data.colors.length; i++) {
      expect(data.colors[i]).toBeGreaterThanOrEqual(0);
      expect(data.colors[i]).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < data.normals.length; i += 3) {
      const len = Math.hypot(data.normals[i], data.normals[i + 1], data.normals[i + 2]);
      expect(len).toBeCloseTo(1, 3);
      expect(data.normals[i + 1]).toBeGreaterThan(0); // ground never faces down
    }
  });

  it('result() before completion throws instead of returning a half-built tile', () => {
    const b = createFarTileBuilder(tile, SPACING, SEED);
    b.step(1);
    expect(() => b.result()).toThrow();
  });
});

describe('farGroundColor: the far recipe reads like the world it stands in for', () => {
  const color = (x: number, z: number): [number, number, number] => {
    const out: [number, number, number] = [0, 0, 0];
    const h = terrainHeight(x, z, SEED);
    // gentle ground the mesh resolves fully: no widening, the bare thresholds
    farGroundColor(x, z, h, 0.1, 0, 0, SEED, out);
    return out;
  };

  it('the vale reads green', () => {
    const [r, g, b] = color(60, 40);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('the Frostveil interior reads snow-bright', () => {
    const [r, g, b] = color(-30, 1700);
    expect(r + g + b).toBeGreaterThan(1.2);
    expect(Math.abs(r - b)).toBeLessThan(0.25); // near-neutral white, not green
  });

  it('the Drakelands volcanic peaks never take snow: high ember ground is dark basalt', () => {
    // The Drakemaw Caldera rim (sim world.ts EMBER_VOLCANOES, h up to ~27).
    const [r, g, b] = color(390, 2320);
    expect(r + g + b).toBeLessThan(1.0); // dark, nothing like the snowCap tone
    expect(r).toBeGreaterThanOrEqual(b); // warm volcanic rock, not blue-white
  });

  it('the world rim fades toward the atmospheric haze tone', () => {
    const rim = color(WORLD_MAX_X + 120, 1200);
    const interior = color(0, 1200);
    // the rim tone is the hazy blue: blue channel dominates its red
    expect(rim[2]).toBeGreaterThan(rim[0]);
    // and it is far from the interior ground color
    const dist = Math.hypot(rim[0] - interior[0], rim[1] - interior[1], rim[2] - interior[2]);
    expect(dist).toBeGreaterThan(0.05);
  });

  it('stays deterministic: same input, same triple', () => {
    expect(color(123, 456)).toEqual(color(123, 456));
  });
});

describe('the coarse mesh never paints a transition it cannot resolve', () => {
  // A mountainside a few hundred yards out rendered as large individually
  // shaded triangles, several of them pale snow-white against near-black
  // neighbours. The normals were never the cause (they are smooth
  // neighbour-averaged central differences, and the shading variance they
  // carry is the real heightfield's). The colour recipe was: it re-reads the
  // near terrain's thresholds, which are sized against a heightfield that
  // steps 6 units, on a mesh whose cliffs climb 25 units between NEIGHBOURING
  // vertices. A 26 unit snow ramp then resolves inside one cell.
  const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  it('a threshold the mesh resolves is untouched; one it cannot is spread out', () => {
    // Two heights one cell apart on the Duskmoor sea cliffs, straddling the
    // snow line. Sampled as if the mesh resolved them (no per-cell change)
    // they take the bare thresholds and land far apart; sampled with the
    // climb those cells really carry, the same pair converges.
    const [x, z] = [156, 924];
    const at = (h: number, rise: number, slopeRise: number): number => {
      const out: [number, number, number] = [0, 0, 0];
      farGroundColor(x, z, h, 2.7, rise, slopeRise, SEED, out);
      return lum(out[0], out[1], out[2]);
    };
    const sharpGap = Math.abs(at(66.6, 0, 0) - at(41.6, 0, 0));
    const softGap = Math.abs(at(66.6, 21.6, 1.5) - at(41.6, 39.5, 1.5));
    expect(sharpGap).toBeGreaterThan(0.3); // the shipped hard step
    expect(softGap).toBeLessThan(sharpGap / 2); // more than halved
  });

  it('adjacent far vertices never step a whole palette apart, on any spacing', () => {
    // The real builder over the steepest above-water ground in the world
    // (the Duskmoor cliffs, slopes past 3.0 at far-mesh scale). Measured
    // against the shipped recipe this region peaked at 0.63; the pin sits
    // just above what the widened ramps leave, so a threshold that stops
    // widening fails here rather than in a screenshot.
    for (const spacing of [8, 12, 16]) {
      const tile: FarTile = { x0: -140, z0: 700, size: 480, cx: 100, cz: 940 };
      const b = createFarTileBuilder(tile, spacing, SEED);
      while (!b.step(4096)) {
        // drain
      }
      const d = b.result();
      const side = farGridSide(tile.size, spacing);
      let worst = 0;
      const pair = (a: number, c: number): void => {
        // underwater vertices are hidden by the water plane, so only the
        // visible surface is held to this
        if (d.positions[a * 3 + 1] < WATER_LEVEL || d.positions[c * 3 + 1] < WATER_LEVEL) return;
        worst = Math.max(
          worst,
          Math.abs(
            lum(d.colors[a * 3], d.colors[a * 3 + 1], d.colors[a * 3 + 2]) -
              lum(d.colors[c * 3], d.colors[c * 3 + 1], d.colors[c * 3 + 2]),
          ),
        );
      };
      for (let iz = 0; iz < side; iz++) {
        for (let ix = 0; ix < side; ix++) {
          if (ix > 0) pair(iz * side + ix, iz * side + ix - 1);
          if (iz > 0) pair(iz * side + ix, (iz - 1) * side + ix);
        }
      }
      expect(worst).toBeLessThan(0.33);
    }
  });

  it('still snows the summits: softening the ramp did not just erase the snow', () => {
    const tile: FarTile = { x0: -140, z0: 700, size: 480, cx: 100, cz: 940 };
    const b = createFarTileBuilder(tile, 8, SEED);
    while (!b.step(4096)) {
      // drain
    }
    const d = b.result();
    const side = farGridSide(tile.size, 8);
    let gentleHigh = 0;
    let snowBright = 0;
    for (let i = 0; i < side * side; i++) {
      // High ground the mesh DOES resolve: a summit or a ledge, not a face.
      // The bar is 50 rather than the snow line itself because the line
      // carries a deliberate 14 unit patch-noise shift, so a vertex sitting a
      // couple of units over it is legitimately bare on an unlucky sample.
      if (d.positions[i * 3 + 1] < 50 || d.normals[i * 3 + 1] < 0.93) continue;
      gentleHigh++;
      if (lum(d.colors[i * 3], d.colors[i * 3 + 1], d.colors[i * 3 + 2]) > 0.5) snowBright++;
    }
    expect(gentleHigh).toBeGreaterThan(0);
    expect(snowBright).toBe(gentleHigh);
  });
});

describe('module purity', () => {
  it('imports no Three, DOM, or painter modules (Node-testable core)', () => {
    const src = readFileSync(new URL('../src/render/far_terrain_core.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from 'three'/);
    expect(src).not.toMatch(/from '\.\/far_terrain'/);
    expect(src).not.toMatch(/document\.|window\./);
  });
});
