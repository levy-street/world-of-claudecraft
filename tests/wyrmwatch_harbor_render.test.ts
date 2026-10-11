import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import type * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activateGfxProfile, GFX, type GfxTier, getActiveGfxProfile } from '../src/render/gfx';
import { ditherFadeUniform, setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import {
  buildWyrmwatchHarbor,
  wyrmwatchHarborHouseLights,
  wyrmwatchHarborInternalsForTest,
  wyrmwatchHarborPrewarmParts,
} from '../src/render/wyrmwatch_harbor';
import { wyrmwatchPathStones } from '../src/render/wyrmwatch_harbor_core';
import {
  HARBOR_HOUSE_LIGHTS,
  harborHouseInternalsForTest,
  harborHouseShellMeshes,
  updateHarborHouseShell,
} from '../src/render/wyrmwatch_harbor_house';
import { HOUSE_EYE_OVER_FEET, HOUSE_SHELL_PARTS } from '../src/render/wyrmwatch_harbor_house_core';
import {
  WYRMWATCH_HARBOR_ORIGIN,
  WYRMWATCH_HARBOR_PATH,
  WYRMWATCH_HARBOR_PATH_HALF_WIDTH,
} from '../src/sim/content/wyrmwatch_harbor';
import {
  HARBOR_HOUSE,
  HARBOR_HOUSE_FLOOR_ABOVE_WATER,
  HARBOR_HOUSE_INTERIOR,
  HARBOR_HOUSE_LANTERNS,
} from '../src/sim/content/wyrmwatch_harbor_house';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The Wyrmwatch cliff harbor painter (src/render/wyrmwatch_harbor.ts) over the shipped GLB:
// the model placed on the waterline at the harbor origin, what each graphics tier really
// draws (the walkable structure, solids, the Harbormaster's House and every lantern on all
// of them), the path laid from the three flagstones on every tier, the prewarm parts the
// props warm-up links, and the house's shell cutaway and firelight
// (src/render/wyrmwatch_harbor_house.ts).

const internals = wyrmwatchHarborInternalsForTest;
const GLB = path.join(__dirname, '..', 'public', internals.assetUrl.replace(/^\//, ''));
/** Triangles per part (tests/wyrmwatch_harbor_asset.test.ts pins the same). */
const HOUSE = 1956 + 3288 + 2316 + 1948 + 2212 + 2398 + 3052;
const LOW = 2052 + 1272 + 804 + 1728 + 968 + 1832 + 756 + HOUSE;
const MEDIUM = LOW + 2236;
const HIGH = MEDIUM + 1364 + 840;
const STONE_TRIS = [44, 38, 50];

let gltf: GLTF;
const originalProfile = getActiveGfxProfile();

function withTier(tier: GfxTier): void {
  activateGfxProfile({ ...originalProfile, settings: { ...GFX, effectsTier: tier } });
  internals.setLoadedGltfForTest(gltf);
}

function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

function glowing(root: THREE.Object3D): number {
  const glows = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && (m.emissive?.getHex() ?? 0) !== 0) glows.add(m);
  });
  return glows.size;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(GLB);
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  gltf = await new Promise<GLTF>((resolve, reject) => loader.parse(ab, '', resolve, reject));
});

// The blend arm is what these cases pin; the dithered arm (the default below High since
// release/v0.44.0) has its own case below.
beforeEach(() => setDitherFadeEnabledForTest(false));

afterEach(() => {
  setDitherFadeEnabledForTest(null);
  activateGfxProfile(originalProfile);
});

afterAll(() => {
  internals.setLoadedGltfForTest(null);
});

