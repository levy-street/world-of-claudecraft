import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  advanceWithinBudget,
  CLASSIC_CAMERA_FAR,
  createFarShortfallSampler,
  createFarTileBuilder,
  detailCullFar,
  FAR_MESH_DROP,
  FAR_RIM_TINT_ALT,
  FAR_RIM_TINT_BASE,
  FAR_TILE_FOG_MARGIN,
  FAR_TILE_SIZE,
  FAR_WORLD_MARGIN,
  type FarTile,
  FOGLESS_DETAIL_FAR,
  farFieldPolicy,
  farGridIndices,
  farGridSide,
  farGroundColor,
  farTileBuildOrder,
  farTileVisible,
  farVertexHeight,
  farVertexRenderY,
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
    for (const tier of ['medium', 'high', 'ultra', 'insane'] as const) {
      const plan = farVistaPlan(tier, false);
      expect(FAR_TILE_SIZE % plan.spacing).toBe(0);
    }
  });

  it('ultra does not tessellate the vista finer than high, which buys nothing', () => {
    // The layer's nearest fragment sits past the detail horizon less the
    // discard margin, about 640 yards out, where one cell of either grid is
    // barely more than a dozen screen pixels: the extra vertices bought
    // sub-pixel silhouette accuracy and cost 44 percent more vista triangles
    // every frame plus 44 percent more terrainHeight sampling in the boot
    // build. The ladder still has to be monotone, and insane still exists to
    // measure the finer grid against.
    const high = farVistaPlan('high', false).spacing;
    const ultra = farVistaPlan('ultra', false).spacing;
    const insane = farVistaPlan('insane', false).spacing;
    expect(ultra).toBe(high);
    expect(insane).toBeLessThan(ultra);
    expect(ultra).toBeLessThan(farVistaPlan('medium', false).spacing);
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

  it('positions carry the sampled height minus the drop and the clearance', () => {
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
      // At or under farVertexHeight minus the drop: the builder also subtracts a
      // per-vertex CLEARANCE (far_surface_core.ts), which is zero on ground the
      // flat triangles already sit under and grows where they would bridge a
      // dip. Never above, which is the invariant the whole layer rests on.
      expect(data.positions[vi + 1]).toBeLessThanOrEqual(
        farVertexHeight(x, z, SPACING, SEED) - FAR_MESH_DROP + 1e-4,
      );
      expect(data.positions[vi + 1]).toBeLessThanOrEqual(
        terrainHeight(x, z, SEED) - FAR_MESH_DROP + 1e-4,
      );
    }
    expect(data.minY).toBeLessThanOrEqual(data.maxY);
  });

  it('NEVER rises above the real terrain, at any spacing, on any ground', () => {
    // The invariant this whole layer lives or dies by. The coarse mesh is a
    // stand-in; the instant it sits higher than the terrain it stands in for,
    // it wins the depth test and surfaces through the detailed terrain as a
    // smooth skin in the wrong shape. Swept rather than spot-checked, because
    // the failure only appeared on steep ground: the previous recipe took the
    // MAX of the half-cell neighbourhood and then ADDED up to 4.75 units of
    // crag, so it cleared the true surface almost everywhere with any slope.
    for (const spacing of [8, 10, 12, 16]) {
      let worst = Number.NEGATIVE_INFINITY;
      let worstAt = '';
      // A transect over the mountain-heavy north (Thornpeak z 540..900) plus the
      // valley and coast bands, so cliffs, ridges, meadow and shore all appear.
      for (let z = -160; z <= 900; z += 37) {
        for (let x = -500; x <= 500; x += 53) {
          const over = farVertexHeight(x, z, spacing, SEED) - terrainHeight(x, z, SEED);
          if (over > worst) {
            worst = over;
            worstAt = `spacing ${spacing} at ${x},${z}`;
          }
        }
      }
      // Zero, not a tolerance: the min can only equal the point sample, and the
      // crag only subtracts. FAR_MESH_DROP is then pure headroom on top.
      expect(worst, worstAt).toBeLessThanOrEqual(1e-6);
    }
  });

  it('still breaks up high ground, so peaks are not smooth cones', () => {
    // The crag now carves instead of building, and it still has to DO something:
    // a coarse peak with no relief reads as a cone whatever its colour.
    const spacing = 10;
    let varied = 0;
    let samples = 0;
    for (let z = 540; z <= 900; z += 11) {
      for (let x = -400; x <= 400; x += 17) {
        const raw = terrainHeight(x, z, SEED);
        if (raw < 20) continue; // crag only engages on high ground
        samples++;
        if (Math.abs(farVertexHeight(x, z, spacing, SEED) - raw) > 0.5) varied++;
      }
    }
    expect(samples).toBeGreaterThan(50);
    expect(varied / samples).toBeGreaterThan(0.5);
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

  it('the world rim shifts COOL toward the atmospheric haze tone', () => {
    const rim = color(WORLD_MAX_X + 120, 1200);
    const interior = color(0, 1200);
    // The direction is what the wash means, and it survives whatever base tone
    // (green, rock, sand) the rim happens to stand on: the hazy peak tone is
    // blue-dominant, so mixing toward it always widens blue over red. An
    // absolute "blue beats red" only held while the wash was heavy enough to
    // overwhelm a warm base, which is exactly the strength it should not have.
    expect(rim[2] - rim[0]).toBeGreaterThan(interior[2] - interior[0]);
    // and it is a visible shift, not a rounding difference
    const dist = Math.hypot(rim[0] - interior[0], rim[1] - interior[1], rim[2] - interior[2]);
    expect(dist).toBeGreaterThan(0.05);
  });

  it('the rim wash stays a hint: the LIVE haze owns the recession, not the bake', () => {
    // Baked paint cannot answer the sky, the hour, or the weather, and the
    // per-zone haze field now puts real aerial perspective on exactly the
    // kilometre-plus distances the rim band sits at. Their sum is the contract:
    // at 0.18 plus 0.30 the two painted the same recession twice and the rim
    // range read as flat pale cones under every light.
    expect(FAR_RIM_TINT_BASE + FAR_RIM_TINT_ALT).toBeLessThanOrEqual(0.25);
    // ...and never zero, or a rim valley loses its distance cue entirely
    expect(FAR_RIM_TINT_BASE).toBeGreaterThan(0);
    expect(FAR_RIM_TINT_ALT).toBeGreaterThan(0);
    // altitude still weighted: a summit recedes further than the ground below it
    const low = color(WORLD_MAX_X + 120, 1200);
    const high: [number, number, number] = [0, 0, 0];
    farGroundColor(WORLD_MAX_X + 120, 1200, 46, 0.1, 0, 0, SEED, high);
    expect(high[2] - high[0]).toBeGreaterThan(low[2] - low[0]);
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

describe('farFieldPolicy: the ONE capability decision for sprites and the vista', () => {
  const full = { standardMaterials: true, leanFoliage: false, constrainedMemory: false };

  it('full-capability desktop tiers get sprites, and the vista follows the tier plan', () => {
    for (const tier of ['medium', 'high', 'ultra', 'insane'] as const) {
      const policy = farFieldPolicy(tier, full);
      expect(policy.sprites).toBe(true);
      expect(policy.vista).toEqual(farVistaPlan(tier, false));
      expect(policy.vista.enabled).toBe(true);
    }
  });

  it('low tier: lean pipeline, no sprites, no vista (the classic renderer)', () => {
    // the low tier ships leanFoliage and no standard materials
    const policy = farFieldPolicy('low', {
      standardMaterials: false,
      leanFoliage: true,
      constrainedMemory: false,
    });
    expect(policy.sprites).toBe(false);
    expect(policy.vista.enabled).toBe(false);
    expect(policy.vista.cameraFar).toBe(CLASSIC_CAMERA_FAR);
  });

  it('weak-iGPU medium (leanFoliage on a standard-material tier): NEITHER arm', () => {
    // The divergence this policy exists to kill: farVistaPlan(medium) alone
    // would open the fog-free vista while the lean sprite arm bakes nothing,
    // leaving a bare-ground horizon with no far foliage.
    const policy = farFieldPolicy('medium', {
      standardMaterials: true,
      leanFoliage: true,
      constrainedMemory: false,
    });
    expect(policy.sprites).toBe(false);
    expect(policy.vista.enabled).toBe(false);
  });

  it('constrained-memory medium/high (phone-class ceilings): NEITHER arm, no atlas', () => {
    // The other divergence: constrained profiles used to keep classic fog
    // (vista off) while still BAKING the sprite atlas, putting the largest
    // one-shot GPU allocation on the most memory-sensitive devices.
    for (const tier of ['medium', 'high'] as const) {
      const policy = farFieldPolicy(tier, {
        standardMaterials: true,
        leanFoliage: false,
        constrainedMemory: true,
      });
      expect(policy.sprites).toBe(false);
      expect(policy.vista.enabled).toBe(false);
    }
  });

  it('native iOS memory profile: NEITHER arm (constrained and no standard materials)', () => {
    // nativeIosMemoryProfile forces constrainedMemory true AND
    // standardMaterials false in gfx.ts; either alone already disables both
    // arms here.
    const policy = farFieldPolicy('high', {
      standardMaterials: false,
      leanFoliage: false,
      constrainedMemory: true,
    });
    expect(policy.sprites).toBe(false);
    expect(policy.vista.enabled).toBe(false);
  });

  it('the vista NEVER enables without sprites, on any flag combination', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      for (const standardMaterials of [true, false]) {
        for (const leanFoliage of [true, false]) {
          for (const constrainedMemory of [true, false]) {
            const policy = farFieldPolicy(tier, {
              standardMaterials,
              leanFoliage,
              constrainedMemory,
            });
            if (policy.vista.enabled) expect(policy.sprites).toBe(true);
          }
        }
      }
    }
  });
});

describe('createFarShortfallSampler: session-scoped, never a stale surface', () => {
  // Inside the world on ground with real relief, and deliberately OFF the cell
  // diagonal (tx + tz > 1), so the reconstruction below exercises the second
  // triangle rather than the seam where both halves agree.
  const at = { x: 303, z: 100 };

  it('matches a fresh farVertexRenderY reconstruction over the rendered cell', () => {
    const spacing = 12;
    const seed = 20061;
    const sampler = createFarShortfallSampler(seed, spacing, -1000, -1000);
    const baseY = terrainHeight(at.x, at.z, seed);
    const x0 = -1000 + Math.floor((at.x + 1000) / spacing) * spacing;
    const z0 = -1000 + Math.floor((at.z + 1000) / spacing) * spacing;
    const tx = (at.x - x0) / spacing;
    const tz = (at.z - z0) / spacing;
    expect(tx + tz).toBeGreaterThan(1);
    const h = (x: number, z: number) => farVertexRenderY(x, z, spacing, seed);
    // The anti-diagonal split farGridIndices emits, from the far corner back
    // along its two edges: the surface the GPU actually rasterizes here.
    const h10 = h(x0 + spacing, z0);
    const h01 = h(x0, z0 + spacing);
    const h11 = h(x0 + spacing, z0 + spacing);
    const farY = h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
    // farVertexRenderY already carries FAR_MESH_DROP and the clearance, so
    // there is no second drop to subtract off the reconstructed surface.
    const want = Math.max(0, baseY - farY);
    expect(want).toBeGreaterThan(FAR_MESH_DROP - 1e-9); // guards test vacuity
    expect(sampler.shortfall(at.x, at.z, baseY)).toBeCloseTo(want, 10);
    // and the cached second read is identical
    expect(sampler.shortfall(at.x, at.z, baseY)).toBeCloseTo(want, 10);
  });

  it('two sequential samplers with different SEEDS never share a surface', () => {
    // The regression class: a module-level corner cache keyed by x:z alone
    // served the FIRST world's heights to the second (editor map swap),
    // writing stale sprite sinks. Same query, different seed, different
    // sampler: the heights must come from each sampler's own world.
    const spacing = 12;
    const a = createFarShortfallSampler(20061, spacing, -1000, -1000);
    const b = createFarShortfallSampler(77777, spacing, -1000, -1000);
    // prime a's cache first, then read b at the SAME corners
    const baseA = terrainHeight(at.x, at.z, 20061);
    const baseB = terrainHeight(at.x, at.z, 77777);
    const sa = a.shortfall(at.x, at.z, baseA);
    const sb = b.shortfall(at.x, at.z, baseB);
    const freshB = createFarShortfallSampler(77777, spacing, -1000, -1000).shortfall(
      at.x,
      at.z,
      baseB,
    );
    expect(sb).toBeCloseTo(freshB, 10);
    // and the two worlds genuinely disagree here (guards test vacuity)
    expect(Math.abs(sa - sb)).toBeGreaterThan(1e-6);
  });

  it('two sequential samplers with different SPACINGS never share a surface', () => {
    // Same class, tier-change flavor: high (12) then ultra (10) in one JS
    // context must re-sample the coarser/finer grid, not reuse corners.
    const seed = 20061;
    const baseY = terrainHeight(at.x, at.z, seed) + 5;
    const a = createFarShortfallSampler(seed, 12, -1000, -1000);
    const sa = a.shortfall(at.x, at.z, baseY);
    const b = createFarShortfallSampler(seed, 10, -1000, -1000);
    const sb = b.shortfall(at.x, at.z, baseY);
    const freshB = createFarShortfallSampler(seed, 10, -1000, -1000).shortfall(at.x, at.z, baseY);
    expect(sb).toBeCloseTo(freshB, 10);
    expect(Math.abs(sa - sb)).toBeGreaterThan(1e-9);
  });
});

describe('advanceWithinBudget: bounded time bites with guaranteed progress', () => {
  it('completes when the work finishes inside the budget', () => {
    let steps = 0;
    const done = advanceWithinBudget(
      () => {
        steps++;
        return steps >= 3;
      },
      100,
      () => 0, // the clock never moves: only completion can stop the loop
    );
    expect(done).toBe(true);
    expect(steps).toBe(3);
  });

  it('stops once the clock passes the budget, reporting incomplete', () => {
    let steps = 0;
    let clock = 0;
    const done = advanceWithinBudget(
      () => {
        steps++;
        clock += 4; // each step costs 4ms
        return false;
      },
      10,
      () => clock,
    );
    expect(done).toBe(false);
    // 4ms, 8ms (under 10), then 12ms trips the budget after the third step
    expect(steps).toBe(3);
  });

  it('a zero budget still advances exactly one step: progress NEVER depends on the host granting time', () => {
    // The production law: a saturated main thread (or a scheduler that
    // reports no idle budget at all) must still move the build forward,
    // or the far grid parks behind the idle policy for tens of seconds.
    let steps = 0;
    const done = advanceWithinBudget(
      () => {
        steps++;
        return false;
      },
      0,
      () => 5, // clock already past any budget before the first step
    );
    expect(done).toBe(false);
    expect(steps).toBe(1);
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
