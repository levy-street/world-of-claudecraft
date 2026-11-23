// The faithful world-prop conversion (src/editor/world_prop_conversion.ts):
// every converted placement must draw exactly the model props.ts draws.
// Pinned here:
//  - gamePropPlacement against an INDEPENDENT replay of the game's pipeline
//    (raw GLB bounds from the file, the def's baked yaw, propAsset's recentre,
//    the part and group transforms) versus the placed-asset seating
//    (targetHeightFor normalization, ground - minY * scaleY + y, XYZ rotation),
//    for yawed and off-centre models, nested groups and tilted parts;
//  - the families the editor drew far too large now match the game's sizes;
//  - older documents saved from the first conversion upgrade on load, and only
//    where the maker never touched the placement.
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { newCustomMap } from '../src/editor/custom_map';
import {
  GREAT_TREE_MODEL,
  gamePropPlacement,
  groupMatrix,
  worldMajorPropPlacements,
} from '../src/editor/world_prop_conversion';
import {
  legacyWorldMajorPropPlacements,
  repairLegacyWorldPropFit,
  repairStretchedWorldProps,
} from '../src/editor/world_prop_placements';
import { targetHeightFor } from '../src/render/asset_scale';
import { isEastbrookRebuildBuilding } from '../src/render/eastbrook_town';
import { isFenbridgeRebuildBuilding } from '../src/render/fenbridge_town';
import { isHighwatchRebuildBuilding } from '../src/render/highwatch_town';
import { PROP_ASSET_DEFS, type PropKey } from '../src/render/props';
import { EVERGARDEN_PROPS } from '../src/sim/content/evergarden';
import { NIGHTBLOOM_PROPS } from '../src/sim/content/nightbloom';
import { PALMREACH_PROPS } from '../src/sim/content/palmreach';
import { REALM_PROPS } from '../src/sim/content/realm';
import { WRAITHWOOD_PROPS } from '../src/sim/content/wraithwood';
import { BUILTIN_WORLD } from '../src/sim/data';
import type { MapPlacement } from '../src/sim/map_doc';
import { MUDFIN_HUT_MODELS, MUDFIN_HUTS, mudfinHutAt } from '../src/sim/mudfin_huts';
import { propPlacementRoll } from '../src/sim/prop_layout';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
type Box = { min: number[]; max: number[] };
const BOUNDS = new Map<string, Box>();

async function boundsOf(url: string): Promise<Box> {
  const cached = BOUNDS.get(url);
  if (cached) return cached;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(path.resolve(__dirname, '..', 'public', url.replace(/^\//, '')));
  const box = getBounds(doc.getRoot().listScenes()[0]);
  BOUNDS.set(url, box);
  return box;
}

function corners(box: Box): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/** Where the GAME draws each raw-bounds corner: baked yaw, then the recentre
 *  propAsset applies (footprint centre to the origin, base to y = 0, taken
 *  from the yawed corners themselves), then the part, then the group. */
function gameCorners(
  key: PropKey,
  box: Box,
  parent: THREE.Matrix4,
  part: {
    x?: number;
    y?: number;
    z?: number;
    euler?: THREE.Euler;
    rot?: number;
    scale: number | [number, number, number];
  },
): THREE.Vector3[] {
  const yawed = corners(box).map((c) =>
    c.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), PROP_ASSET_DEFS[key].yaw ?? 0),
  );
  const yb = new THREE.Box3().setFromPoints(yawed);
  const shift = new THREE.Vector3(
    -(yb.min.x + yb.max.x) / 2,
    -yb.min.y,
    -(yb.min.z + yb.max.z) / 2,
  );
  const s = part.scale;
  const holder = new THREE.Matrix4().compose(
    new THREE.Vector3(part.x ?? 0, part.y ?? 0, part.z ?? 0),
    new THREE.Quaternion().setFromEuler(part.euler ?? new THREE.Euler(0, part.rot ?? 0, 0)),
    typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s[0], s[1], s[2]),
  );
  const world = parent.clone().multiply(holder);
  return yawed.map((c) => c.add(shift).applyMatrix4(world));
}

