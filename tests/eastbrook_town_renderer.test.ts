import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPlacedBuildingAsset } from '../src/render/eastbrook_placed_building';
import {
  EASTBROOK_STALL_ASSET_URL,
  STALL_CANOPY_COLORS,
  STALL_CANOPY_MIN_Y,
  stallCanopyVariant,
} from '../src/render/eastbrook_stall_canopy_core';
import {
  EASTBROOK_TOWN_ASSET_INSTANCE_COUNTS,
  EASTBROOK_TOWN_ASSET_URLS,
  EASTBROOK_TOWN_NEW_ASSET_URLS,
  EASTBROOK_TOWN_ROOT_NAME,
  eastbrookTownDrawStats,
  eastbrookTownInternalsForTest,
  eastbrookTownTriangleBudget,
  isEastbrookRebuildBuilding,
  isEastbrookRebuildFence,
  isEastbrookRebuildStall,
  isEastbrookRebuildWell,
} from '../src/render/eastbrook_town';
import {
  type EastbrookRoofVisibilityTarget,
  eastbrookCameraSegmentHitsRoof,
  eastbrookFogVisible,
  eastbrookRoofVisibilityPlanInto,
  newEastbrookRoofVisibilityPlan,
} from '../src/render/eastbrook_town_visibility_core';
import { gfxInternalsForTest } from '../src/render/gfx';
import { setGpuPrepClockForTest } from '../src/render/gpu_prep_events';
import { interiorCameraInternalsForTest } from '../src/render/interior_camera';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { isOccluderGhostMaterial } from '../src/render/occluder_ghost_variant_key';
import { placedTownCameraInterior } from '../src/render/placed_town_interior_core';
import { createRevealGateCore } from '../src/render/reveal_gate_core';
import { vertexColorEmissiveInternalsForTest } from '../src/render/vertex_color_emissive';
import { BUILDING_TERRAIN_SAMPLE_STEP } from '../src/sim/building_layout';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT, localToWorld } from '../src/sim/eastbrook_layout';
import { terrainHeight } from '../src/sim/world';

// This suite pins the BLENDED camera ghost (the transparent flip and its gate);
// the dithered arm is pinned by tests/occluder_dither_fade.test.ts.
beforeEach(() => setDitherFadeEnabledForTest(false));

let restoreGfx: (() => void) | null = null;

function setStandardMaterials(value: boolean): void {
  restoreGfx?.();
  restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: value });
}

function sourceAsset(withEmissive: boolean): THREE.Group {
  const source = new THREE.Group();
  const opaque = new THREE.MeshStandardMaterial({ color: 0x789abc });
  opaque.name = 'TownOpaque';
  // Round 5: kit fixtures carry a window-assembly component INSIDE the first
  // mesh's geometry, merged into the shell the way the single-mesh hexb GLBs
  // model their windows: a frame box at mid-height on the +z face PLUS a
  // recessed pane box sharing one exact corner vertex (max corner
  // (0.8, 1.5, 2.0)), so the pane detector (kit_window_panes_core.ts, read
  // from the source's first Mesh in buildKitBuilding) finds exactly one
  // window per kit building and emits the pane box's back face (z 1.98) as
  // its recessed glass plane. The template-path fixtures share the shape;
  // their extra 24 triangles ride the opaque merge and stay inside the
  // shell's bounding box.
  // Since the Tidehold rebuild (2026-10) no layout row takes the kit path, so
  // in this suite the assembly only rides the template path's opaque merge
  // (the stall and wall fixtures) and the monument's raw clone; the placed
  // buildings take placedSourceAsset below.
  const shell = withEmissive
    ? mergeGeometries(
        [
          new THREE.BoxGeometry(2, 3, 4),
          new THREE.BoxGeometry(0.4, 0.6, 0.08).translate(0.6, 1.2, 1.96),
          new THREE.BoxGeometry(0.2, 0.3, 0.02).translate(0.7, 1.35, 1.99),
        ],
        false,
      )
    : new THREE.BoxGeometry(2, 3, 4);
  if (!shell) throw new Error('failed to merge the kit fixture shell');
  if (withEmissive) {
    // The shipped kit GLBs decode their meshopt streams into INTERLEAVED
    // position attributes (stride 4 with a pad lane). Model that layout in
    // the kit fixture so the pane detector's adapter is exercised against
    // the real runtime shape: reading the shared array as tight per-vertex
    // triples silently found zero windows on every real model (round 4).
    const tight = shell.getAttribute('position');
    const interleavedArray = new Float32Array(tight.count * 4);
    for (let vertex = 0; vertex < tight.count; vertex++) {
      interleavedArray[vertex * 4] = tight.getX(vertex);
      interleavedArray[vertex * 4 + 1] = tight.getY(vertex);
      interleavedArray[vertex * 4 + 2] = tight.getZ(vertex);
    }
    const buffer = new THREE.InterleavedBuffer(interleavedArray, 4);
    shell.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  }
  source.add(new THREE.Mesh(shell, opaque));
  if (withEmissive) {
    const emissive = new THREE.MeshStandardMaterial({
      color: 0xffb45a,
      emissive: 0xff7a20,
    });
    emissive.name = 'TownEmissive';
    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), emissive));
  }
  return source;
}

// Added 2026-10 for the Tidehold rebuild (src/render/eastbrook_placed_building.ts):
// every row of EASTBROOK_LAYOUT.buildings is a PLACED building now, a raw clone
// of a painted model under /models/tidehold/ drawn with its own materials, so
// those URLs take this stand-in instead of the kit and template one above. It
// models what the placed path has to respect:
// - a footing that drops 0.75 below the model's ground line, so the seat rule
//   has a lowest point to rest on the terrain (and a depth that is not the
//   placed scale, so the bounds term is told apart from a constant);
// - a shell that sits off the origin on +X and a porch that reaches past it on
//   -Z, so a clone that was recentred on its footprint or fitted per axis to
//   the wall box measures differently from one stood at its own anchor;
// - two source materials shared the way the shipped models share theirs (the
//   walls on the shell and the porch, the props on the furniture), the walls
//   carrying the model's own colour map;
// - one mesh under a G_INT node, the furniture that never casts a shadow.
const PLACED_FIXTURE_MIN = Object.freeze({ x: -2, y: -0.75, z: -3 });
const PLACED_FIXTURE_MAX = Object.freeze({ x: 4, y: 4.25, z: 2 });
const PLACED_FIXTURE_MESHES = Object.freeze([
  { name: 'shell', material: 'PlacedWalls', castShadow: true },
  { name: 'porch', material: 'PlacedWalls', castShadow: true },
  { name: 'table', material: 'PlacedProps', castShadow: false },
]);
const PLACED_FIXTURE_MESH_NAMES = PLACED_FIXTURE_MESHES.map((mesh) => mesh.name);

function placedSourceAsset(): THREE.Group {
  const source = new THREE.Group();
  const walls = new THREE.MeshStandardMaterial({ color: 0x8899aa, map: new THREE.Texture() });
  walls.name = 'PlacedWalls';
  const shell = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 4).translate(1, 1.75, 0), walls);
  shell.name = 'shell';
  source.add(shell);
  const porch = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 1).translate(0, 0.25, -2.5), walls);
  porch.name = 'porch';
  source.add(porch);
  const interior = new THREE.Group();
  interior.name = 'G_INT_furniture';
  const props = new THREE.MeshStandardMaterial({ color: 0x664422 });
  props.name = 'PlacedProps';
  const table = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), props);
  table.name = 'table';
  interior.add(table);
  source.add(interior);
  return source;
}

// The market stall's flag (scripts/assets/eastbrook_town/shared.js TOWN_PALETTE).
const CLOTH_BLUE = 0x315b9d;
const CLOTH_CREAM = 0xd6c29d;
const CLOTH_RED = 0xaa4c39;

/** A stand-in for the market stall model as the town repaints it: timber
 *  posts, a canopy of three cloth panels in the model's flag colours above the
 *  canopy line, and a cream sack on the counter below it. 2.8 x 2.7 x 2.2, the
 *  layout's own stall size, base on y 0. */
function stallSourceAsset(): THREE.Group {
  const source = new THREE.Group();
  const add = (hex: number, size: [number, number, number], at: [number, number, number]) => {
    const material = new THREE.MeshStandardMaterial({ color: hex });
    material.name = 'TownOpaque';
    source.add(new THREE.Mesh(new THREE.BoxGeometry(...size).translate(...at), material));
  };
  for (const x of [-1.3, 1.3]) add(0x33251c, [0.2, 2.3, 0.2], [x, 1.15, 1]);
  add(0x33251c, [0.2, 2.3, 0.2], [0, 1.15, -1]);
  add(CLOTH_BLUE, [0.8, 0.2, 2.2], [-0.8, 2.6, 0]);
  add(CLOTH_CREAM, [0.8, 0.2, 2.2], [0, 2.6, 0]);
  add(CLOTH_RED, [0.8, 0.2, 2.2], [0.8, 2.6, 0]);
  add(CLOTH_CREAM, [0.4, 0.4, 0.4], [0.5, 1.2, 0.5]);
  return source;
}

/** Whether a working-space colour is the sRGB hex. */
function colorIs(color: THREE.BufferAttribute, index: number, hex: number): boolean {
  const target = new THREE.Color(hex);
  return (
    Math.abs(color.getX(index) - target.r) < 1e-6 &&
    Math.abs(color.getY(index) - target.g) < 1e-6 &&
    Math.abs(color.getZ(index) - target.b) < 1e-6
  );
}

function fixtureSources(): Map<string, THREE.Object3D> {
  return new Map(
    EASTBROOK_TOWN_ASSET_URLS.map((assetUrl) => [
      assetUrl,
      isPlacedBuildingAsset(assetUrl)
        ? placedSourceAsset()
        : sourceAsset(EASTBROOK_TOWN_NEW_ASSET_URLS.includes(assetUrl)),
    ]),
  );
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  return meshesOf(root).flatMap((mesh) =>
    Array.isArray(mesh.material) ? mesh.material : [mesh.material],
  );
}

type PlacedBuilding = (typeof EASTBROOK_LAYOUT.buildings)[number];