describe('wyrmwatch harbor painter', () => {
  it('places the model on the waterline at the harbor origin', () => {
    withTier('high');
    const harbor = buildWyrmwatchHarbor(WORLD_SEED);
    const model = harbor.getObjectByName('wyrmwatchHarborModel');
    if (!model) throw new Error('no model');
    expect(model.position.x).toBe(WYRMWATCH_HARBOR_ORIGIN.x);
    expect(model.position.y).toBe(WATER_LEVEL);
    expect(model.position.z).toBe(WYRMWATCH_HARBOR_ORIGIN.z);
    expect(model.userData.assetUrl).toBe(internals.assetUrl);
  });

  it('draws the structure, solids and lanterns on low, adds the trim on medium, the dressing from high', () => {
    for (const [tier, want] of [
      ['low', LOW],
      ['medium', MEDIUM],
      ['high', HIGH],
      ['ultra', HIGH],
      ['insane', HIGH],
    ] as const) {
      withTier(tier);
      const harbor = buildWyrmwatchHarbor(WORLD_SEED);
      const model = harbor.getObjectByName('wyrmwatchHarborModel');
      if (!model) throw new Error('no model');
      expect(triangles(model), tier).toBe(want);
      // the lanterns are landmarks: they glow on every tier (the harbor's glow, and the
      // house walls' own fading clones of it: every wall has a lit window)
      expect(glowing(model), tier).toBe(5);
      // the house's walls and roof stand on every tier, each its own mesh set
      const shell = new Set(harborHouseShellMeshes().map((m) => m.name));
      expect([...shell].sort(), tier).toEqual([...HOUSE_SHELL_PARTS].sort());
    }
  });

  it('lays the same path of flagstones on every tier', () => {
    const stones = wyrmwatchPathStones(
      WYRMWATCH_HARBOR_PATH,
      WYRMWATCH_HARBOR_PATH_HALF_WIDTH,
      (x, z) => terrainHeight(x, z, WORLD_SEED),
    );
    const want = stones.reduce((n, s) => n + STONE_TRIS[s.variant], 0);
    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      withTier(tier);
      const path = buildWyrmwatchHarbor(WORLD_SEED).getObjectByName('wyrmwatchHarborPath');
      if (!path) throw new Error('no path');
      expect(triangles(path), tier).toBe(want);
      // one merged mesh, its bounds hugging the path (a world-band static batch)
      expect(path.children).toHaveLength(1);
      const mesh = path.children[0] as THREE.Mesh;
      expect(mesh.geometry.boundingSphere?.radius ?? Infinity).toBeLessThan(32);
    }
  });

  it('hands the props prewarm every program it draws', () => {
    withTier('high');
    const harbor = buildWyrmwatchHarbor(WORLD_SEED);
    const drawn = new Set<THREE.Material>();
    harbor.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) drawn.add(mesh.material as THREE.Material);
    });
    const warmed = new Set(wyrmwatchHarborPrewarmParts().map((p) => p.material));
    for (const m of drawn) expect(warmed.has(m)).toBe(true);
  });

  it('draws the house walls and roof with their own materials, never the shared ones', () => {
    withTier('high');
    const harbor = buildWyrmwatchHarbor(WORLD_SEED);
    const shell = new Set<THREE.Material>(
      harborHouseShellMeshes().map((m) => m.material as THREE.Material),
    );
    const shellNames = new Set<string>(HOUSE_SHELL_PARTS);
    harbor.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || shellNames.has(mesh.name)) return;
      expect(shell.has(mesh.material as THREE.Material)).toBe(false);
    });
    // one set of materials per part: fading one part never touches another
    const byPart = new Map<string, Set<THREE.Material>>();
    for (const m of harborHouseShellMeshes()) {
      const set = byPart.get(m.name) ?? new Set<THREE.Material>();
      set.add(m.material as THREE.Material);
      byPart.set(m.name, set);
    }
    const all = [...byPart.values()].flatMap((set) => [...set]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('cuts away the wall behind the camera indoors, keeping its shadow, and eases it back', () => {
    withTier('high');
    buildWyrmwatchHarbor(WORLD_SEED);
    const floor = WATER_LEVEL + HARBOR_HOUSE_FLOOR_ABOVE_WATER;
    const ex = (HARBOR_HOUSE_INTERIOR.x0 + HARBOR_HOUSE_INTERIOR.x1) / 2;
    const ez = (HARBOR_HOUSE_INTERIOR.z0 + HARBOR_HOUSE_INTERIOR.z1) / 2;
    const ey = floor + HOUSE_EYE_OVER_FEET;
    // indoors, looking north at the map: the camera stands out past the door wall
    updateHarborHouseShell(ex, ey + 3, ez + 11, ex, ey, ez, 1 / 60);
    const records = harborHouseInternalsForTest.shell();
    const part = (name: string) => {
      const r = records.find((x) => x.part === name);
      if (!r) throw new Error(name);
      return r;
    };
    const south = part('HouseWallSouth');
    expect(south.alpha).toBe(0);
    for (const m of south.meshes) {
      const mat = m.material as THREE.Material;
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBe(0);
      // the room behind it shows, it blends nothing, and the room stays in its shade
      expect(mat.depthWrite).toBe(false);
      expect(mat.colorWrite).toBe(false);
      expect(m.visible).toBe(true);
      expect(m.castShadow).toBe(true);
    }
    for (const name of ['HouseWallNorth', 'HouseWallEast', 'HouseWallWest']) {
      expect(part(name).alpha, name).toBe(1);
      for (const m of part(name).meshes) {
        expect((m.material as THREE.Material).transparent, name).toBe(false);
      }
    }
    // the camera comes back into the room: the wall eases back to its authored state
    for (let i = 0; i < 240; i++) updateHarborHouseShell(ex, ey + 0.5, ez + 2, ex, ey, ez, 1 / 60);
    expect(south.alpha).toBe(1);
    for (const m of south.meshes) {
      const mat = m.material as THREE.Material;
      expect(mat.transparent).toBe(false);
      expect(mat.opacity).toBe(1);
      expect(mat.depthWrite).toBe(true);
      expect(mat.colorWrite).toBe(true);
    }
  });

  it('under the dithered fade, a wall cut away writes depth again once it is back', () => {
    setDitherFadeEnabledForTest(true);
    withTier('high');
    buildWyrmwatchHarbor(WORLD_SEED);
    const floor = WATER_LEVEL + HARBOR_HOUSE_FLOOR_ABOVE_WATER;
    const ex = (HARBOR_HOUSE_INTERIOR.x0 + HARBOR_HOUSE_INTERIOR.x1) / 2;
    const ez = (HARBOR_HOUSE_INTERIOR.z0 + HARBOR_HOUSE_INTERIOR.z1) / 2;
    const ey = floor + HOUSE_EYE_OVER_FEET;
    updateHarborHouseShell(ex, ey + 3, ez + 11, ex, ey, ez, 1 / 60);
    const south = harborHouseInternalsForTest.shell().find((r) => r.part === 'HouseWallSouth');
    if (!south) throw new Error('south');
    expect(south.alpha).toBe(0);
    for (const m of south.meshes) {
      const mat = m.material as THREE.Material;
      // the dithered arm drops every fragment and never flips the material transparent
      expect(ditherFadeUniform(mat)?.value).toBe(0);
      expect(mat.transparent).toBe(false);
      expect(mat.depthWrite).toBe(false);
    }
    for (let i = 0; i < 240; i++) updateHarborHouseShell(ex, ey + 0.5, ez + 2, ex, ey, ez, 1 / 60);
    expect(south.alpha).toBe(1);
    for (const m of south.meshes) {
      const mat = m.material as THREE.Material;
      expect(ditherFadeUniform(mat)?.value).toBe(1);
      // an opaque wall left without depth writes would let the room behind draw over it
      expect(mat.depthWrite).toBe(true);
      expect(mat.colorWrite).toBe(true);
    }
  });

  it('walking out while the wall is cut away turns it into the ghost, drawing again', () => {
    withTier('high');
    buildWyrmwatchHarbor(WORLD_SEED);
    const floor = WATER_LEVEL + HARBOR_HOUSE_FLOOR_ABOVE_WATER;
    const ey = floor + HOUSE_EYE_OVER_FEET;
    const ex = HARBOR_HOUSE.door.x;
    // indoors by the door, the camera out over the house to the north: the north wall is cut
    const inZ = HARBOR_HOUSE.z + HARBOR_HOUSE.hd - 1.5;
    updateHarborHouseShell(ex, ey + 3, inZ - 12, ex, ey, inZ, 1 / 60);
    const north = harborHouseInternalsForTest.shell().find((r) => r.part === 'HouseWallNorth');
    if (!north) throw new Error('north');
    expect(north.alpha).toBe(0);
    // a step out of the door with the camera still behind the house: the whole shell ghosts
    const outZ = HARBOR_HOUSE.z + HARBOR_HOUSE.hd + 2.5;
    updateHarborHouseShell(ex, ey + 3.5, outZ - 13.5, ex, ey, outZ, 1 / 60);
    expect(north.alpha).toBe(OCCLUDER_FADE_ALPHA);
    for (const m of north.meshes) {
      const mat = m.material as THREE.Material;
      expect(mat.opacity).toBeCloseTo(OCCLUDER_FADE_ALPHA, 9);
      expect(mat.depthWrite).toBe(true);
      expect(mat.colorWrite).toBe(true);
    }
  });

  it('stops drawing the shell past the fog, with the rest of the harbor', () => {
    withTier('high');
    const harbor = buildWyrmwatchHarbor(WORLD_SEED);
    const shell = harbor.getObjectByName('harborHouseShell');
    if (!shell) throw new Error('shell');
    const fogFar = 120;
    const ey = WATER_LEVEL + 30;
    updateHarborHouseShell(
      HARBOR_HOUSE.x + 300,
      ey,
      HARBOR_HOUSE.z,
      0,
      ey,
      0,
      1 / 60,
      false,
      fogFar,
    );
    expect(shell.visible).toBe(false);
    updateHarborHouseShell(
      HARBOR_HOUSE.x + 40,
      ey,
      HARBOR_HOUSE.z,
      0,
      ey,
      0,
      1 / 60,
      false,
      fogFar,
    );
    expect(shell.visible).toBe(true);
  });

  it('ghosts the whole shell for a player outside it hides, and only then', () => {
    withTier('high');
    buildWyrmwatchHarbor(WORLD_SEED);
    const floor = WATER_LEVEL + HARBOR_HOUSE_FLOOR_ABOVE_WATER;
    // on the yard, the camera out over the house to the north
    const ex = HARBOR_HOUSE.door.x + 1;
    const ez = HARBOR_HOUSE.z + HARBOR_HOUSE.hd + 2.5;
    const ey = floor + HOUSE_EYE_OVER_FEET;
    updateHarborHouseShell(ex, ey + 3.5, ez - 13.5, ex, ey, ez, 1 / 60);
    for (const r of harborHouseInternalsForTest.shell()) {
      expect(r.alpha, r.part).toBe(OCCLUDER_FADE_ALPHA);
      for (const m of r.meshes) {
        expect((m.material as THREE.Material).depthWrite, r.part).toBe(true);
      }
    }
    // looking at the house from the yard: nothing fades
    buildWyrmwatchHarbor(WORLD_SEED);
    updateHarborHouseShell(ex, ey + 3.5, ez + 12, ex, ey, ez, 1 / 60);
    for (const r of harborHouseInternalsForTest.shell()) expect(r.alpha, r.part).toBe(1);
  });

  it('lights the hearth and the lit lanterns inside the room, for the fire-light budget', () => {
    withTier('high');
    buildWyrmwatchHarbor(WORLD_SEED);
    const lights = wyrmwatchHarborHouseLights();
    expect(lights).toHaveLength(1 + HARBOR_HOUSE_LANTERNS.filter((l) => l.lit).length);
    expect(lights[0].intensity).toBe(HARBOR_HOUSE_LIGHTS.hearth.intensity);
    // the budget's flicker pass drives each fire light round its own base, never its default
    expect(lights[0].userData.baseIntensity).toBe(HARBOR_HOUSE_LIGHTS.hearth.intensity);
    for (const l of lights.slice(1)) {
      expect(l.userData.baseIntensity).toBe(HARBOR_HOUSE_LIGHTS.lantern.intensity);
    }
    const i = HARBOR_HOUSE_INTERIOR;
    for (const l of lights) {
      expect(l.isPointLight).toBe(true);
      expect(l.castShadow).toBe(false);
      expect(l.position.x).toBeGreaterThan(i.x0);
      expect(l.position.x).toBeLessThan(i.x1);
      expect(l.position.z).toBeGreaterThan(i.z0);
      expect(l.position.z).toBeLessThan(i.z1);
    }
  });
});