/** Where a PLACEMENT draws each raw-bounds corner (render/placed_assets.ts). */
function placedCorners(p: MapPlacement, box: Box, url: string): THREE.Vector3[] {
  const maxDim = Math.max(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  );
  const s = (targetHeightFor(url) / maxDim) * p.scale;
  const sy = s * (p.scaleY ?? 1);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, terrainHeight(p.x, p.z, SEED) - box.min[1] * sy + (p.y ?? 0), p.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotX ?? 0, p.rotY, p.rotZ ?? 0)),
    new THREE.Vector3(s * (p.scaleX ?? 1), sy, s * (p.scaleZ ?? 1)),
  );
  return corners(box).map((c) => c.applyMatrix4(m));
}

describe('gamePropPlacement', () => {
  const cases: {
    key: PropKey;
    parent: THREE.Matrix4;
    part: Parameters<typeof gameCorners>[3];
  }[] = [
    // a quarter-turn baked yaw with a non-uniform scale (the market stand)
    {
      key: 'stand1',
      parent: groupMatrix(30, 12, -40, 0.7),
      part: { scale: [3.26, 2.48, 2.1], rot: 0.04 },
    },
    // a half-turn baked yaw, tilted group (the tents)
    {
      key: 'tentOpen',
      parent: groupMatrix(5, 3, 8, new THREE.Euler(0.02, 2.1, -0.03)),
      part: { scale: [3.4, 4.5, 3.4] },
    },
    // the most off-centre models (blacksmith, well, ore cart, wall lantern)
    { key: 'blacksmith', parent: groupMatrix(-12, 4, 9, -1.2), part: { scale: [1.9, 2.2, 2.4] } },
    { key: 'well', parent: groupMatrix(1, 2, 3, 0.4), part: { scale: [3.9, 2.9, 2.9] } },
    {
      key: 'cart',
      parent: groupMatrix(0, 1, 0, 2.3),
      part: { x: 2.8, z: 1.6, rot: 0.5, scale: 1.9 },
    },
    {
      key: 'lanternWall',
      parent: groupMatrix(7, 0, 7, -0.6),
      part: { x: 1.45, y: 2, z: 0.28, scale: 1.25 },
    },
    // a part laid on its side inside a turned group (the mine lintel)
    {
      key: 'timberPillar',
      parent: groupMatrix(-3, 5, 2, 1.1),
      part: {
        x: -2.2,
        y: 3.42,
        euler: new THREE.Euler(0, 0, -Math.PI / 2),
        scale: [3.6, 4.4, 3.6],
      },
    },
    // a nested, pitched group (a dock plank section)
    {
      key: 'dockPlatform',
      parent: groupMatrix(10, 1, 10, 0.9).multiply(
        groupMatrix(0, 0.4, -2.2, new THREE.Euler(-0.05, 0, 0)),
      ),
      part: { y: -0.6, scale: [0.78, 0.52, 0.86] },
    },
    // a YXZ-order part (the fallen ruin column)
    {
      key: 'column',
      parent: groupMatrix(4, 2, 4),
      part: {
        x: -1.2,
        y: 0.62,
        z: -2.2,
        scale: 3.2,
        euler: new THREE.Euler(Math.PI / 2 - 0.06, 0.7, 0, 'YXZ'),
      },
    },
  ];

  for (const c of cases) {
    it(`draws ${c.key} where the game draws it`, async () => {
      const url = PROP_ASSET_DEFS[c.key].url;
      const box = await boundsOf(url);
      const p = gamePropPlacement(c.key, c.key, c.parent, c.part, SEED);
      const game = gameCorners(c.key, box, c.parent, c.part);
      const placed = placedCorners(p, box, url);
      // the same eight corners (a baked yaw permutes which is which), to the
      // millimetre the natural-size table is rounded to
      for (const corner of placed) {
        const nearest = Math.min(...game.map((g) => g.distanceTo(corner)));
        expect(nearest, `${c.key} corner ${corner.toArray()}`).toBeLessThan(0.005);
      }
    });
  }
});