/** A world point given in a rectangle's own axes (the layout's yaw rule). */
function pointIn(
  rect: { center: { x: number; z: number }; rotation: number },
  localX: number,
  localZ: number,
): { x: number; z: number } {
  return localToWorld(rect.center, rect.rotation, localX, localZ);
}

/** Whether a world point lies inside a building's wall box. */
function insideWallBox(building: PlacedBuilding, point: { x: number; z: number }): boolean {
  const dx = point.x - building.position.x;
  const dz = point.z - building.position.z;
  const cos = Math.cos(building.rotation);
  const sin = Math.sin(building.rotation);
  return (
    Math.abs(dx * cos - dz * sin) < building.nativeDimensions.width / 2 &&
    Math.abs(dx * sin + dz * cos) < building.nativeDimensions.depth / 2
  );
}

/** The four corners of a building's reach rectangle, each pulled `inset`
 *  yards toward its centre along both of the rectangle's axes. */
function reachCorners(building: PlacedBuilding, inset = 0): { x: number; z: number }[] {
  const { reach } = building;
  return [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].map(([signX, signZ]) =>
    pointIn(reach, signX * (reach.halfWidth - inset), signZ * (reach.halfDepth - inset)),
  );
}

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  setGpuPrepClockForTest(null);
});

const ROTATED_ROOF: EastbrookRoofVisibilityTarget = {
  x: 10,
  z: -4,
  halfWidth: 2,
  halfDepth: 4,
  cosine: Math.cos(Math.PI / 2),
  sine: Math.sin(Math.PI / 2),
  topY: 8,
  cullRadius: Math.hypot(2, 4),
};

describe('Eastbrook town visibility core', () => {
  it('uses the fog range plus target radius and excludes the exact outer boundary', () => {
    expect(eastbrookFogVisible(10, -4, 10, -4, 100, 30)).toBe(true);
    expect(eastbrookFogVisible(139.999, -4, 10, -4, 100, 30)).toBe(true);
    expect(eastbrookFogVisible(140, -4, 10, -4, 100, 30)).toBe(false);
  });

  it('detects a below-roof camera segment through a rotated footprint', () => {
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 4, 2, -4, 16, 2, -4)).toBe(true);
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 4, 9, -4, 16, 9, -4)).toBe(false);
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 4, 2, 0, 16, 2, 0)).toBe(false);
  });

  it('treats either below-roof endpoint inside the footprint as an intersection', () => {
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 10, 2, -4, 30, 2, -4)).toBe(true);
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 30, 2, -4, 10, 2, -4)).toBe(true);
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 10, 8, -4, 30, 8, -4)).toBe(false);
  });

  it('writes fog, roof-hide, and state-transition decisions into one reusable plan', () => {
    const plan = newEastbrookRoofVisibilityPlan();

    expect(
      eastbrookRoofVisibilityPlanInto(plan, ROTATED_ROOF, true, 1000, 2, -4, 4, 2, -4, 100),
    ).toBe(plan);
    expect(plan).toEqual({ visible: false, hidden: true, hiddenChanged: false });

    eastbrookRoofVisibilityPlanInto(plan, ROTATED_ROOF, false, 16, 2, -4, 4, 2, -4, 100);
    expect(plan).toEqual({ visible: true, hidden: true, hiddenChanged: true });

    eastbrookRoofVisibilityPlanInto(plan, ROTATED_ROOF, true, 16, 2, -4, 4, 2, -4, 100);
    expect(plan).toEqual({ visible: true, hidden: true, hiddenChanged: false });

    eastbrookRoofVisibilityPlanInto(plan, ROTATED_ROOF, true, 16, 9, -4, 4, 9, -4, 100);
    expect(plan).toEqual({ visible: true, hidden: false, hiddenChanged: true });
  });
});

