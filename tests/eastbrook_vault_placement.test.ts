// The Eastbrook Weekly Vault as a placeable model (public/models/tidehold/vault.glb)
// and its promotion family: a Studio document owns the vault as an ordinary
// placement (select it, move it), and the town-drawn hall and its record
// collider stand down for that document only. Pinned here:
//  - the shipped model is the town-drawn hall's own shape, so the placement the
//    family emits draws it at the hall's size, on the hall's footing;
//  - a fresh world document carries exactly one such placement and the flag;
//  - the record collider stands down under that flag and no other;
//  - the town-drawn hall builds nothing under that flag (the gate lives in
//    eastbrook_weekly_vault.ts so eastbrook_town.ts, a sealed input of the
//    Eastbrook polish provenance, does not move).
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterEach, describe, expect, it } from 'vitest';
import { assetById } from '../src/editor/asset_catalog.generated';
import { newCustomMap } from '../src/editor/custom_map';
import {
  eastbrookVaultPlacements,
  FEATURE_PROMOTIONS,
} from '../src/editor/feature_prop_placements';
import { TARGET_HEIGHT, targetHeightFor } from '../src/render/asset_scale';
import {
  buildEastbrookWeeklyVault,
  WEEKLY_VAULT_TRIANGLES,
} from '../src/render/eastbrook_weekly_vault';
import { collisionOverrideFor } from '../src/sim/asset_collision';
import { promotedTownBuildingStandsDown } from '../src/sim/authored_town_buildings';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT, localToWorld } from '../src/sim/eastbrook_layout';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const DIR = path.resolve(__dirname, '..', 'public', 'models', 'tidehold');
const VAULT = EASTBROOK_LAYOUT.weeklyVault;

async function read(file: string) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.read(path.join(DIR, file));
  const root = document.getRoot();
  const scene = root.listScenes()[0];
  if (!scene) throw new Error(`${file} has no scene`);
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      triangles +=
        (primitive.getIndices()?.getCount() ??
          primitive.getAttribute('POSITION')?.getCount() ??
          0) / 3;
    }
  }
  return {
    bounds: getBounds(scene),
    triangles,
    materials: root.listMaterials().map((m) => m.getName()),
    imageTypes: root.listTextures().map((t) => t.getMimeType()),
  };
}

afterEach(() => setActiveWorldContent(null));

describe('the Weekly Vault model', () => {
  it("is the town-drawn hall's own shape, textured", async () => {
    const vault = await read('vault.glb');
    // the same boxes eastbrook_weekly_vault.ts builds, triangle for triangle
    expect(vault.triangles).toBe(WEEKLY_VAULT_TRIANGLES);
    // 14 x 12 yards on the ground, the door proud of the +Z face
    expect(vault.bounds.min[0]).toBeCloseTo(-VAULT.w / 2, 2);
    expect(vault.bounds.max[0]).toBeCloseTo(VAULT.w / 2, 2);
    expect(vault.bounds.min[2]).toBeGreaterThan(-VAULT.d / 2 - 0.15);
    expect(vault.bounds.min[2]).toBeLessThanOrEqual(-VAULT.d / 2);
    expect(vault.bounds.max[2]).toBeGreaterThanOrEqual(VAULT.d / 2);
    expect(vault.bounds.max[2]).toBeLessThan(VAULT.d / 2 + 0.3);
    expect(vault.imageTypes.length).toBeGreaterThan(0);
    expect(new Set(vault.imageTypes)).toEqual(new Set(['image/ktx2']));
  });

  it('ships a far twin the placed-asset tiers can swap to', async () => {
    const twin = await read('vault.lod.glb');
    expect(twin.triangles).toBeGreaterThan(0);
    expect(twin.triangles).toBeLessThan(200);
    expect(twin.materials).toHaveLength(1);
    const full = await read('vault.glb');
    for (const axis of [0, 2]) {
      expect(twin.bounds.min[axis]).toBeCloseTo(full.bounds.min[axis], 0);
      expect(twin.bounds.max[axis]).toBeCloseTo(full.bounds.max[axis], 0);
    }
  });

  it('is a catalogue asset with a collision decision the size of the hall', () => {
    expect(assetById('tidehold/vault')?.path).toBe('/models/tidehold/vault.glb');
    expect(targetHeightFor('/models/tidehold/vault.glb')).toBe(TARGET_HEIGHT);
    const [placement] = eastbrookVaultPlacements(WORLD_SEED);
    const boxes = collisionOverrideFor('tidehold/vault')?.boxes ?? [];
    expect(boxes).toHaveLength(1);
    // override boxes are in the normalized model's units: times the placement
    // scale they are the hall's footprint in yards
    expect(boxes[0].hx * placement.scale).toBeCloseTo(VAULT.w / 2, 2);
    expect(boxes[0].hz * placement.scale).toBeCloseTo(VAULT.d / 2, 2);
  });
});