describe('the families the editor drew too large', () => {
  const props = BUILTIN_WORLD.props;
  const placements = worldMajorPropPlacements(props, SEED, true);
  const drawn = async (p: MapPlacement) => {
    const url = `/models/${p.assetId}.glb`;
    const box = new THREE.Box3().setFromPoints(placedCorners(p, await boundsOf(url), url));
    return box.getSize(new THREE.Vector3());
  };

  it('stands every mud hut at the game size, not a 12-yard mushroom', async () => {
    const huts = placements.filter((p) => /^Mud hut \d+$/.test(p.name ?? ''));
    expect(huts).toHaveLength(props.mudHuts.length);
    expect(huts.length).toBeGreaterThan(0);
    let mudfinCount = 0;
    for (const [i, hut] of huts.entries()) {
      const [x, z] = props.mudHuts[i];
      // the Mirefen camp's painted mudfin huts: real-size GLBs drawn at scale 1
      const mudfin = mudfinHutAt(x, z);
      if (mudfin) {
        mudfinCount++;
        expect(hut.assetId).toBe(`props/mudfin_hut_${mudfin.model}`);
        expect(huts.some((p) => p.name === `${hut.name} toadstools`)).toBe(false);
        const size = await drawn(hut);
        expect(size.y).toBeCloseTo(MUDFIN_HUT_MODELS[mudfin.model].height, 2);
        // and it walls a Studio playtest exactly where the game's collider does
        expect(hut.collisionMode).toBe('basic');
        expect(hut.collideRadius).toBe(MUDFIN_HUT_MODELS[mudfin.model].radius);
        expect(hut.x).toBeCloseTo(x, 6);
        expect(hut.z).toBeCloseTo(z, 6);
        continue;
      }
      expect(hut.assetId).toBe('props/mushroom_red');
      const box = await boundsOf('/models/props/mushroom_red.glb');
      const rawH = box.max[1] - box.min[1];
      const size = await drawn(hut);
      // props.ts: sy = 10.5 + roll * 3 in the model's own units
      expect(size.y).toBeGreaterThan(rawH * 10.5 * 0.95);
      expect(size.y).toBeLessThan(rawH * (10.5 + propPlacementRoll(x, z, 16) * 3) * 1.15);
      expect(size.y).toBeLessThan(4);
    }
    expect(mudfinCount).toBe(MUDFIN_HUTS.length);
  });

  it('keeps every camp tent within the 3-yard footprint the game gives it', async () => {
    const tents = placements.filter((p) => /^Camp tent \d+$/.test(p.name ?? ''));
    expect(tents).toHaveLength(props.tents.length);
    for (const [i, tent] of tents.entries()) {
      const url = `/models/${tent.assetId}.glb`;
      const box = await boundsOf(url);
      const raw = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
      const s = (targetHeightFor(url) / Math.max(...raw)) * tent.scale;
      // the footprint in the tent's own frame, where props.ts fits it to 3 yards
      const footprint = Math.max(raw[0] * s * (tent.scaleX ?? 1), raw[2] * s * (tent.scaleZ ?? 1));
      expect(footprint).toBeCloseTo(3.0 * props.tents[i].scale, 2);
    }
  });

  it("draws the great trees at the zone modules' scale of the full model", () => {
    const tree = placements.find((p) => p.assetId === 'foliage/twisted_1');
    if (!tree) throw new Error('no great tree converted');
    const record = props.greatTrees?.find((t) => t.x === tree.x && t.z === tree.z);
    if (!record) throw new Error('converted tree has no record');
    const worldScale =
      (targetHeightFor('/models/foliage/twisted_1.glb') / GREAT_TREE_MODEL.maxDim) * tree.scale;
    // every zone module scales the raw model by 2.4 to 3.0 times r, or 6.5 for the realm's
    expect(
      worldScale === 6.5 || (worldScale >= record.r * 2.4 && worldScale <= record.r * 3.0),
    ).toBe(true);
  });

  it('converts only the giants a zone module draws (never the Nightbloom elders)', () => {
    const trees = placements.filter((p) => p.assetId === 'foliage/twisted_1');
    const drawn = [
      REALM_PROPS.greatTrees?.[0],
      ...(PALMREACH_PROPS.greatTrees ?? []),
      ...(EVERGARDEN_PROPS.greatTrees ?? []),
      ...(WRAITHWOOD_PROPS.greatTrees ?? []),
    ].filter((t): t is { x: number; z: number; r: number } => t !== undefined);
    for (const tree of trees) {
      expect(
        drawn.some((t) => t.x === tree.x && t.z === tree.z),
        tree.name,
      ).toBe(true);
    }
    for (const elder of NIGHTBLOOM_PROPS.greatTrees ?? []) {
      expect(trees.some((t) => t.x === elder.x && t.z === elder.z)).toBe(false);
    }
    expect(trees.length).toBeGreaterThan(0);
  });

  it('measures the great-tree model it relies on', async () => {
    const box = await boundsOf('/models/foliage/twisted_1.glb');
    const maxDim = Math.max(
      box.max[0] - box.min[0],
      box.max[1] - box.min[1],
      box.max[2] - box.min[2],
    );
    expect(maxDim).toBeCloseTo(GREAT_TREE_MODEL.maxDim, 2);
    expect(box.min[1]).toBeCloseTo(GREAT_TREE_MODEL.minY, 2);
  });

  it('survives the load-time stretch repair untouched', () => {
    const map = { placements: placements.map((p) => ({ ...p })) };
    repairStretchedWorldProps(map);
    expect(map.placements).toEqual(placements);
  });
});