describe('Eastbrook town renderer', () => {
  it('re-indexes exact generated surface tuples without changing triangle count', () => {
    const template = eastbrookTownInternalsForTest.extractTemplate(
      sourceAsset(false),
      EASTBROOK_TOWN_ASSET_URLS[0],
    );
    const opaque = template.opaque;
    expect(opaque).not.toBeNull();
    expect(opaque?.getIndex()?.count).toBe(36);
    expect(opaque?.getAttribute('position').count).toBe(24);
  });

  it('places the exact canonical buildings and initialization-batches every low prop and wall chord', () => {
    const sources = fixtureSources();
    const view = eastbrookTownInternalsForTest.buildFromSources(sources, () => 1.5, true);
    expect(view.group.name).toBe(EASTBROOK_TOWN_ROOT_NAME);
    expect(view.group.userData.newAssetUrls).toEqual(EASTBROOK_TOWN_NEW_ASSET_URLS);
    expect(view.group.userData.assetUrls).toEqual(EASTBROOK_TOWN_ASSET_URLS);

    // Re-staged 2026-10 for the Tidehold rebuild: six placed buildings replaced
    // the eleven kit shells (src/render/eastbrook_placed_building.ts), and no
    // layout row reaches the kit path (buildKitBuilding) or the shape path
    // (buildBuilding) any more. Each fact the kit branch pinned has its placed
    // counterpart below: the group stands at the model's own ANCHOR at the
    // placed turn (never recentred on the wall box), at ONE uniform scale
    // (never fitted per axis to nativeDimensions), seated by the model's own
    // lowest point plus the authored lift (never at the entrance grade), with
    // its own cloned materials, no merged eastbrookBuildingOpaque mesh, no
    // window-pane mesh under the shape-path emissive name, and no foundation
    // skirt. Furniture under a G_INT node is the one thing that casts no
    // shadow. The builder itself is measured in
    // tests/eastbrook_placed_buildings.test.ts; this pins that the TOWN routes
    // every row through it.
    expect(EASTBROOK_LAYOUT.buildings).toHaveLength(6);
    const placedMaterials: THREE.Material[] = [];
    for (const building of EASTBROOK_LAYOUT.buildings) {
      expect(isPlacedBuildingAsset(building.assetId), building.id).toBe(true);
      const { placement } = building;
      const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
      expect(group, building.id).toBeInstanceOf(THREE.Group);
      if (!(group instanceof THREE.Group)) throw new Error(`missing group for ${building.id}`);
      expect(group.position.x, `${building.id} anchor x`).toBe(placement.x);
      expect(group.position.z, `${building.id} anchor z`).toBe(placement.z);
      expect(group.position.y, `${building.id} seat`).toBeCloseTo(
        1.5 - PLACED_FIXTURE_MIN.y * placement.scale + placement.lift,
        10,
      );
      expect(group.rotation.y, `${building.id} turn`).toBe(placement.rotation);
      expect(group.userData.assetUrl).toBe(building.assetId);
      expect(group.userData.target).toBe(building.nativeDimensions);
      expect(group.userData.front).toBe(building.frontStandingPoint);
      expect(group.userData.placement).toBe(placement);
      expect(group.userData.foundationDepth, `${building.id} skirt depth`).toBe(0);
      expect(group.getObjectByName(`eastbrookBuildingOpaque:${building.id}`)).toBeUndefined();
      expect(group.getObjectByName(`eastbrookBuildingEmissive:${building.id}`)).toBeUndefined();

      // One wrap carrying the uniform scale, one clone inside it, nothing else:
      // a skirt would be a second child of the group, a pane mesh a second
      // child of the wrap.
      expect(group.children, `${building.id} group children`).toHaveLength(1);
      const wrap = group.children[0];
      expect(wrap, building.id).toBeInstanceOf(THREE.Group);
      expect(wrap.scale.toArray(), `${building.id} uniform scale`).toEqual([
        placement.scale,
        placement.scale,
        placement.scale,
      ]);
      expect(wrap.position.toArray(), `${building.id} wrap offset`).toEqual([0, 0, 0]);
      expect(wrap.children, `${building.id} wrap children`).toHaveLength(1);
      // The model is not recentred: its origin IS the anchor.
      expect(wrap.children[0].position.toArray(), `${building.id} clone offset`).toEqual([0, 0, 0]);
      // Measured on a parentless clone so the wrap's local transform is the
      // whole matrixWorld chain (this headless build never composes the live
      // group's world matrices): the model's own bounds at the placed scale on
      // every axis, off-centre on X and footing below the wrap's y 0, where a
      // kit shell measured exactly nativeDimensions, centred, resting on y 0.
      const bounds = new THREE.Box3().setFromObject(wrap.clone(true));
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(bounds.min[axis], `${building.id} min ${axis}`).toBeCloseTo(
          PLACED_FIXTURE_MIN[axis] * placement.scale,
          5,
        );
        expect(bounds.max[axis], `${building.id} max ${axis}`).toBeCloseTo(
          PLACED_FIXTURE_MAX[axis] * placement.scale,
          5,
        );
      }

      // Exactly the model's own meshes, each on its own clone of the source
      // material (the shell and the porch share ONE material in the source and
      // may not share one here, or a fade would write both through one record).
      const source = sources.get(building.assetId);
      if (!source) throw new Error(`missing fixture source for ${building.id}`);
      const sourceMaterials = new Set(materialsOf(source));
      expect(sourceMaterials.size).toBe(2);
      const meshes = meshesOf(group);
      expect(
        meshes.map((mesh) => mesh.name),
        building.id,
      ).toEqual(PLACED_FIXTURE_MESH_NAMES);
      meshes.forEach((mesh, index) => {
        const expected = PLACED_FIXTURE_MESHES[index];
        const label = `${building.id} ${mesh.name}`;
        expect(Array.isArray(mesh.material), label).toBe(false);
        const material = mesh.material as THREE.Material;
        expect(material.name, label).toBe(expected.material);
        expect(sourceMaterials.has(material), `${label} is a clone`).toBe(false);
        // The mark occluderFadeMat leaves on a material it minted a camera-fade
        // record for: one record per material and mesh shape, so the ghost
        // covers the whole building (the fade itself is driven below).
        expect(isOccluderGhostMaterial(material), `${label} fade record`).toBe(true);
        expect(mesh.castShadow, `${label} casts`).toBe(expected.castShadow);
        expect(mesh.receiveShadow, `${label} receives`).toBe(true);
        placedMaterials.push(material);
      });
      // The source stays untouched: it is the immutable loader-cache scene.
      for (const material of sourceMaterials) expect(isOccluderGhostMaterial(material)).toBe(false);
    }
    // No material is shared inside a building or across buildings.
    expect(new Set(placedMaterials).size).toBe(18);

    expect(view.group.getObjectByName('eastbrookTownMicroOpaqueBatch')).toBeInstanceOf(THREE.Mesh);
    expect(view.group.getObjectByName('eastbrookTownMicroEmissiveBatch')).toBeInstanceOf(
      THREE.Mesh,
    );
    const wallBatches = meshesOf(view.group).filter(
      (mesh) => mesh.userData.eastbrookWallInstances,
    ) as THREE.InstancedMesh[];
    // Re-pinned 2026-08 for the Eastbrook harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): layout v3 deliberately
    // retired the ring wall (WALL_SEGMENTS and WALL_GATES are empty while the
    // batching machinery stays), so zero wall batches and zero gates are the
    // authored state.
    expect(wallBatches).toHaveLength(0);
    expect(wallBatches.every((mesh) => mesh instanceof THREE.InstancedMesh)).toBe(true);
    expect(wallBatches.filter((mesh) => mesh.userData.handedness === 'mirrored')).toHaveLength(0);
    expect(wallBatches.filter((mesh) => mesh.userData.handedness === 'original')).toHaveLength(0);
    expect(
      wallBatches
        .filter((mesh) => !mesh.name.includes('Emissive'))
        .reduce((sum, mesh) => sum + mesh.count, 0),
    ).toBe(EASTBROOK_LAYOUT.wall.segments.length);
    expect(view.group.userData.wallSegmentCount).toBe(EASTBROOK_LAYOUT.wall.segments.length);
    expect(view.group.userData.gateCount).toBe(0);
    expect(view.group.userData.roofHideTargetCount).toBe(EASTBROOK_LAYOUT.buildings.length + 1);
    expect(view.group.userData.microPlacementIds).toEqual([
      EASTBROOK_LAYOUT.civic.monument.id,
      ...EASTBROOK_LAYOUT.civic.benches.map((bench) => bench.id),
      ...EASTBROOK_LAYOUT.market.stalls.map((stall) => stall.id),
      ...EASTBROOK_LAYOUT.fences.map((fence) => fence.id),
      ...EASTBROOK_LAYOUT.wall.segments.map((segment) => segment.id),
    ]);
    expect(view.group.userData.microPlacementIds).not.toContain('eastbrook_market_stall_artisans');
    // Draw stats re-pinned 2026-08 for the KTX2 kit-building path, then for
    // owner refinement round 4 (nine buildings, kit windows derived from the
    // models' own window assemblies): the eight kit instances' raw clones
    // cast shadows from EVERY cloned mesh, so the two-mesh fixtures give 16
    // kit shadow draws plus the chapel opaque and the micro opaque batch
    // (18); colorDraws is 28 (16 kit clone materials + 8 window-pane meshes,
    // one detected assembly per kit fixture, which never cast + the chapel
    // opaque+emissive pair + the 2 micro batches). Re-pinned again for round
    // 6: the town gained the harbour quarter's three coastal buildings, so the
    // ten kit instances give 20 kit shadow draws plus the chapel opaque and
    // the micro opaque batch (22), and colorDraws is 34 (20 kit clone
    // materials + 10 window panes + the chapel pair + the 2 micro batches).
    // Round 6b (owner) re-shelled the chapel onto the KayKit church, so it
    // leaves the template pipeline and joins the kit path: all ELEVEN lots are
    // kit instances now. The chapel's single opaque template mesh plus its
    // emissive mesh become two clone materials plus one window pane, so
    // colorDraws goes 34 to 35 (22 clone materials + 11 window panes + the 2
    // micro batches) and shadowDraws 22 to 23 (the 22 clones + the micro
    // opaque batch). The panes still never cast.
    // Round 8: the Realm Builder monument left the merged micro-batch and now
    // draws as its own textured prop, so its meshes are counted individually.
    // These are the FIXTURE's numbers: fixtureSources supplies a two-mesh
    // stand-in for it, hence +2 colour and +2 shadow. The shipping asset splits
    // three ways (surface, gold tools, flame cores) and its flame cores never
    // cast, so in game it is +3 colour and +2 shadow.
    // Re-pinned 2026-10 for the Tidehold rebuild: six placed buildings replaced
    // the eleven kit shells (src/render/eastbrook_placed_building.ts). A placed
    // building draws its model's own meshes and nothing else, so the 22 kit
    // clone materials and 11 window panes (33 colour draws) become the six
    // three-mesh fixtures (18): colorDraws 45 to 30 (18 placed + the 2 micro
    // batches + the monument's 2 + the Weekly Vault's 8). The furniture mesh
    // under each fixture's G_INT node casts no shadow, so the 22 kit shadow
    // draws become 12 and shadowDraws goes 33 to 23 (12 placed + the micro
    // opaque batch + the monument's 2 + the vault's 8). Buildings and roof-hide
    // targets are the six rows plus the vault: 12 to 7. These are the FIXTURE's
    // numbers; the shipped models draw their own mesh counts.
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({
      colorDraws: 30,
      shadowDraws: 23,
      buildingCount: 7,
      roofHideTargetCount: 7,
      microBatchCount: 2,
      wallBatchCount: 0,
      wallSegmentCount: 0,
      gateCount: 0,
    });
  });

  it("draws each market stall's canopy in its own layout colour, never the model's flag", () => {
    const sources = fixtureSources();
    sources.set(EASTBROOK_STALL_ASSET_URL, stallSourceAsset());
    const ground = 1.5;
    const view = eastbrookTownInternalsForTest.buildFromSources(sources, () => ground, true);
    const batch = view.group.getObjectByName('eastbrookTownMicroOpaqueBatch');
    if (!(batch instanceof THREE.Mesh)) throw new Error('no micro opaque batch');
    // The repaint is vertex data only: the batch keeps the attribute set the
    // town material's program was linked for (an alpha lane or a new attribute
    // would relink the whole batch).
    expect(Object.keys(batch.geometry.attributes).sort()).toEqual([
      'color',
      'normal',
      'position',
      'uv',
    ]);
    const position = batch.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = batch.geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(color.itemSize).toBe(3);
    // No flag colour survives anywhere in the batch: blue and red were canopy only.
    for (let index = 0; index < color.count; index++) {
      expect(colorIs(color, index, CLOTH_BLUE), `vertex ${index}`).toBe(false);
      expect(colorIs(color, index, CLOTH_RED), `vertex ${index}`).toBe(false);
    }
    const variants = EASTBROOK_LAYOUT.market.stalls.map((stall) =>
      stallCanopyVariant(stall.canopyVariant),
    );
    expect(new Set(variants).size).toBe(2);
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      const own = stallCanopyVariant(stall.canopyVariant);
      const counts: Record<string, number> = { gold: 0, green: 0, cream: 0 };
      for (let index = 0; index < position.count; index++) {
        const dx = position.getX(index) - stall.position.x;
        const dz = position.getZ(index) - stall.position.z;
        if (Math.hypot(dx, dz) > 2) continue;
        const height = position.getY(index) - ground;
        for (const variant of ['gold', 'green'] as const) {
          if (!colorIs(color, index, STALL_CANOPY_COLORS[variant])) continue;
          counts[variant]++;
          expect(height, `${stall.id} canopy height`).toBeGreaterThanOrEqual(STALL_CANOPY_MIN_Y);
        }
        if (colorIs(color, index, CLOTH_CREAM)) {
          // The sack on the counter keeps its cream; the cream panel does not.
          counts.cream++;
          expect(height, `${stall.id} cream height`).toBeLessThan(STALL_CANOPY_MIN_Y);
        }
      }
      // Three panels of 24 corners, minus the corners two adjacent panels now
      // share (same place, normal, colour and cell), all in the stall's own colour.
      expect(counts[own], stall.id).toBeGreaterThan(24);
      expect(counts[own === 'gold' ? 'green' : 'gold'], stall.id).toBe(0);
      expect(counts.cream, stall.id).toBe(24);
    }
  });

  it('seats every placed building on the real terrain under its own anchor, footing buried, with no skirt', () => {
    // Re-staged 2026-10 for the Tidehold rebuild: six placed buildings replaced
    // the eleven kit shells (src/render/eastbrook_placed_building.ts). A kit
    // shell or a shape building seated at its ENTRANCE grade and closed the gap
    // to the lowest ground under its wall box with a 12-triangle foundation
    // skirt. A placed building rests its model's own lowest point on the
    // terrain under its own ORIGIN, then sinks by the authored lift, so the
    // model's footing does the skirt's job and no skirt is ever drawn. Both
    // halves of the old pin have a counterpart here: the seat on the real
    // terrain, and the foundation that may not float.
    const seed = 20_061;
    const ground = (x: number, z: number) => terrainHeight(x, z, seed);
    // A bare slope with no level pad under it: every lot drops across its own
    // wall box, which is exactly where the kit and shape paths grew a skirt.
    // (Tilted the other way along z for the World of ClaudeCraft Studio map's
    // arrangement: the smithy, the inn and the quay cottage turned so their
    // depth ran almost level along the old tilt.)
    const slope = (x: number, z: number) => 0.05 * x + 0.03 * z;
    const stagings = [
      {
        label: 'real terrain',
        groundAt: ground,
        view: eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), ground, true),
      },
      {
        label: 'bare slope',
        groundAt: slope,
        view: eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), slope, true),
      },
    ];

    const realSeats: number[] = [];
    for (const building of EASTBROOK_LAYOUT.buildings) {
      const { placement, reach } = building;
      for (const { label, groundAt, view } of stagings) {
        const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
        if (!group) throw new Error(`missing rendered building ${building.id} on ${label}`);
        const anchorY = groundAt(placement.x, placement.z);
        expect(group.position.y, `${building.id} seat on ${label}`).toBeCloseTo(
          anchorY - PLACED_FIXTURE_MIN.y * placement.scale + placement.lift,
          10,
        );
        // The model's lowest point: on the terrain under the anchor, sunk by
        // the lift, whatever the model's own footing depth is.
        const footingBottom = group.position.y + PLACED_FIXTURE_MIN.y * placement.scale;
        expect(footingBottom, `${building.id} footing on ${label}`).toBeCloseTo(
          anchorY + placement.lift,
          10,
        );
        expect(placement.lift, `${building.id} lift buries the footing`).toBeLessThan(0);

        // No skirt depth is reported and no skirt is drawn: the group holds the
        // model's own meshes inside its wrap and nothing beside it.
        expect(group.userData.foundationDepth, `${building.id} skirt depth on ${label}`).toBe(0);
        const meshes = meshesOf(group);
        expect(
          meshes.map((mesh) => mesh.name),
          `${building.id} meshes on ${label}`,
        ).toEqual(PLACED_FIXTURE_MESH_NAMES);
        expect(
          meshes.filter((mesh) => (mesh.material as THREE.Material).name.includes('Skirt')),
          `${building.id} skirt on ${label}`,
        ).toHaveLength(0);
        expect(
          group.children.filter((child) => child instanceof THREE.Mesh),
          `${building.id} loose mesh on ${label}`,
        ).toHaveLength(0);

        const { width, depth } = building.nativeDimensions;
        const entrance = localToWorld(building.position, building.rotation, 0, depth / 2);
        if (groundAt === slope) {
          // The staging is not vacuous: under the old seat rule this lot WOULD
          // have grown a skirt (its entrance stands above the lowest corner of
          // its wall box) and would have seated off the anchor's own height.
          let lowestCorner = Infinity;
          for (const [signX, signZ] of [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ]) {
            const corner = localToWorld(
              building.position,
              building.rotation,
              (signX * width) / 2,
              (signZ * depth) / 2,
            );
            lowestCorner = Math.min(lowestCorner, groundAt(corner.x, corner.z));
          }
          const entranceY = groundAt(entrance.x, entrance.z);
          expect(entranceY - lowestCorner, `${building.id} slope drop`).toBeGreaterThan(0.1);
          expect(Math.abs(entranceY - anchorY), `${building.id} slope seat`).toBeGreaterThan(0.1);
          continue;
        }

        // The real terrain: the buried footing never floats anywhere under the
        // model, sampled across its whole reach (porch, stair and eaves
        // included) on the building-terrain sample step, where the old pin
        // sampled the wall box under a skirt.
        realSeats.push(anchorY);
        const xSteps = Math.max(1, Math.ceil((reach.halfWidth * 2) / BUILDING_TERRAIN_SAMPLE_STEP));
        const zSteps = Math.max(1, Math.ceil((reach.halfDepth * 2) / BUILDING_TERRAIN_SAMPLE_STEP));
        let lowest = { x: 0, z: 0, ground: Infinity };
        let samples = 0;
        for (let zIndex = 0; zIndex <= zSteps; zIndex++) {
          const localZ = -reach.halfDepth + (reach.halfDepth * 2 * zIndex) / zSteps;
          for (let xIndex = 0; xIndex <= xSteps; xIndex++) {
            const localX = -reach.halfWidth + (reach.halfWidth * 2 * xIndex) / xSteps;
            const point = pointIn(reach, localX, localZ);
            const sampleGround = ground(point.x, point.z);
            if (sampleGround < lowest.ground) lowest = { ...point, ground: sampleGround };
            samples++;
          }
        }
        expect(samples, `${building.id} reach samples`).toBeGreaterThan(1000);
        expect(
          footingBottom,
          `${building.id} footing floats at ${lowest.x},${lowest.z}`,
        ).toBeLessThanOrEqual(lowest.ground + 1e-8);
      }
    }
    // The real-terrain branch is real: the six lots do not share one height, so
    // a seat that ignored the terrain under each anchor could not pass above.
    expect(realSeats).toHaveLength(6);
    expect(new Set(realSeats.map((seat) => seat.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('holds the buildings with the static batches on a walking approach until the gate settles', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    view.setRevealGate(gate);
    const buildingGroups = EASTBROOK_LAYOUT.buildings.map((building) => {
      const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
      if (!group) throw new Error(`renderer fixture lost ${building.id}`);
      return group;
    });
    const micro = view.group.getObjectByName('eastbrookTownMicroOpaqueBatch');
    if (!micro) throw new Error('renderer fixture lost the micro batch');
    // The gate compiles the buildings WITH the batches: every building group
    // is a reveal root, so its unshared materials link before first draw.
    for (const group of buildingGroups) expect(view.staticRevealRoots()).toContain(group);
    expect(view.staticRevealRoots()).toContain(micro);

    // Camera outside the town cull radius, town and buildings inside the fog.
    const cullRadius = eastbrookTownInternalsForTest.townCullRadius;
    const approachX = cullRadius + 20;
    view.update(approachX, 2, 0, approachX - 5, 2, 0, 400, 0.05);
    expect(requested).toEqual(['eastbrook-town-static']);
    expect(micro.visible).toBe(false);
    for (const group of buildingGroups) expect(group.visible).toBe(false);

    // Held frames never re-request; the settle reveals batches and buildings
    // together, and the latch never consults the gate again.
    view.update(approachX, 2, 0, approachX - 5, 2, 0, 400, 0.05);
    expect(requested).toEqual(['eastbrook-town-static']);
    for (const group of buildingGroups) expect(group.visible).toBe(false);
    gate.settle('eastbrook-town-static');
    view.update(approachX, 2, 0, approachX - 5, 2, 0, 400, 0.05);
    expect(micro.visible).toBe(true);
    for (const group of buildingGroups) expect(group.visible).toBe(true);
    view.setRevealGate(createRevealGateCore((key) => requested.push(`again:${key}`)));
    view.update(approachX, 2, 0, approachX - 5, 2, 0, 400, 0.05);
    expect(requested).toEqual(['eastbrook-town-static']);
    for (const group of buildingGroups) expect(group.visible).toBe(true);
  });

  it('reveals each root as its own compile lands, without waiting for the whole town', () => {
    // The town key covers every batch plus every building group. Holding all
    // of them until the slowest link settles turns the settle frame into the
    // one-frame first-draw burst the gate exists to prevent, so a root whose
    // own compile has landed draws while the rest keep waiting.
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const gate = createRevealGateCore((key) => gate.noteRoots(key, view.staticRevealRoots()));
    view.setRevealGate(gate);
    const bank = EASTBROOK_LAYOUT.buildings[0];
    const bankGroup = view.group.getObjectByName(`eastbrookBuilding:${bank.id}`);
    const other = EASTBROOK_LAYOUT.buildings[1];
    const otherGroup = view.group.getObjectByName(`eastbrookBuilding:${other.id}`);
    const micro = view.group.getObjectByName('eastbrookTownMicroOpaqueBatch');
    if (!bankGroup || !otherGroup || !micro) throw new Error('renderer fixture lost a town node');

    const cullRadius = eastbrookTownInternalsForTest.townCullRadius;
    const approachX = cullRadius + 20;
    view.update(approachX, 2, 0, approachX - 5, 2, 0, 400, 0.05);
    expect(bankGroup.visible).toBe(false);

    gate.settleRoot('eastbrook-town-static', bankGroup);
    view.update(approachX, 2, 0, approachX - 5, 2, 0, 400, 0.05);
    expect(gate.state('eastbrook-town-static')).toBe('compiling');
    expect(bankGroup.visible).toBe(true);
    // Nothing else moved: the batches and the other buildings are still cold.
    expect(micro.visible).toBe(false);
    expect(otherGroup.visible).toBe(false);

    // A revealed root is never taken back while the key is still held.
    view.update(approachX, 2, 0, approachX - 5, 2, 0, 400, 0.05);
    expect(bankGroup.visible).toBe(true);
  });

  it('holds the buildings as an IMMINENT key when the camera is already inside', () => {
    // The arrival shape: it used to reveal on the spot without consulting,
    // which linked the whole town kit in the live frames after the jump on a
    // host whose boot manifest never carried it. It consults now, holds, and
    // what standing inside buys is that the compiles go out first.
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const requested: { key: string; imminent: boolean }[] = [];
    view.setRevealGate(createRevealGateCore((key, imminent) => requested.push({ key, imminent })));
    const far = EASTBROOK_LAYOUT.buildings[EASTBROOK_LAYOUT.buildings.length - 1];
    const farGroup = view.group.getObjectByName(`eastbrookBuilding:${far.id}`);
    if (!farGroup) throw new Error('renderer fixture lost the last building');
    // The camera stands at the town centre, far from that building.
    view.update(0, 2, 0, 0, 2, 0, 200, 0.05);
    expect(requested).toEqual([{ key: 'eastbrook-town-static', imminent: true }]);
    expect(farGroup.visible).toBe(false);
    // No clock is threaded anywhere: the hold outlasts any number of frames.
    for (let frame = 0; frame < 200; frame++) {
      view.update(0, 2, 0, 0, 2, 0, 200, 0.05);
    }
    expect(farGroup.visible).toBe(false);
    expect(requested).toHaveLength(1);
  });

  it("shows a building at arm's length on the first held frame, linked or not", () => {
    // The reach floor: the sim colliders of a building the camera is standing
    // in must not sit under something invisible, whatever the driver is doing.
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    view.setRevealGate(createRevealGateCore(() => undefined));
    const bank = EASTBROOK_LAYOUT.buildings[0];
    const bankGroup = view.group.getObjectByName(`eastbrookBuilding:${bank.id}`);
    if (!bankGroup) throw new Error('renderer fixture lost the bank');
    // The floor reads the wall box's own centre, the record the sim collides
    // with. A placed building's group stands at the model's anchor instead, so
    // the camera takes the record's point rather than the group's.
    const { x, z } = bank.position;
    view.update(x, 2, z, x, 2, z + 5, 200, 0.05);
    expect(bankGroup.visible).toBe(true);
    // The town key itself never warmed: this is the floor, not a reveal.
    const micro = view.group.getObjectByName('eastbrookTownMicroOpaqueBatch');
    if (!micro) throw new Error('renderer fixture lost the micro batch');
    expect(micro.visible).toBe(false);
  });

  it('hands the gate its roots nearest to the camera first', () => {
    // The compiles are submitted in the order the roots come back, so an
    // arrival links what it landed among before the far side of the town.
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    let submitted: readonly THREE.Object3D[] = [];
    view.setRevealGate(
      createRevealGateCore(() => {
        submitted = [...view.staticRevealRoots()];
      }),
    );
    const last = EASTBROOK_LAYOUT.buildings[EASTBROOK_LAYOUT.buildings.length - 1];
    const lastGroup = view.group.getObjectByName(`eastbrookBuilding:${last.id}`);
    if (!lastGroup) throw new Error('renderer fixture lost the last building');
    // A building's reveal anchor is its wall box's centre (see the reach floor
    // above), which is where the camera stands.
    const { x, z } = last.position;
    view.update(x, 2, z, x, 2, z + 5, 200, 0.05);
    expect(submitted).toHaveLength(view.staticRevealRoots().length);
    expect(submitted[0]).toBe(lastGroup);
  });

  it('roof-fades only building volumes to 20% and restores them without touching microgeometry', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const bank = EASTBROOK_LAYOUT.buildings[0];
    const bankGroup = view.group.getObjectByName(`eastbrookBuilding:${bank.id}`);
    const micro = view.group.getObjectByName('eastbrookTownMicroOpaqueBatch') as THREE.Mesh;
    if (!bankGroup || !micro) throw new Error('renderer fixture lost Eastbrook scene nodes');
    const bankMaterials = meshesOf(bankGroup).map((mesh) => mesh.material as THREE.Material);
    // Re-pinned 2026-10 for the Tidehold rebuild: the bank is a placed building
    // (src/render/eastbrook_placed_building.ts), so the volume that ghosts is
    // the model's own three meshes on their three cloned materials, furniture
    // included, where a kit shell ghosted its two clones and its pane mesh.
    expect(bankMaterials).toHaveLength(3);
    expect(new Set(bankMaterials).size).toBe(3);
    const authored = bankMaterials.map((material) => ({
      transparent: material.transparent,
      opacity: material.opacity,
      depthWrite: material.depthWrite,
    }));
    const microMaterial = micro.material as THREE.Material;

    // Occlusion snaps to the ghost target on its first positive-dt frame.
    view.update(45, 2, 45, bank.position.x, 2, bank.position.z, 200, 0.05);
    expect(
      bankMaterials.every(
        (material, i) =>
          material.transparent &&
          material.depthWrite &&
          Math.abs(material.opacity - authored[i].opacity * 0.2) < 1e-9,
      ),
    ).toBe(true);
    // Further occluded frames remain at exactly 20% of the authored opacity.
    view.update(45, 2, 45, bank.position.x, 2, bank.position.z, 200, 10);
    expect(
      bankMaterials.every(
        (material, i) => Math.abs(material.opacity - authored[i].opacity * 0.2) < 1e-9,
      ),
    ).toBe(true);
    expect(microMaterial.opacity).toBe(1);
    expect(microMaterial.depthWrite).toBe(true);

    // Over the roof line the segment clears the building. The placed bank
    // stands 27.9 yd above its ground line where the kit shell stood 12.7, so
    // the height is read off the record instead of the old literal 30.
    const overRoof = bank.nativeDimensions.height + 2;
    view.update(45, overRoof, 45, bank.position.x, overRoof, bank.position.z, 200, 10);
    expect(
      bankMaterials.every(
        (material, i) =>
          material.transparent === authored[i].transparent &&
          material.opacity === authored[i].opacity &&
          material.depthWrite === authored[i].depthWrite,
      ),
    ).toBe(true);
    expect(microMaterial.opacity).toBe(1);
  });

  it('ghosts a placed building from inside its wall box under its roof line, never from under its eaves', () => {
    // Added 2026-10 for the Tidehold rebuild (src/render/eastbrook_placed_building.ts):
    // a kit shell was scaled to its wall box, so the box that ghosts it and
    // the shell it drew were one rectangle. A placed model reaches well past
    // its walls (porch, stair, awning, eaves), and the camera-fade box stays
    // the WALL box: the record's footprint, topped at the model's own height
    // above the ground under its anchor. Every probe stands the camera and the
    // eye on one point, so the only way to ghost a building is to be inside
    // its box, and every material of the building must answer together (one
    // fade record per material and mesh shape).
    // Split for the walk-in buildings (eastbrook_layout.ts walkIn): every
    // building but the quay cottage is a room a player walks into, so with
    // the eye inside one it ghosts only once the camera is outside its wall
    // box or over its roof line; eye and camera both inside keep it solid. A
    // camera inside the box with the eye outside still ghosts it. The sealed
    // cottage keeps the rule above unchanged (eastbrook_town_visibility_core.ts).
    expect(
      EASTBROOK_LAYOUT.buildings
        .filter((building) => !building.walkIn)
        .map((building) => building.id),
    ).toEqual(['eastbrook_quay_cottage']);
    const groundY = 1.5;
    const view = eastbrookTownInternalsForTest.buildFromSources(
      fixtureSources(),
      () => groundY,
      true,
    );
    const micro = view.group.getObjectByName('eastbrookTownMicroOpaqueBatch') as THREE.Mesh;
    if (!micro) throw new Error('renderer fixture lost the micro batch');
    const fadeState = (materials: readonly THREE.Material[]): string => {
      if (materials.every((material) => !material.transparent && material.opacity === 1)) {
        return 'solid';
      }
      const ghosted = materials.every(
        (material) =>
          material.transparent && material.depthWrite && Math.abs(material.opacity - 0.2) < 1e-9,
      );
      return ghosted ? 'ghost' : 'mixed';
    };
    const corners = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    for (const building of EASTBROOK_LAYOUT.buildings) {
      const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
      if (!group) throw new Error(`renderer fixture lost ${building.id}`);
      const materials = materialsOf(group);
      expect(materials, building.id).toHaveLength(3);
      const halfWidth = building.nativeDimensions.width / 2;
      const halfDepth = building.nativeDimensions.depth / 2;
      const roofY = groundY + building.nativeDimensions.height;
      const wallBox = { center: building.position, rotation: building.rotation };
      const belowRoof = groundY + 2;
      // Stand well over the roof first (so each probe starts from the authored
      // state), then put the camera and the eye where the probe says.
      const stateWith = (
        camera: { x: number; y: number; z: number },
        eye: { x: number; y: number; z: number },
      ): string => {
        view.update(eye.x, roofY + 20, eye.z, eye.x, roofY + 20, eye.z, 200, 10);
        expect(fadeState(materials), `${building.id} cleared`).toBe('solid');
        view.update(camera.x, camera.y, camera.z, eye.x, eye.y, eye.z, 200, 10);
        return fadeState(materials);
      };
      const stateAt = (point: { x: number; z: number }, y: number): string =>
        stateWith({ x: point.x, y, z: point.z }, { x: point.x, y, z: point.z });

      for (const [signX, signZ] of corners) {
        // A step inside each corner of the wall box: the box is the whole
        // footprint, not a patch around the door. A sealed building ghosts;
        // a walk-in room with the eye and the camera both in it stays solid.
        const inside = pointIn(wallBox, signX * (halfWidth - 0.05), signZ * (halfDepth - 0.05));
        expect(insideWallBox(building, inside)).toBe(true);
        expect(stateAt(inside, belowRoof), `${building.id} inside ${signX},${signZ}`).toBe(
          building.walkIn ? 'solid' : 'ghost',
        );
        if (!building.walkIn) continue;
        // The walk-in room still ghosts when the camera leaves its box with
        // the eye inside, and when the camera backs into it from an eye
        // outside: three yards out past the same corner, under the roof line.
        const outPastCorner = pointIn(wallBox, signX * (halfWidth + 3), signZ * (halfDepth + 3));
        expect(insideWallBox(building, outPastCorner)).toBe(false);
        expect(
          stateWith(
            { x: outPastCorner.x, y: belowRoof, z: outPastCorner.z },
            { x: inside.x, y: belowRoof, z: inside.z },
          ),
          `${building.id} camera out past ${signX},${signZ}`,
        ).toBe('ghost');
        expect(
          stateWith(
            { x: inside.x, y: belowRoof, z: inside.z },
            { x: outPastCorner.x, y: belowRoof, z: outPastCorner.z },
          ),
          `${building.id} camera backed in at ${signX},${signZ}`,
        ).toBe('ghost');
      }
      // A step outside each wall: still under the model's eaves, never a ghost.
      for (const [localX, localZ] of [
        [halfWidth + 0.05, 0],
        [-halfWidth - 0.05, 0],
        [0, halfDepth + 0.05],
        [0, -halfDepth - 0.05],
      ]) {
        const outside = pointIn(wallBox, localX, localZ);
        expect(insideWallBox(building, outside)).toBe(false);
        expect(stateAt(outside, groundY + 2), `${building.id} outside ${localX},${localZ}`).toBe(
          'solid',
        );
      }
      // The four corners of the reach, where the porch, the stair and the
      // eaves end: on the model's ground, outside its walls.
      const underEaves = reachCorners(building, 0.05);
      expect(underEaves).toHaveLength(4);
      for (const point of underEaves) {
        expect(insideWallBox(building, point), `${building.id} reach corner`).toBe(false);
        expect(stateAt(point, groundY + 2), `${building.id} under the eaves`).toBe('solid');
      }
      // The roof line is the model's own top over the ground under its anchor.
      // Eye and camera together just under it: a sealed building ghosts, a
      // walk-in room stays solid. Just over it, neither ghosts.
      expect(stateAt(building.position, roofY - 0.05), `${building.id} under the roof`).toBe(
        building.walkIn ? 'solid' : 'ghost',
      );
      expect(stateAt(building.position, roofY + 0.05), `${building.id} over the roof`).toBe(
        'solid',
      );
      if (building.walkIn) {
        // With the eye in the room, the same roof line decides by the camera:
        // still under it keeps the room solid, over it ghosts the room.
        const eye = { x: building.position.x, y: belowRoof, z: building.position.z };
        expect(
          stateWith({ x: eye.x, y: roofY - 0.05, z: eye.z }, eye),
          `${building.id} camera under the roof`,
        ).toBe('solid');
        expect(
          stateWith({ x: eye.x, y: roofY + 0.05, z: eye.z }, eye),
          `${building.id} camera over the roof`,
        ).toBe('ghost');
      }
      // The merged microgeometry is never a roof-hide target.
      expect((micro.material as THREE.Material).transparent).toBe(false);
      expect((micro.material as THREE.Material).opacity).toBe(1);
    }
  });

  it('keeps a placed building drawn for as long as the fog reaches the far corner of its reach', () => {
    // Added 2026-10 for the Tidehold rebuild (src/render/eastbrook_placed_building.ts):
    // a kit shell culled on its wall box's corner radius (maxCornerRadius),
    // which was the whole shell. A placed model's porch, stair and eaves stand
    // outside that circle, so its fog cull is measured from the record's own
    // centre out to the far corner of the REACH rectangle: culling on the wall
    // box would pop the building out while part of it was still in view.
    const fogFar = 100;
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const micro = view.group.getObjectByName('eastbrookTownMicroOpaqueBatch');
    if (!micro) throw new Error('renderer fixture lost the micro batch');
    for (const building of EASTBROOK_LAYOUT.buildings) {
      const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
      if (!group) throw new Error(`renderer fixture lost ${building.id}`);
      const { position, reach } = building;
      const farCorner = Math.max(
        ...reachCorners(building).map((corner) =>
          Math.hypot(corner.x - position.x, corner.z - position.z),
        ),
      );
      // The reach really does stand outside the wall box's own circle, so the
      // first probe below is one the old radius would have culled.
      expect(farCorner, `${building.id} reach past the walls`).toBeGreaterThan(
        building.maxCornerRadius + 1,
      );
      // No looser than the reach's own centre offset plus its half diagonal.
      const widest =
        Math.hypot(reach.center.x - position.x, reach.center.z - position.z) +
        Math.hypot(reach.halfWidth, reach.halfDepth);
      expect(widest).toBeGreaterThanOrEqual(farCorner);
      // The camera backs away along the line through the world origin, the
      // point the town-wide static cull measures from, so the town stays in
      // the fog and only the building's own cull can hide it.
      const length = Math.hypot(position.x, position.z);
      const standAt = (distance: number): void => {
        const x = position.x - (position.x / length) * distance;
        const z = position.z - (position.z / length) * distance;
        view.update(x, 5, z, x, 5, z, fogFar, 0.05);
      };
      standAt(fogFar + farCorner - 0.01);
      expect(group.visible, `${building.id} far corner still in the fog`).toBe(true);
      standAt(fogFar + widest + 0.01);
      expect(group.visible, `${building.id} past its cull radius`).toBe(false);
      expect(micro.visible, `${building.id} town still in the fog`).toBe(true);
      standAt(fogFar + farCorner - 0.01);
      expect(group.visible, `${building.id} back inside the fog`).toBe(true);
    }
  });

  it('keeps all harbor town buildings and civic batches visible across a 360-degree camera orbit on Low (sceneryFar = 60)', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const micro = view.group.getObjectByName('eastbrookTownMicroOpaqueBatch');
    const vault = view.group.getObjectByName(
      `eastbrookBuilding:${EASTBROOK_LAYOUT.weeklyVault.id}`,
    );
    if (!micro || !vault) throw new Error('renderer fixture lost Eastbrook nodes');
    const buildingGroups = EASTBROOK_LAYOUT.buildings.map((building) => {
      const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
      if (!group) throw new Error(`renderer fixture lost ${building.id}`);
      return group;
    });
    const eyeX = -6;
    const eyeY = 6;
    const eyeZ = -98;
    const orbitRadius = 11.5;
    for (let step = 0; step < 16; step++) {
      const angle = (step / 16) * Math.PI * 2;
      const camX = eyeX + Math.cos(angle) * orbitRadius;
      const camZ = eyeZ + Math.sin(angle) * orbitRadius;
      view.update(camX, eyeY + 4, camZ, eyeX, eyeY, eyeZ, 60, 0.05);
      expect(micro.visible).toBe(true);
      expect(vault.visible).toBe(true);
      for (const group of buildingGroups) expect(group.visible).toBe(true);
    }
  });

  it('uses Lambert vertex-color materials on Low without changing geometry or draw counts', () => {
    setStandardMaterials(false);
    const sources = fixtureSources();
    const view = eastbrookTownInternalsForTest.buildFromSources(sources, () => 0, true);
    const meshes = meshesOf(view.group);
    // Re-pinned 2026-08 for the harbor move's wall retirement (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md), the KTX2 kit-building path
    // (buildKitBuilding in src/render/eastbrook_town.ts), and owner
    // refinement round 4 (nine buildings, kit windows derived from the
    // models' own assemblies): 28 meshes are the 8 kit instances' 16 raw GLB
    // clones, their 8 window-pane meshes (one detected assembly per kit
    // fixture), the chapel opaque+emissive pair, and the 2 micro batches;
    // the 4 wall InstancedMeshes no longer exist. Round 6 grew every count by
    // the harbour quarter's three coastal buildings: 34 meshes are the 10 kit
    // instances' 20 raw GLB clones, their 10 window-pane meshes, the chapel
    // pair, and the 2 micro batches. Round 6b re-shelled the chapel onto the
    // KayKit church, which moves the last template-pipeline building onto the
    // kit path: 35 meshes are the 11 kit instances' 22 raw GLB clones, their 11
    // window-pane meshes, and the 2 micro batches, with no template building
    // mesh left at all.
    // Re-pinned 2026-10 for the Tidehold rebuild: six placed buildings replaced
    // the eleven kit shells (src/render/eastbrook_placed_building.ts). The 22
    // kit clones and 11 window-pane meshes become the six placed fixtures'
    // three meshes each, so the census is 30: 18 placed meshes, the 2 micro
    // batches, the monument's 2 and the Weekly Vault's 8 (the last two were
    // already inside the 45).
    expect(meshes).toHaveLength(30);
    const placedBuildings = EASTBROOK_LAYOUT.buildings.filter((building) =>
      isPlacedBuildingAsset(building.assetId),
    );
    expect(placedBuildings).toHaveLength(EASTBROOK_LAYOUT.buildings.length);
    // No building carries a window-pane mesh or a merged shape mesh any more:
    // a placed model's lit panes are its own emissive materials.
    const paneMeshes = meshes.filter(
      (mesh) =>
        mesh.name.startsWith('eastbrookBuildingEmissive:') ||
        mesh.name.startsWith('eastbrookBuildingOpaque:'),
    );
    const placedMeshes = placedBuildings.flatMap((building) =>
      meshesOf(view.group.getObjectByName(`eastbrookBuilding:${building.id}`) as THREE.Object3D),
    );
    const templateMeshes = meshes.filter((mesh) => !placedMeshes.includes(mesh));
    expect(placedMeshes).toHaveLength(18);
    expect(paneMeshes).toHaveLength(0);
    // Round 6b: the only template-path meshes left in town were the 2 micro
    // batches; the chapel pair that used to join them is a kit clone now.
    // Round 8 added the Realm Builder monument's own textured meshes beside
    // them (the fixture's two-mesh stand-in for it), so this bucket is the 2
    // micro batches plus the monument body. Its meshes keep their own GLB
    // materials on every tier, exactly like the placed clones, so they are
    // excluded from the vertex-color assertion below rather than counted into
    // it.
    const monumentMeshes = meshesOf(
      view.group.getObjectByName('eastbrookRealmBuilderMonumentFxBody') as THREE.Object3D,
    );
    expect(monumentMeshes.length).toBeGreaterThan(0);
    const hallMeshes = meshesOf(
      view.group.getObjectByName('eastbrookBuilding:eastbrook_weekly_vault') as THREE.Object3D,
    );
    expect(hallMeshes).toHaveLength(8);
    expect(
      hallMeshes.every((mesh) => (mesh.material as THREE.Material).type === 'MeshLambertMaterial'),
    ).toBe(true);
    const microBatchMeshes = templateMeshes.filter(
      (mesh) => !monumentMeshes.includes(mesh) && !hallMeshes.includes(mesh),
    );
    expect(microBatchMeshes).toHaveLength(2);
    // The template pipeline swaps to shared Lambert vertex-color materials on
    // Low. The placed clones keep their OWN authored GLB materials on every
    // tier (their colour is in the models' painted atlases, not vertex
    // colors), cloned per mesh so a fade cannot bleed across instances: each
    // clone still carries its source's material name, and no two placed meshes
    // share one.
    expect(
      microBatchMeshes.every(
        (mesh) => (mesh.material as THREE.Material).type === 'MeshLambertMaterial',
      ),
    ).toBe(true);
    expect(
      microBatchMeshes.every((mesh) => (mesh.material as THREE.MeshLambertMaterial).vertexColors),
    ).toBe(true);
    // The monument downgrades to Lambert on Low like everything else, but it
    // keeps its own material NAMES and its albedo map: its colour is a texture,
    // not a vertex-colour bake, which is the whole reason it left the batch.
    expect(
      monumentMeshes.every(
        (mesh) => (mesh.material as THREE.Material).type === 'MeshLambertMaterial',
      ),
    ).toBe(true);
    // The placed clones downgrade to Lambert on Low too (the Low-tier contract
    // tests/eastbrook_surface_atlas.test.ts audits), carrying the source's
    // name, its own colour map (the walls' texture object itself, shared with
    // the loader-cache scene, never the town atlas) and its own vertex-color
    // setting instead of the town's.
    expect(
      placedMeshes.every(
        (mesh) => (mesh.material as THREE.Material).type === 'MeshLambertMaterial',
      ),
    ).toBe(true);
    for (const building of placedBuildings) {
      const source = sources.get(building.assetId);
      if (!source) throw new Error(`missing fixture source for ${building.id}`);
      const sourceByName = new Map(
        materialsOf(source).map((material) => [material.name, material]),
      );
      expect([...sourceByName.keys()]).toEqual(['PlacedWalls', 'PlacedProps']);
      const built = meshesOf(
        view.group.getObjectByName(`eastbrookBuilding:${building.id}`) as THREE.Object3D,
      );
      expect(built.map((mesh) => (mesh.material as THREE.Material).name)).toEqual(
        PLACED_FIXTURE_MESHES.map((mesh) => mesh.material),
      );
      for (const mesh of built) {
        const material = mesh.material as THREE.MeshLambertMaterial;
        const from = sourceByName.get(material.name) as THREE.MeshStandardMaterial;
        expect(material, `${building.id} ${mesh.name}`).not.toBe(from);
        expect(material.map, `${building.id} ${mesh.name} map`).toBe(from.map);
        expect(material.vertexColors, `${building.id} ${mesh.name} vertex colors`).toBe(false);
        expect(material.color.getHex(), `${building.id} ${mesh.name} color`).toBe(
          from.color.getHex(),
        );
      }
      expect((sourceByName.get('PlacedWalls') as THREE.MeshStandardMaterial).map).toBeInstanceOf(
        THREE.Texture,
      );
    }
    expect(new Set(placedMeshes.map((mesh) => mesh.material)).size).toBe(18);
    // The same counts as the Standard build pinned above: the tier swaps
    // materials, never meshes or shadow casters.
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({ colorDraws: 30, shadowDraws: 23 });
  });

  it('mirrors exactly the first real wall chord after each asymmetric gate socket', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(
      readFileSync(path.join(__dirname, '..', 'public/models/props/eastbrook_wall_wing.glb')),
    );
    const nodes = Object.fromEntries(
      document
        .getRoot()
        .listNodes()
        .filter((node) => node.getName().startsWith('Socket_'))
        .map((node) => [node.getName(), node.getTranslation()]),
    );
    expect(nodes.Socket_LeftJoin?.[0]).toBeLessThan(0);
    expect(nodes.Socket_RightGate?.[0]).toBeGreaterThan(0);

    const expectedMirrored = EASTBROOK_LAYOUT.wall.segments.filter((segment) =>
      eastbrookTownInternalsForTest.wallSegmentNeedsMirror(segment),
    );
    expect(expectedMirrored).toHaveLength(EASTBROOK_LAYOUT.wall.gates.length);
    for (const gate of EASTBROOK_LAYOUT.wall.gates) {
      expect(
        expectedMirrored.some(
          (segment) =>
            Math.abs(segment.start.x - gate.end.x) < 1e-8 &&
            Math.abs(segment.start.z - gate.end.z) < 1e-8,
        ),
      ).toBe(true);
    }

    // Re-pinned 2026-08 for the Eastbrook harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): with the ring wall retired
    // (zero segments, zero gates) the mirror machinery selects zero chords and
    // buildWallBatches creates no instanced meshes at all, so the group carries
    // no mirroredWallSegmentIds and neither wall batch exists. The GLB socket
    // asymmetry contract on eastbrook_wall_wing.glb stays pinned above.
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    expect(view.group.userData.mirroredWallSegmentIds).toBeUndefined();
    expect(view.group.getObjectByName('eastbrookTownWallOpaqueMirroredInstances')).toBeUndefined();
    expect(view.group.getObjectByName('eastbrookTownWallOpaqueInstances')).toBeUndefined();
  });

  it('keeps pitched wall and fence spans terrain-supported across their full footprints', () => {
    const seed = 20061;
    const ground = (x: number, z: number) => terrainHeight(x, z, seed);
    const records = [
      ...EASTBROOK_LAYOUT.fences.map((fence) => ({
        id: fence.id,
        start: fence.start,
        end: fence.end,
        width: fence.width,
      })),
      ...EASTBROOK_LAYOUT.wall.segments.map((segment) => ({
        id: segment.id,
        start: segment.start,
        end: segment.end,
        width: EASTBROOK_LAYOUT.wall.thickness,
      })),
    ];
    let adjustedPlacements = 0;
    for (const record of records) {
      const placement = eastbrookTownInternalsForTest.pitchedSegmentPlacement(
        record.start,
        record.end,
        record.width,
        ground,
      );
      const startY = ground(record.start.x, record.start.z);
      const endY = ground(record.end.x, record.end.z);
      const horizontalLength = Math.hypot(
        record.end.x - record.start.x,
        record.end.z - record.start.z,
      );
      expect(placement.spatialLength, record.id).toBeCloseTo(
        Math.hypot(horizontalLength, endY - startY),
        10,
      );
      if (placement.terrainOffset < -1e-6) adjustedPlacements++;
      eastbrookTownInternalsForTest.forEachSegmentFootprintSample(
        record.start,
        record.end,
        record.width,
        (x, z, progress) => {
          const bottomY = startY + (endY - startY) * progress + placement.terrainOffset;
          expect(bottomY, `${record.id} floats at ${x},${z}`).toBeLessThanOrEqual(
            ground(x, z) + 1e-8,
          );
        },
      );
    }
    expect(adjustedPlacements).toBeGreaterThan(0);
  });

  it('preserves mixed vertex-color emissive cues in the shared Lambert and Standard shader arms', () => {
    for (const standardMaterials of [false, true]) {
      setStandardMaterials(standardMaterials);
      const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
      const emissiveMaterials = meshesOf(view.group)
        .filter((mesh) => mesh.name.includes('Emissive'))
        .map((mesh) => mesh.material as THREE.Material);
      expect(emissiveMaterials.length).toBeGreaterThan(0);
      for (const material of emissiveMaterials) {
        expect(material.userData.vertexColorEmissive).toBe(
          vertexColorEmissiveInternalsForTest.programCacheKey,
        );
        const shader = {
          vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
          fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
          uniforms: {},
        };
        material.onBeforeCompile(
          shader as THREE.WebGLProgramParametersWithUniforms,
          null as unknown as THREE.WebGLRenderer,
        );
        expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb;');
        expect(material.customProgramCacheKey()).toContain(
          vertexColorEmissiveInternalsForTest.programCacheKey,
        );
      }
    }
  });

  it('fog-culls and restores all static wall and micro batches without per-frame allocation', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const staticBatches = meshesOf(view.group).filter(
      (mesh) => mesh.userData.eastbrookMicroBatch || mesh.userData.eastbrookWallInstances,
    );
    // Re-pinned 2026-08: only the 2 micro batches remain after the harbor
    // move's wall retirement (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md).
    expect(staticBatches).toHaveLength(2);
    view.update(1000, 5, 1000, 1000, 5, 1000, 100, 1);
    expect(staticBatches.every((mesh) => !mesh.visible)).toBe(true);
    view.update(0, 5, 0, 0, 5, 0, 100, 1);
    expect(staticBatches.every((mesh) => mesh.visible)).toBe(true);
  });

  it('stands the Weekly Vault down for a document that owns it as a placement', () => {
    // its own family: the rebuild buildings ride authoredTowns and still draw
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      placements: [],
      promotedScenery: { eastbrookVault: true },
    });
    try {
      const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
      expect(
        view.group.getObjectByName('eastbrookBuilding:eastbrook_weekly_vault'),
      ).toBeUndefined();
      // the hall keeps its slot in the town's lists, with nothing drawn in it
      const slot = view.group.getObjectByName('eastbrookWeeklyVaultStoodDown');
      expect(slot).toBeInstanceOf(THREE.Group);
      expect(meshesOf(slot as THREE.Object3D)).toHaveLength(0);
      expect(view.group.userData.roofHideTargetCount).toBe(EASTBROOK_LAYOUT.buildings.length + 1);
      for (const building of EASTBROOK_LAYOUT.buildings) {
        expect(
          view.group.getObjectByName(`eastbrookBuilding:${building.id}`),
          building.id,
        ).toBeInstanceOf(THREE.Group);
      }
    } finally {
      setActiveWorldContent(null);
    }
    // and the shipped world, which promotes nothing, keeps the town-drawn hall
    const shipped = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    expect(
      meshesOf(
        shipped.group.getObjectByName('eastbrookBuilding:eastbrook_weekly_vault') as THREE.Object3D,
      ),
    ).toHaveLength(8);
  });

  it('stands the square dressing down for a document that owns it as placements', () => {
    // benches, stalls and yard fences are the whole micro batch; the monument
    // stays town-drawn, and so does every building
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      placements: [],
      promotedScenery: { authoredTownDressing: true },
    });
    try {
      const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
      expect(view.group.getObjectByName('eastbrookTownMicroOpaqueBatch')).toBeUndefined();
      expect(view.group.getObjectByName('eastbrookTownMicroEmissiveBatch')).toBeUndefined();
      for (const building of EASTBROOK_LAYOUT.buildings) {
        expect(
          view.group.getObjectByName(`eastbrookBuilding:${building.id}`),
          building.id,
        ).toBeInstanceOf(THREE.Group);
      }
    } finally {
      setActiveWorldContent(null);
    }
    const shipped = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    expect(shipped.group.getObjectByName('eastbrookTownMicroOpaqueBatch')).toBeInstanceOf(
      THREE.Mesh,
    );
  });

  it('keeps the indoor camera to every walk-in building it stands, and drops the rooms with it', () => {
    // each walk-in painted building registers its air (placed_town_interiors.ts), stood on the
    // ground the view stands its building on (a slope, so a wrong anchor reads differently);
    // the quay cottage bakes a shut door and the Weekly Vault is a sealed hall, so neither has
    // any
    const ground = (x: number, z: number) => 1.5 + 0.03 * x - 0.02 * z;
    const rooms = () => interiorCameraInternalsForTest.interiors();
    const walkIn = EASTBROOK_LAYOUT.buildings.filter((building) => building.walkIn);
    expect(walkIn.length).toBeGreaterThan(1);
    interiorCameraInternalsForTest.reset();
    try {
      eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
      expect(rooms().map((room) => room.id)).toEqual(
        walkIn.map((building) => `placed_town:${building.id}`),
      );
      for (const [index, building] of walkIn.entries()) {
        expect(rooms()[index], building.id).toEqual(
          placedTownCameraInterior(building, ground(building.placement.x, building.placement.z)),
        );
      }
      // a rebuild replaces them, never doubles them
      eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
      expect(rooms()).toHaveLength(walkIn.length);
      // a document that owns the buildings as placements keeps no town air
      setActiveWorldContent({
        ...BUILTIN_WORLD,
        placements: [],
        promotedScenery: { authoredTowns: true },
      });
      try {
        eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
        expect(rooms()).toEqual([]);
      } finally {
        setActiveWorldContent(null);
      }
      // ...nor does a world without the town
      eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
      expect(rooms()).toHaveLength(walkIn.length);
      eastbrookTownInternalsForTest.buildFromSources(new Map(), () => 0, false);
      expect(rooms()).toEqual([]);
    } finally {
      interiorCameraInternalsForTest.reset();
    }
  });

  it('returns an empty stable root for custom worlds before asking for any built-in asset source', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(new Map(), () => 0, false);
    expect(view.group.name).toBe(EASTBROOK_TOWN_ROOT_NAME);
    expect(view.group.children).toEqual([]);
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({
      colorDraws: 0,
      shadowDraws: 0,
      triangles: 0,
      buildingCount: 0,
      microBatchCount: 0,
      wallBatchCount: 0,
    });
    expect(() => view.update(0, 0, 0, 0, 0, 0, 100, 1)).not.toThrow();
  });

  it('recognizes only the exact built-in records replaced by the dedicated renderer', () => {
    for (const building of EASTBROOK_LAYOUT.buildings) {
      const record = BUILTIN_WORLD.props.buildings.find((item) => item.id === building.id);
      if (!record) throw new Error(`missing ${building.id}`);
      expect(isEastbrookRebuildBuilding(record)).toBe(true);
      expect(isEastbrookRebuildBuilding({ ...record, x: record.x + 0.01 })).toBe(false);
    }
    const well = BUILTIN_WORLD.props.wells[0];
    const stall = BUILTIN_WORLD.props.stalls[0];
    const fence = BUILTIN_WORLD.props.fences[0];
    expect(isEastbrookRebuildWell(well)).toBe(true);
    expect(isEastbrookRebuildWell({ ...well, x: well.x + 0.01 })).toBe(false);
    expect(isEastbrookRebuildStall(stall)).toBe(true);
    expect(isEastbrookRebuildStall({ ...stall, rot: stall.rot + 0.01 })).toBe(false);
    expect(
      isEastbrookRebuildStall({
        id: 'eastbrook_market_stall_artisans',
        x: 3.5,
        z: 11.5,
        rot: -2.788602,
        r: Math.hypot(1.4, 1.1),
        w: 2.8,
        d: 2.2,
      }),
    ).toBe(false);
    expect(isEastbrookRebuildFence(fence)).toBe(true);
    expect(isEastbrookRebuildFence({ ...fence, x2: fence.x2 + 0.01 })).toBe(false);
  });

  it('is mounted, updated, and de-duplicated at the renderer integration seam', () => {
    const rendererSource = readFileSync(
      path.join(__dirname, '..', 'src/render/renderer.ts'),
      'utf8',
    );
    expect(rendererSource).toContain('buildEastbrookTownView(this.sim.cfg.seed)');
    // the rebuilt towns ride one list: mounted, frozen and updated in loops
    expect(rendererSource).toContain(
      'this.townViews = [this.eastbrookTownView, this.fenbridgeTownView, ...placed];',
    );
    expect(rendererSource).toContain("setRenderCategory(town.group, 'props')");
    expect(rendererSource.match(/\btown\.update\(/g)).toHaveLength(2);

    const propsSource = readFileSync(path.join(__dirname, '..', 'src/render/props.ts'), 'utf8');
    expect(propsSource).toContain('eastbrookTown && isEastbrookRebuildBuilding(b)');
    expect(propsSource).toContain('eastbrookTown && isEastbrookRebuildWell(w)');
    expect(propsSource).toContain('eastbrookTown && isEastbrookRebuildStall(s)');
    expect(propsSource).toContain('eastbrookTown && isEastbrookRebuildFence(f)');

    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    expect(view.update.toString()).not.toMatch(/\bnew\s+/);
    const townSource = readFileSync(
      path.join(__dirname, '..', 'src/render/eastbrook_town.ts'),
      'utf8',
    );
    expect(townSource).not.toContain('[first, second] = [second, first]');
  });
});

