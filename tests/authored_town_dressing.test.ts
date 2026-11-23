// The authored towns' square dressing as a promotion family
// (promotedScenery.authoredTownDressing): Eastbrook Vale's market stalls,
// benches and yard fences, and Fenbridge's cistern, provision stall, muster
// board and boardwalks become ordinary Studio placements. Pinned here:
//  - the measured model sizes the conversion relies on match the shipped GLBs;
//  - every promoted placement draws the exact box the town view draws
//    (same anchor, same yaw, same width x height x depth, same slope and sink);
//  - new world documents carry the family once, with its flag;
//  - the stall, cistern and fence record colliders stand down under that flag
//    and no other, and the Realm Builder monument's never does;
//  - the town-only models draw in their town's look when placed, and models
//    shared with the wider world do not;
//  - the harbor planks draw on copies of the built-in world, not blank worlds.
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  authoredTownDressingPlacements,
  TOWN_DRESSING_NATURAL,
} from '../src/editor/authored_town_dressing_placements';
import { newCustomMap } from '../src/editor/custom_map';
import { FEATURE_PROMOTIONS, promoteFeatureDressing } from '../src/editor/feature_prop_placements';
import { targetHeightFor } from '../src/render/asset_scale';
import { buildEastbrookHarbor } from '../src/render/eastbrook_harbor';
import { isTownStyledPlacedPath } from '../src/render/town_styled_placed_assets';
import {
  isAuthoredTownDressingFence,
  isAuthoredTownDressingStall,
  isAuthoredTownDressingWell,
  promotedColliderProps,
} from '../src/sim/authored_town_dressing';
import { isBuiltinShapedWorld } from '../src/sim/builtin_shaped_world';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { FENBRIDGE_LAYOUT, localToWorld } from '../src/sim/fenbridge_layout';
import { crossesFence } from '../src/sim/fence_crossing';
import { harborStructureColliders } from '../src/sim/harbor_structures';
import type { MapPlacement } from '../src/sim/map_doc';
import { pitchedSegmentPlacement } from '../src/sim/pitched_segment';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const MODELS = path.resolve(__dirname, '..', 'public', 'models');

afterEach(() => setActiveWorldContent(null));