describe('the Weekly Vault promotion family', () => {
  it('places the model where the town draws the hall, at its size and on its footing', async () => {
    const placements = eastbrookVaultPlacements(WORLD_SEED);
    expect(placements).toHaveLength(1);
    const [p] = placements;
    expect(p.assetId).toBe('tidehold/vault');
    expect({ x: p.x, z: p.z, rotY: p.rotY }).toEqual({ x: VAULT.x, z: VAULT.z, rotY: VAULT.rot });
    expect(p.collide).toBe(true);
    expect(p.collisionMode).toBe('baked');

    // placed_assets normalizes a model to the target height over its largest
    // dimension and seats its LOWEST point at ground + y, so these two numbers
    // are read off the shipped model, not chosen
    const { bounds } = await read('vault.glb');
    const largest = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    );
    expect(p.scale * TARGET_HEIGHT).toBeCloseTo(largest, 3);
    // the model's ground line is its y = 0: the buried footing is what is below
    const entrance = localToWorld(VAULT, VAULT.rot, 0, VAULT.d / 2);
    const doorGround = terrainHeight(entrance.x, entrance.z, WORLD_SEED);
    const seated = terrainHeight(VAULT.x, VAULT.z, WORLD_SEED) + (p.y ?? 0);
    expect(seated - bounds.min[1]).toBeCloseTo(doorGround, 3);
  });

  it('is part of every new world document, once', () => {
    expect(FEATURE_PROMOTIONS.map((f) => f.flag)).toContain('eastbrookVault');
    const map = newCustomMap('Vault', 'vault', 1);
    expect(map.placements.filter((p) => p.assetId === 'tidehold/vault')).toHaveLength(1);
    expect(map.promotedScenery?.eastbrookVault).toBe(true);
  });
});

describe('the Weekly Vault record collider', () => {
  const record = BUILTIN_WORLD.props.buildings.find((b) => b.id === VAULT.id);
  const rebuild = BUILTIN_WORLD.props.buildings.find(
    (b) =>
      b.x === EASTBROOK_LAYOUT.buildings[0].position.x &&
      b.z === EASTBROOK_LAYOUT.buildings[0].position.z,
  );
  const vaultObb = (seed: number) =>
    colliderInternalsForTest
      .staticWorldColliders(seed)
      .filter(
        (c) =>
          c.type === 'obb' &&
          c.x === VAULT.x &&
          c.z === VAULT.z &&
          c.hw === VAULT.w / 2 &&
          c.hd === VAULT.d / 2,
      );

  it('stands down under its own flag and no other', () => {
    if (!record || !rebuild) throw new Error('the shipped world lost a town record');
    expect(promotedTownBuildingStandsDown(undefined, record)).toBe(false);
    expect(promotedTownBuildingStandsDown({}, record)).toBe(false);
    expect(promotedTownBuildingStandsDown({ eastbrookVault: true }, record)).toBe(true);
    // the two families are independent in both directions
    expect(promotedTownBuildingStandsDown({ authoredTowns: true }, record)).toBe(false);
    expect(promotedTownBuildingStandsDown({ eastbrookVault: true }, rebuild)).toBe(false);
    expect(promotedTownBuildingStandsDown({ authoredTowns: true }, rebuild)).toBe(true);
  });

  it('leaves the shipped world its collider and takes it out of a document that owns the vault', () => {
    expect(vaultObb(WORLD_SEED)).toHaveLength(1);
    setActiveWorldContent({ ...BUILTIN_WORLD, promotedScenery: { authoredTowns: true } });
    expect(vaultObb(WORLD_SEED)).toHaveLength(1);
    setActiveWorldContent({ ...BUILTIN_WORLD, promotedScenery: { eastbrookVault: true } });
    expect(vaultObb(WORLD_SEED)).toHaveLength(0);
  });
});

describe('the town-drawn hall', () => {
  const meshCount = (root: { traverse(fn: (o: { type: string }) => void): void }) => {
    let n = 0;
    root.traverse((o) => {
      if (o.type === 'Mesh') n++;
    });
    return n;
  };

  it('is built for the shipped world and for a document that only promoted the buildings', () => {
    expect(meshCount(buildEastbrookWeeklyVault(() => 0).group)).toBe(8);
    setActiveWorldContent({ ...BUILTIN_WORLD, promotedScenery: { authoredTowns: true } });
    const built = buildEastbrookWeeklyVault(() => 0);
    expect(built.group.name).toBe('eastbrookBuilding:eastbrook_weekly_vault');
    expect(meshCount(built.group)).toBe(8);
    expect(built.hideTarget.mats).toHaveLength(8);
  });

  it('keeps its slot but builds nothing for a document that owns the vault', () => {
    setActiveWorldContent({ ...BUILTIN_WORLD, promotedScenery: { eastbrookVault: true } });
    const stoodDown = buildEastbrookWeeklyVault(() => 0);
    expect(stoodDown.group.name).toBe('eastbrookWeeklyVaultStoodDown');
    expect(meshCount(stoodDown.group)).toBe(0);
    // nothing to fade, and the same footprint the town's lists index by
    expect(stoodDown.hideTarget.mats).toHaveLength(0);
    expect(stoodDown.hideTarget.group).toBe(stoodDown.group);
    expect({ x: stoodDown.hideTarget.x, z: stoodDown.hideTarget.z }).toEqual({
      x: VAULT.x,
      z: VAULT.z,
    });
  });
});