describe('Eastbrook repeated placement triangle budget', () => {
  it('derives the true aggregate from final artifacts and stays under the hard runtime ceiling', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const triangleCountByAsset: Record<string, number> = {};
    for (const assetUrl of EASTBROOK_TOWN_ASSET_URLS) {
      const bytes = readFileSync(path.join(__dirname, '..', 'public', assetUrl.replace(/^\//, '')));
      const document = await io.readBinary(bytes);
      let triangles = 0;
      for (const mesh of document.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          const positions = primitive.getAttribute('POSITION');
          if (!positions) throw new Error(`${assetUrl} has no POSITION`);
          triangles += (primitive.getIndices()?.getCount() ?? positions.getCount()) / 3;
        }
      }
      triangleCountByAsset[assetUrl] = triangles;
    }

    const budget = eastbrookTownTriangleBudget(triangleCountByAsset);
    // Re-pinned 2026-08 for the Eastbrook harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): the wall wing stays
    // registered and preloaded with zero placements, so the budget carries its
    // zero-instance row while the placement-derived constant omits the key.
    expect(
      Object.fromEntries(budget.assets.map((asset) => [asset.assetUrl, asset.instances])),
    ).toEqual({ ...EASTBROOK_TOWN_ASSET_INSTANCE_COUNTS, [EASTBROOK_LAYOUT.wall.assetId]: 0 });
    expect(
      budget.assets.find((asset) => asset.assetUrl.endsWith('eastbrook_market_stall.glb')),
    ).toMatchObject({ instances: 2 });
    expect(
      budget.assets.find((asset) => asset.assetUrl.endsWith('eastbrook_wall_wing.glb')),
    ).toMatchObject({ instances: EASTBROOK_LAYOUT.wall.segments.length });
    // Re-pinned 2026-10 for the Tidehold rebuild: six placed buildings replaced
    // the eleven kit shells (src/render/eastbrook_placed_building.ts). A placed
    // building buries its model's own footing and draws no skirt, so the
    // 12-triangle reserve counts only the rows that are NOT placed, and there
    // are none.
    expect(budget.maximumFoundationTriangles).toBe(
      EASTBROOK_LAYOUT.buildings.filter((building) => !isPlacedBuildingAsset(building.assetId))
        .length * 12,
    );
    // The six shipped models, one instance each, measured off the files above.
    const placedRows = budget.assets.filter((asset) => isPlacedBuildingAsset(asset.assetUrl));
    expect(
      Object.fromEntries(placedRows.map((asset) => [asset.assetUrl, asset.trianglesPerInstance])),
    ).toEqual({
      '/models/tidehold/bank.glb': 14_161,
      '/models/tidehold/smithy.glb': 5_291,
      '/models/tidehold/tavern.glb': 12_844,
      '/models/tidehold/hall.glb': 3_857,
      '/models/tidehold/shop_a.glb': 7_210,
      '/models/tidehold/house_b.glb': 2_765,
    });
    expect(placedRows.every((asset) => asset.instances === 1)).toBe(true);
    expect(placedRows.reduce((sum, asset) => sum + asset.repeatedTriangles, 0)).toBe(46_128);
    // Re-minted 2026-08: the 26 retired wall instances took 5,356 triangles
    // with them in the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md), then the owner's Galecrest
    // building mix swapped five shells for the lighter hexb kit models, then
    // round 3 promoted the trio of decor homes into kit lots (two more
    // hexb_home_a instances and one hexb_home_b, plus their skirts). Round 6
    // took eastbrook_home_rise back out (one hexb_home_a and its skirt), then
    // appended the harbour quarter's three coastal buildings: the first
    // hexb_market lot the town has ever seated (3,125), one more hexb_home_b
    // (1,393), and one more hexb_home_a (1,011), plus a 12-triangle skirt
    // each. Round 6b (owner) re-shelled the chapel onto the KayKit church:
    // the bespoke eastbrook_chapel.glb (4,120) leaves the town's asset set and
    // hex_church.glb (1,601) takes its one instance, so the aggregate DROPS by
    // 2,519 with the building count and the 132-triangle skirt allowance
    // unchanged. 29,203 becomes 26,684 and the runtime total 29,335 becomes
    // 26,816, further under the 30,000 target than before.
    // Round 7 swapped the square's centrepiece: the well beacon (464) out, the
    // Realm Builder monument in, on its one instance. Round 8 (owner) doubled
    // that statue and put the FULL sculpt back (the decimated one read as
    // putty at that size), so the monument is 5,923 triangles and the aggregate
    // is 32,143. The 30,000 target moved to 33,000 to pay for it; the reasoning
    // is on `target` in src/render/eastbrook_town.ts. The monument is counted
    // here even though it no longer merges into the micro-batch: it is still
    // drawn in this town, and a budget that hides the town's biggest prop is
    // not a budget.
    // Re-pinned 2026-10 for the Tidehold rebuild: six placed buildings replaced
    // the eleven kit shells (src/render/eastbrook_placed_building.ts). The
    // shells' 21,924 triangles leave and the painted models' 46,128 arrive
    // (furniture included), so the aggregate moves 32,143 to 56,347. The skirt
    // reserve drops from 132 to 0 (see above) and the Weekly Vault's 4,572
    // procedural triangles are unchanged, so the runtime total moves 36,847 to
    // 60,919. The hard ceiling moved 40,000 to 64,000 to pay for it; the
    // reasoning, and the two levers left unpulled, are on `hardCeiling` in
    // src/render/eastbrook_town.ts. The 33,000 target is unchanged and is now
    // missed by a wide margin rather than a narrow one.
    expect(budget.assetTriangles).toBe(56_347);
    expect(budget.maximumFoundationTriangles).toBe(0);
    expect(budget.proceduralTriangles).toBe(4_572);
    expect(budget.maximumRuntimeTriangles).toBe(
      budget.assetTriangles + budget.maximumFoundationTriangles + budget.proceduralTriangles,
    );
    expect(budget.maximumRuntimeTriangles).toBe(60_919);
    expect(budget.hardCeiling).toBe(64_000);
    expect(
      budget.maximumRuntimeTriangles,
      JSON.stringify({
        maximumRuntimeTriangles: budget.maximumRuntimeTriangles,
        assets: budget.assets,
      }),
    ).toBeLessThanOrEqual(64_000);
    expect(budget.withinHardCeiling).toBe(true);
    expect(budget.target).toBe(33_000);
    // The painted buildings use headroom below the raised hard ceiling.
    expect(budget.maximumRuntimeTriangles).toBeGreaterThan(budget.target);
    expect(budget.meetsTarget).toBe(false);
  });
});