describe('older documents', () => {
  it('upgrade untouched first-conversion props on load and keep every edit', () => {
    const map = newCustomMap('Older', 'older', 1);
    const legacy = new Map(
      legacyWorldMajorPropPlacements(BUILTIN_WORLD.props, map.meta.seed, true).map((p) => [
        p.name,
        p,
      ]),
    );
    // swap the faithful conversions back to what an older document saved
    map.placements = map.placements.map((p) => {
      const old = p.name ? legacy.get(p.name) : undefined;
      return old ? { ...old } : p;
    });
    const hutIndex = map.placements.findIndex((p) => p.name === 'Mud hut 1');
    const movedIndex = map.placements.findIndex((p) => p.name === 'Mud hut 2');
    expect(hutIndex).toBeGreaterThanOrEqual(0);
    expect(movedIndex).toBeGreaterThanOrEqual(0);
    map.placements[movedIndex] = {
      ...map.placements[movedIndex],
      x: map.placements[movedIndex].x + 3,
    };
    const before = map.placements[movedIndex];

    expect(repairLegacyWorldPropFit(map)).toBeGreaterThan(0);
    const faithful = new Map(
      worldMajorPropPlacements(BUILTIN_WORLD.props, map.meta.seed, true).map((p) => [p.name, p]),
    );
    expect(map.placements[hutIndex]).toEqual(faithful.get('Mud hut 1'));
    // the maker moved this one: it keeps their edit
    expect(map.placements[movedIndex]).toBe(before);
    // the first conversion's phantom Nightbloom giants are gone
    for (const elder of NIGHTBLOOM_PROPS.greatTrees ?? []) {
      expect(
        map.placements.some(
          (p) => p.assetId === 'foliage/twisted_1' && p.x === elder.x && p.z === elder.z,
        ),
      ).toBe(false);
    }
    // and a second load changes nothing more
    expect(repairLegacyWorldPropFit(map)).toBe(0);
  });
});

describe('the authored towns stay their own', () => {
  it('converts no kit stand-in for any rebuilt town building (Highwatch included)', () => {
    // A rebuilt town draws its own painted buildings (the authoredTowns and
    // highwatchTown promotion families); a kit house converted on top of one
    // would stand two buildings in one place, and the record's inn rest area
    // would outlive a moved copy.
    const placements = worldMajorPropPlacements(BUILTIN_WORLD.props, 20061, true);
    const town = BUILTIN_WORLD.props.buildings.filter(
      (b) =>
        isEastbrookRebuildBuilding(b) ||
        isFenbridgeRebuildBuilding(b) ||
        isHighwatchRebuildBuilding(b),
    );
    expect(town.some((b) => isHighwatchRebuildBuilding(b))).toBe(true);
    for (const b of town) {
      const onTop = placements.filter((p) => Math.hypot(p.x - b.x, p.z - b.z) < 0.5);
      expect(onTop, `${b.kind} at (${b.x}, ${b.z})`).toEqual([]);
    }
  });
});