async function boundsOf(assetId: string) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.read(path.join(MODELS, `${assetId}.glb`));
  const scene = document.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${assetId} has no scene`);
  return getBounds(scene);
}

/** Each model's size read off the shipped GLB itself, independent of the
 *  generator's own table, so drawnBox below is not the generator's formula
 *  checked against itself. */
const MEASURED = new Map<string, { x: number; y: number; z: number }>();
beforeAll(async () => {
  for (const assetId of Object.keys(TOWN_DRESSING_NATURAL)) {
    const { min, max } = await boundsOf(assetId);
    MEASURED.set(assetId, { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] });
  }
});

/** The world-space box a placement draws, the way PlacedAssetsView sizes it:
 *  the model's measured bounds normalized to targetHeightFor / largest
 *  dimension, times the placement's uniform and axis scales. */
function drawnBox(p: MapPlacement) {
  const natural = MEASURED.get(p.assetId);
  if (!natural) throw new Error(`${p.assetId} was not measured`);
  const maxDim = Math.max(natural.x, natural.y, natural.z);
  const s = (targetHeightFor(`/models/${p.assetId}.glb`) / maxDim) * p.scale;
  return {
    x: natural.x * s * (p.scaleX ?? 1),
    y: natural.y * s * (p.scaleY ?? 1),
    z: natural.z * s * (p.scaleZ ?? 1),
  };
}

const placements = authoredTownDressingPlacements(WORLD_SEED);
const byName = (id: string) => {
  const name = id.replace(/_/g, ' ');
  const found = placements.find((p) => p.name?.toLowerCase() === name);
  if (!found) throw new Error(`no promoted placement for ${id}`);
  return found;
};
const ground = (x: number, z: number) => terrainHeight(x, z, WORLD_SEED);

describe('the measured model sizes', () => {
  it('match the shipped GLBs, centred on the origin with the base at y = 0', async () => {
    for (const [assetId, natural] of Object.entries(TOWN_DRESSING_NATURAL)) {
      const { min, max } = await boundsOf(assetId);
      expect(max[0] - min[0], `${assetId} x`).toBeCloseTo(natural.x, 2);
      expect(max[1] - min[1], `${assetId} y`).toBeCloseTo(natural.y, 2);
      expect(max[2] - min[2], `${assetId} z`).toBeCloseTo(natural.z, 2);
      // the placed-asset pivot (the GLB origin) is the town's pivot (the box's
      // base centre), within a centimetre
      expect(Math.abs((min[0] + max[0]) / 2), `${assetId} centre x`).toBeLessThan(0.01);
      expect(Math.abs((min[2] + max[2]) / 2), `${assetId} centre z`).toBeLessThan(0.01);
      expect(Math.abs(min[1]), `${assetId} base`).toBeLessThan(0.01);
    }
  });
});

describe('the promoted placements', () => {
  it('cover every dressing piece of both towns, once', () => {
    const expected =
      EASTBROOK_LAYOUT.civic.benches.length +
      EASTBROOK_LAYOUT.market.stalls.length +
      EASTBROOK_LAYOUT.fences.length +
      3 +
      FENBRIDGE_LAYOUT.repeated.boardwalks.length;
    expect(placements).toHaveLength(expected);
    expect(new Set(placements.map((p) => p.name)).size).toBe(expected);
  });

  it('draw each Eastbrook stall in the box the town draws it, seated on the ground', () => {
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      const p = byName(stall.id);
      expect(p.assetId).toBe('props/eastbrook_market_stall');
      expect({ x: p.x, z: p.z, y: p.y }).toEqual({
        x: stall.position.x,
        z: stall.position.z,
        y: 0,
      });
      expect(p.rotY).toBeCloseTo(stall.rotation, 9);
      const box = drawnBox(p);
      expect(box.x).toBeCloseTo(stall.width, 3);
      expect(box.y).toBeCloseTo(stall.height, 3);
      expect(box.z).toBeCloseTo(stall.depth, 3);
      expect(p.collide).toBe(true);
      expect(p.collisionMode).toBe('baked');
    }
  });

  it('keep each bench in proportion and walk-through, as custom worlds always had it', () => {
    for (const bench of EASTBROOK_LAYOUT.civic.benches) {
      const p = byName(bench.id);
      const natural = TOWN_DRESSING_NATURAL['dungeon/bench'];
      const fit = Math.min(bench.width / natural.x, bench.depth / natural.z);
      const box = drawnBox(p);
      expect(box.x).toBeCloseTo(bench.width, 3);
      expect(box.z).toBeCloseTo(bench.depth, 3);
      expect(box.y).toBeCloseTo(natural.y * fit, 3);
      expect(p.collide).toBe(false);
    }
  });

  it('lay each fence run on the town slope and sink, and keep it a jumpable rail', () => {
    for (const fence of EASTBROOK_LAYOUT.fences) {
      const p = byName(fence.id);
      const fit = pitchedSegmentPlacement(fence.start, fence.end, fence.width, ground);
      expect(p.x).toBeCloseTo(fit.centerX, 9);
      expect(p.z).toBeCloseTo(fit.centerZ, 9);
      // the town stands the rail's base at centerY; a placement seats it at
      // terrain + y
      expect(ground(p.x, p.z) + (p.y ?? 0)).toBeCloseTo(fit.centerY, 9);
      expect(p.rotY).toBeCloseTo(fit.rotation, 9);
      expect(p.rotZ ?? 0).toBeCloseTo(fit.pitch, 9);
      const box = drawnBox(p);
      expect(box.x).toBeCloseTo(fit.spatialLength, 3);
      expect(box.y).toBeCloseTo(fence.height, 3);
      expect(box.z).toBeCloseTo(fence.width, 3);
      expect(p.worldPropKind).toBe('fence');
      // the rail collider spans the drawn run
      expect((p.worldPropWidth ?? 0) * p.scale * (p.scaleX ?? 1)).toBeCloseTo(fit.spatialLength, 6);
      expect((p.worldPropDepth ?? 0) * p.scale * (p.scaleZ ?? 1)).toBeCloseTo(fence.width, 6);
    }
  });

  it("draw Fenbridge's civic pieces and boardwalk planks where the town draws them", () => {
    const { cistern, provisionStall, musterBoard } = FENBRIDGE_LAYOUT.civic;
    const c = byName(cistern.id);
    expect({ x: c.x, z: c.z, rotY: c.rotY }).toEqual({
      x: cistern.position.x,
      z: cistern.position.z,
      rotY: 0,
    });
    expect(drawnBox(c).y).toBeCloseTo(cistern.nativeDimensions.height, 3);
    const s = byName(provisionStall.id);
    expect(s.rotY).toBeCloseTo(provisionStall.rotation, 9);
    expect(drawnBox(s).x).toBeCloseTo(provisionStall.width, 3);
    expect(drawnBox(s).z).toBeCloseTo(provisionStall.depth, 3);
    const b = byName(musterBoard.id);
    expect(drawnBox(b).x).toBeCloseTo(musterBoard.nativeDimensions.width, 3);
    for (const plank of FENBRIDGE_LAYOUT.repeated.boardwalks) {
      const p = byName(plank.id);
      const half = plank.nativeDimensions.width / 2;
      const fit = pitchedSegmentPlacement(
        localToWorld(plank.position, plank.rotation, -half, 0),
        localToWorld(plank.position, plank.rotation, half, 0),
        plank.nativeDimensions.depth,
        ground,
      );
      expect(ground(p.x, p.z) + (p.y ?? 0)).toBeCloseTo(fit.centerY, 9);
      expect(p.rotZ ?? 0).toBeCloseTo(fit.pitch, 9);
      expect(drawnBox(p).x).toBeCloseTo(fit.spatialLength, 3);
      expect(p.collide).toBe(false);
    }
  });

  it('still read as a jumpable rail where the town fence stood', () => {
    const fence = EASTBROOK_LAYOUT.fences[0];
    const mid = { x: (fence.start.x + fence.end.x) / 2, z: (fence.start.z + fence.end.z) / 2 };
    const dx = fence.end.x - fence.start.x;
    const dz = fence.end.z - fence.start.z;
    const len = Math.hypot(dx, dz);
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      // the projection's shape: a placement plus its model path
      placements: [{ ...byName(fence.id), path: '/models/props/fence.glb' }],
      promotedScenery: { authoredTownDressing: true },
    });
    expect(
      crossesFence(mid.x - dz / len, mid.z + dx / len, mid.x + dz / len, mid.z - dx / len, 0.3),
    ).toBe(true);
  });

  it('upgrade an older world document that was saved before the family existed', () => {
    const map = newCustomMap('Older', 'older', 1);
    const isDressing = (p: MapPlacement) =>
      placements.some((d) => d.name === p.name && d.assetId === p.assetId);
    map.placements = map.placements.filter((p) => !isDressing(p));
    if (map.promotedScenery) delete map.promotedScenery.authoredTownDressing;
    expect(promoteFeatureDressing(map)).toBeGreaterThanOrEqual(1);
    expect(map.promotedScenery?.authoredTownDressing).toBe(true);
    expect(map.placements.filter(isDressing)).toHaveLength(placements.length);
    // and once is enough
    const count = map.placements.length;
    promoteFeatureDressing(map);
    expect(map.placements).toHaveLength(count);
  });

  it('are part of every new world document, once, under their flag', () => {
    expect(FEATURE_PROMOTIONS.map((f) => f.flag)).toContain('authoredTownDressing');
    const map = newCustomMap('Dressing', 'dressing', 1);
    expect(map.promotedScenery?.authoredTownDressing).toBe(true);
    const stalls = map.placements.filter((p) => p.assetId === 'props/eastbrook_market_stall');
    expect(stalls).toHaveLength(EASTBROOK_LAYOUT.market.stalls.length);
  });
});

describe('the record colliders', () => {
  const props = BUILTIN_WORLD.props;

  it('leave the built-in props object untouched without a promoted family', () => {
    expect(promotedColliderProps(props, undefined)).toBe(props);
    expect(promotedColliderProps(props, {})).toBe(props);
    // another family (the town buildings) leaves the dressing records alone
    const towns = promotedColliderProps(props, { authoredTowns: true });
    expect(towns.stalls).toBe(props.stalls);
    expect(towns.wells).toBe(props.wells);
    expect(towns.fences).toBe(props.fences);
  });

  it('match records by their stable ids, so a nudged record still stands down', () => {
    const stall = props.stalls.find(isAuthoredTownDressingStall);
    if (!stall) throw new Error('the shipped world lost its market stalls');
    expect(isAuthoredTownDressingStall({ ...stall, x: stall.x + 0.25 })).toBe(true);
    expect(isAuthoredTownDressingStall({ ...stall, id: undefined })).toBe(false);
  });

  it('drop exactly the town dressing records under the flag', () => {
    const stood = promotedColliderProps(props, { authoredTownDressing: true });
    const droppedStalls = props.stalls.filter(isAuthoredTownDressingStall);
    // every Eastbrook market stall plus the Fenbridge provision stall
    expect(droppedStalls).toHaveLength(EASTBROOK_LAYOUT.market.stalls.length + 1);
    expect(stood.stalls).toHaveLength(props.stalls.length - droppedStalls.length);
    expect(props.wells.filter(isAuthoredTownDressingWell)).toHaveLength(1);
    expect(stood.wells).toHaveLength(props.wells.length - 1);
    const droppedFences = props.fences.filter(isAuthoredTownDressingFence);
    expect(droppedFences).toHaveLength(EASTBROOK_LAYOUT.fences.length);
    expect(stood.fences).toHaveLength(props.fences.length - droppedFences.length);
    // the Realm Builder monument (Eastbrook's well record) is never dressing
    const monument = EASTBROOK_LAYOUT.civic.monument;
    expect(
      stood.wells.some((w) => w.x === monument.position.x && w.z === monument.position.z),
    ).toBe(true);
  });

  it('take the stall OBB out of the collision set only for a document that owns the dressing', () => {
    const stall = EASTBROOK_LAYOUT.market.stalls[0];
    const stallObb = () =>
      colliderInternalsForTest
        .staticWorldColliders(WORLD_SEED)
        .filter((c) => c.type === 'obb' && c.x === stall.position.x && c.z === stall.position.z);
    expect(stallObb()).toHaveLength(1);
    setActiveWorldContent({ ...BUILTIN_WORLD, promotedScenery: { authoredTowns: true } });
    expect(stallObb()).toHaveLength(1);
    setActiveWorldContent({ ...BUILTIN_WORLD, promotedScenery: { authoredTownDressing: true } });
    expect(stallObb()).toHaveLength(0);
  });

  it('stop a promoted fence record from counting as a rail crossing', () => {
    const fence = EASTBROOK_LAYOUT.fences[0];
    const mid = { x: (fence.start.x + fence.end.x) / 2, z: (fence.start.z + fence.end.z) / 2 };
    const dx = fence.end.x - fence.start.x;
    const dz = fence.end.z - fence.start.z;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const cross = () => crossesFence(mid.x - nx, mid.z - nz, mid.x + nx, mid.z + nz, 0.3);
    expect(cross()).toBe(true);
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      placements: [],
      promotedScenery: { authoredTownDressing: true },
    });
    expect(cross()).toBe(false);
  });
});

describe('town-styled placements', () => {
  it('restyle only the models no other part of the world uses', () => {
    for (const id of [
      'props/eastbrook_market_stall',
      'props/fenbridge_mirelight_cistern',
      'props/fenbridge_provision_stall',
      'props/fenbridge_muster_board',
      'props/fenbridge_boardwalk',
    ]) {
      expect(isTownStyledPlacedPath(`/models/${id}.glb`), id).toBe(true);
    }
    expect(isTownStyledPlacedPath('/models/props/fence.glb')).toBe(false);
    expect(isTownStyledPlacedPath('/models/dungeon/bench.glb')).toBe(false);
  });
});

describe('the harbor planks', () => {
  const meshes = () => buildEastbrookHarbor(WORLD_SEED).children.length;

  it('draw on the built-in world and on a document copy of it', () => {
    expect(isBuiltinShapedWorld(BUILTIN_WORLD)).toBe(true);
    expect(meshes()).toBeGreaterThan(0);
    const copy = { ...BUILTIN_WORLD, zones: BUILTIN_WORLD.zones.map((z) => ({ ...z })) };
    expect(isBuiltinShapedWorld(copy)).toBe(true);
    setActiveWorldContent(copy);
    expect(meshes()).toBeGreaterThan(0);
  });

  it("bring the built harbors' rails and props back to collision on a copy too", () => {
    const shipped = harborStructureColliders(WORLD_SEED).length;
    expect(shipped).toBeGreaterThan(0);
    setActiveWorldContent({ ...BUILTIN_WORLD, zones: BUILTIN_WORLD.zones.map((z) => ({ ...z })) });
    expect(harborStructureColliders(WORLD_SEED)).toHaveLength(shipped);
    setActiveWorldContent({ ...BUILTIN_WORLD, presentationMode: 'blank' });
    expect(harborStructureColliders(WORLD_SEED)).toHaveLength(0);
  });

  it('stay off blank worlds and worlds with other zones', () => {
    expect(isBuiltinShapedWorld({ ...BUILTIN_WORLD, presentationMode: 'blank' })).toBe(false);
    const fewer = { ...BUILTIN_WORLD, zones: BUILTIN_WORLD.zones.slice(1) };
    expect(isBuiltinShapedWorld(fewer)).toBe(false);
    setActiveWorldContent(fewer);
    expect(meshes()).toBe(0);
  });
});
