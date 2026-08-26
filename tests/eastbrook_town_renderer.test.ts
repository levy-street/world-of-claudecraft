import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { afterEach, describe, expect, it } from 'vitest';
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
import { createRevealGateCore } from '../src/render/reveal_gate_core';
import { vertexColorEmissiveInternalsForTest } from '../src/render/vertex_color_emissive';
import { BUILDING_TERRAIN_SAMPLE_STEP } from '../src/sim/building_layout';
import { BUILTIN_WORLD } from '../src/sim/data';
import { EASTBROOK_LAYOUT, localToWorld } from '../src/sim/eastbrook_layout';
import { terrainHeight } from '../src/sim/world';

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

function fixtureSources(): Map<string, THREE.Object3D> {
  return new Map(
    EASTBROOK_TOWN_ASSET_URLS.map((assetUrl) => [
      assetUrl,
      sourceAsset(EASTBROOK_TOWN_NEW_ASSET_URLS.includes(assetUrl)),
    ]),
  );
}

// Added 2026-08 for the KTX2 kit-building path (buildKitBuilding in
// src/render/eastbrook_town.ts, docs/design/eastbrook-revamp/site-plan.md):
// the five Galecrest hexb service buildings render as raw GLB scene clones
// with their OWN materials (their color lives in KTX2 palette textures the
// atlas bake cannot read), while the chapel stays on the template pipeline.
// Per-building assertions branch on this split.
function isKitBuildingAsset(assetUrl: string): boolean {
  return assetUrl.startsWith('/models/biome/');
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
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
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 1.5, true);
    expect(view.group.name).toBe(EASTBROOK_TOWN_ROOT_NAME);
    expect(view.group.userData.newAssetUrls).toEqual(EASTBROOK_TOWN_NEW_ASSET_URLS);
    expect(view.group.userData.assetUrls).toEqual(EASTBROOK_TOWN_ASSET_URLS);

    for (const building of EASTBROOK_LAYOUT.buildings) {
      const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
      expect(group, building.id).toBeInstanceOf(THREE.Group);
      expect(group?.position.x).toBe(building.position.x);
      expect(group?.position.y).toBe(1.5);
      expect(group?.position.z).toBe(building.position.z);
      expect(group?.rotation.y).toBe(building.rotation);
      expect(group?.userData.assetUrl).toBe(building.assetId);
      expect(group?.userData.target).toBe(building.nativeDimensions);
      expect(group?.userData.front).toBe(building.frontStandingPoint);
      if (isKitBuildingAsset(building.assetId)) {
        // Re-staged 2026-08 for the KTX2 kit-building path (buildKitBuilding
        // in src/render/eastbrook_town.ts,
        // docs/design/eastbrook-revamp/site-plan.md), then for owner
        // refinement rounds 4 and 5: a kit group carries no merged
        // eastbrookBuildingOpaque mesh; it holds a wrap group of raw GLB
        // scene clones scaled to nativeDimensions (every cloned mesh casting
        // shadows) PLUS one merged amber window-pane mesh under the
        // shape-path emissive name. The panes are the models' own recessed
        // glass planes, lifted verbatim from the detected window assemblies
        // (kit_window_panes_core.ts) so the glow fits the openings exactly,
        // and parented inside the wrap AS A SIBLING of the clone, after the
        // shadow traverse, so they never cast shadows, inherit the wrap's
        // scale-to-dimensions transform, and share the clone's centering
        // offset. Flat ground grows no foundation skirt.
        expect(group?.getObjectByName(`eastbrookBuildingOpaque:${building.id}`)).toBeUndefined();
        const panes = group?.getObjectByName(`eastbrookBuildingEmissive:${building.id}`);
        expect(panes, `${building.id} window panes`).toBeInstanceOf(THREE.Mesh);
        if (!(panes instanceof THREE.Mesh)) throw new Error(`missing panes for ${building.id}`);
        expect(panes.castShadow, `${building.id} panes cast no shadow`).toBe(false);
        expect(panes.receiveShadow, `${building.id} panes receive no shadow`).toBe(false);
        expect((panes.material as THREE.Material).name).toBe(
          `eastbrookTownKitPanes:${building.id}`,
        );
        // A pane sits mid-opening and must read from both approaches.
        expect((panes.material as THREE.Material).side, `${building.id} pane sidedness`).toBe(
          THREE.DoubleSide,
        );
        // The pane triangles are coplanar with the model's own glass
        // geometry (round 5): the polygon offset wins the depth fight
        // without geometric displacement.
        expect(
          (panes.material as THREE.Material).polygonOffset,
          `${building.id} pane polygon offset`,
        ).toBe(true);
        expect((panes.material as THREE.Material).polygonOffsetFactor).toBe(-2);
        expect((panes.material as THREE.Material).polygonOffsetUnits).toBe(-2);
        const wrap = group?.children.find(
          (child): child is THREE.Group => child instanceof THREE.Group,
        );
        expect(wrap, building.id).toBeInstanceOf(THREE.Group);
        if (!wrap) throw new Error(`missing kit wrap group for ${building.id}`);
        // Sibling-of-the-clone contract: the pane mesh rides the wrap (so it
        // scales with the model) beside the clone, sharing its centering
        // offset, and its geometry is exactly the fixture pane box's back
        // face (round 5): two triangles at z 1.98 spanning x 0.6..0.8 and
        // y 1.2..1.5 in raw model space.
        expect(panes.parent, `${building.id} pane parent`).toBe(wrap);
        const clone = wrap.children.find((child) => child !== panes);
        if (!clone) throw new Error(`missing kit clone for ${building.id}`);
        expect(panes.position.toArray(), `${building.id} pane offset`).toEqual(
          clone.position.toArray(),
        );
        expect(panes.geometry.getAttribute('position').count, `${building.id} pane face`).toBe(6);
        panes.geometry.computeBoundingBox();
        const paneBounds = panes.geometry.boundingBox;
        expect(paneBounds?.min.x, building.id).toBeCloseTo(0.6, 6);
        expect(paneBounds?.max.x, building.id).toBeCloseTo(0.8, 6);
        expect(paneBounds?.min.y, building.id).toBeCloseTo(1.2, 6);
        expect(paneBounds?.max.y, building.id).toBeCloseTo(1.5, 6);
        expect(paneBounds?.min.z, building.id).toBeCloseTo(1.98, 6);
        expect(paneBounds?.max.z, building.id).toBeCloseTo(1.98, 6);
        const kitMeshes = meshesOf(wrap).filter((mesh) => mesh !== panes);
        expect(kitMeshes.length, building.id).toBeGreaterThan(0);
        expect(
          kitMeshes.every((mesh) => mesh.castShadow),
          building.id,
        ).toBe(true);
        // Measured on a parentless clone so the wrap's local transform is the
        // whole matrixWorld chain (this headless build never composes the
        // live group's world matrices).
        const size = new THREE.Box3().setFromObject(wrap.clone(true)).getSize(new THREE.Vector3());
        expect(size.x, building.id).toBeCloseTo(building.nativeDimensions.width, 5);
        expect(size.y, building.id).toBeCloseTo(building.nativeDimensions.height, 5);
        expect(size.z, building.id).toBeCloseTo(building.nativeDimensions.depth, 5);
        continue;
      }
      expect(group?.getObjectByName(`eastbrookBuildingOpaque:${building.id}`)).toBeInstanceOf(
        THREE.Mesh,
      );
      expect(group?.getObjectByName(`eastbrookBuildingEmissive:${building.id}`)).toBeInstanceOf(
        THREE.Mesh,
      );
      const opaque = group?.getObjectByName(`eastbrookBuildingOpaque:${building.id}`) as THREE.Mesh;
      opaque.geometry.computeBoundingBox();
      const size = opaque.geometry.boundingBox?.getSize(new THREE.Vector3());
      expect(size?.x).toBeCloseTo(building.nativeDimensions.width, 5);
      expect(size?.y).toBeCloseTo(building.nativeDimensions.height, 5);
      expect(size?.z).toBeCloseTo(building.nativeDimensions.depth, 5);
    }

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
    expect(view.group.userData.roofHideTargetCount).toBe(EASTBROOK_LAYOUT.buildings.length);
    expect(view.group.userData.microPlacementIds).toEqual([
      EASTBROOK_LAYOUT.civic.wellBeacon.id,
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
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({
      colorDraws: 35,
      shadowDraws: 23,
      buildingCount: 11,
      roofHideTargetCount: 11,
      microBatchCount: 2,
      wallBatchCount: 0,
      wallSegmentCount: 0,
      gateCount: 0,
    });
  });

  it('seats every service building on its real terrain envelope with a non-floating foundation', () => {
    const seed = 20_061;
    const ground = (x: number, z: number) => terrainHeight(x, z, seed);
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
    const flatView = eastbrookTownInternalsForTest.buildFromSources(
      fixtureSources(),
      () => 0,
      true,
    );

    for (const building of EASTBROOK_LAYOUT.buildings) {
      const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
      if (!group) throw new Error(`missing rendered building ${building.id}`);
      const { width, depth } = building.nativeDimensions;
      const xSteps = Math.max(1, Math.ceil(width / BUILDING_TERRAIN_SAMPLE_STEP));
      const zSteps = Math.max(1, Math.ceil(depth / BUILDING_TERRAIN_SAMPLE_STEP));
      const entrance = localToWorld(building.position, building.rotation, 0, depth / 2);
      const entranceY = ground(entrance.x, entrance.z);
      let minimumY = Infinity;
      const samples: Array<{ x: number; z: number; ground: number }> = [];
      for (let zIndex = 0; zIndex <= zSteps; zIndex++) {
        const localZ = -depth / 2 + (depth * zIndex) / zSteps;
        for (let xIndex = 0; xIndex <= xSteps; xIndex++) {
          const localX = -width / 2 + (width * xIndex) / xSteps;
          const point = localToWorld(building.position, building.rotation, localX, localZ);
          const sampleGround = ground(point.x, point.z);
          minimumY = Math.min(minimumY, sampleGround);
          samples.push({ ...point, ground: sampleGround });
        }
      }

      const foundationDepth = Math.max(0, entranceY - minimumY);
      expect(group.position.y, `${building.id} entrance grade`).toBeCloseTo(entranceY, 10);
      expect(group.userData.foundationDepth, building.id).toBeCloseTo(foundationDepth, 10);
      expect(foundationDepth, `${building.id} real-terrain foundation branch`).toBeGreaterThan(0);
      if (isKitBuildingAsset(building.assetId)) {
        // Re-staged 2026-08 for the KTX2 kit-building path (buildKitBuilding
        // in src/render/eastbrook_town.ts,
        // docs/design/eastbrook-revamp/site-plan.md): a kit building seats
        // the raw GLB clone at the entrance grade and closes the terrain gap
        // with a dedicated 12-triangle foundation skirt mesh (the same box
        // the template path merges into its opaque batch); flat ground grows
        // no skirt at all.
        // The window-pane mesh lives inside the wrap group (round 4), so the
        // skirt is found by its material name, never by "first Mesh child".
        const skirt = group.children.find(
          (child): child is THREE.Mesh =>
            child instanceof THREE.Mesh &&
            (child.material as THREE.Material).name === `eastbrookTownKitSkirt:${building.id}`,
        );
        if (!skirt) throw new Error(`missing foundation skirt for ${building.id}`);
        const skirtTriangles =
          (skirt.geometry.index?.count ?? skirt.geometry.getAttribute('position').count) / 3;
        expect(skirtTriangles, `${building.id} foundation geometry`).toBe(12);
        skirt.geometry.computeBoundingBox();
        expect(
          skirt.geometry.boundingBox?.min.y,
          `${building.id} foundation mesh bottom`,
        ).toBeCloseTo(-foundationDepth, 5);
        const flatGroup = flatView.group.getObjectByName(`eastbrookBuilding:${building.id}`);
        if (!flatGroup) throw new Error(`missing flat rendered building ${building.id}`);
        expect(
          flatGroup.children.find(
            (child) =>
              child instanceof THREE.Mesh &&
              (child.material as THREE.Material).name === `eastbrookTownKitSkirt:${building.id}`,
          ),
          `${building.id} flat-ground skirt`,
        ).toBeUndefined();
      } else {
        const opaque = group.getObjectByName(
          `eastbrookBuildingOpaque:${building.id}`,
        ) as THREE.Mesh;
        const flatOpaque = flatView.group.getObjectByName(
          `eastbrookBuildingOpaque:${building.id}`,
        ) as THREE.Mesh;
        if (!opaque || !flatOpaque) throw new Error(`missing opaque geometry for ${building.id}`);
        const opaqueTriangles =
          (opaque.geometry.index?.count ?? opaque.geometry.getAttribute('position').count) / 3;
        const flatOpaqueTriangles =
          (flatOpaque.geometry.index?.count ?? flatOpaque.geometry.getAttribute('position').count) /
          3;
        expect(opaqueTriangles, `${building.id} foundation geometry`).toBe(
          flatOpaqueTriangles + 12,
        );
        opaque.geometry.computeBoundingBox();
        expect(
          opaque.geometry.boundingBox?.min.y,
          `${building.id} foundation mesh bottom`,
        ).toBeCloseTo(-foundationDepth, 5);
      }
      const foundationBottom = group.position.y - foundationDepth;
      for (const sample of samples) {
        expect(
          foundationBottom,
          `${building.id} foundation floats at ${sample.x},${sample.z}`,
        ).toBeLessThanOrEqual(sample.ground + 1e-8);
      }
      expect(foundationBottom, `${building.id} deepest terrain seat`).toBeCloseTo(minimumY, 10);
    }
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
    const cullRadius = EASTBROOK_LAYOUT.wall.radius + EASTBROOK_LAYOUT.wall.maximumSegmentSpan / 2;
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

    const cullRadius = EASTBROOK_LAYOUT.wall.radius + EASTBROOK_LAYOUT.wall.maximumSegmentSpan / 2;
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
    const { x, z } = bankGroup.position;
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
    const { x, z } = lastGroup.position;
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

    view.update(45, 30, 45, bank.position.x, 30, bank.position.z, 200, 10);
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

  it('uses Lambert vertex-color materials on Low without changing geometry or draw counts', () => {
    setStandardMaterials(false);
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
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
    expect(meshes).toHaveLength(35);
    const kitBuildings = EASTBROOK_LAYOUT.buildings.filter((building) =>
      isKitBuildingAsset(building.assetId),
    );
    const paneMeshes = kitBuildings.map(
      (building) =>
        view.group.getObjectByName(`eastbrookBuildingEmissive:${building.id}`) as THREE.Mesh,
    );
    const kitMeshes = kitBuildings
      .flatMap((building) =>
        meshesOf(view.group.getObjectByName(`eastbrookBuilding:${building.id}`) as THREE.Object3D),
      )
      .filter((mesh) => !paneMeshes.includes(mesh as THREE.Mesh));
    const templateMeshes = meshes.filter(
      (mesh) => !kitMeshes.includes(mesh) && !paneMeshes.includes(mesh as THREE.Mesh),
    );
    expect(kitMeshes).toHaveLength(22);
    expect(paneMeshes).toHaveLength(11);
    // Round 6b: the only template-path meshes left in town are the 2 micro
    // batches; the chapel pair that used to join them is a kit clone now.
    expect(templateMeshes).toHaveLength(2);
    // The template pipeline swaps to shared Lambert vertex-color materials on
    // Low. The kit clones keep their OWN authored GLB materials on every tier
    // (their color is in KTX2 palette textures, not vertex colors), cloned
    // per building so a fade cannot bleed across instances: each clone still
    // carries its source's material name, and no two kit meshes share one.
    // The window panes ride the town's vertex-color emissive pipeline, so on
    // Low they downgrade to Lambert like the template meshes, one
    // independent material per building.
    expect(
      templateMeshes.every(
        (mesh) => (mesh.material as THREE.Material).type === 'MeshLambertMaterial',
      ),
    ).toBe(true);
    expect(
      templateMeshes.every((mesh) => (mesh.material as THREE.MeshLambertMaterial).vertexColors),
    ).toBe(true);
    expect(
      kitMeshes.every((mesh) =>
        ['TownOpaque', 'TownEmissive'].includes((mesh.material as THREE.Material).name),
      ),
    ).toBe(true);
    expect(new Set(kitMeshes.map((mesh) => mesh.material)).size).toBe(22);
    expect(
      paneMeshes.every((mesh) => (mesh.material as THREE.Material).type === 'MeshLambertMaterial'),
    ).toBe(true);
    expect(
      paneMeshes.every((mesh) => (mesh.material as THREE.MeshLambertMaterial).vertexColors),
    ).toBe(true);
    expect(new Set(paneMeshes.map((mesh) => mesh.material)).size).toBe(11);
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({ colorDraws: 35, shadowDraws: 23 });
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
    expect(rendererSource).toContain("setRenderCategory(this.eastbrookTownView.group, 'props')");
    expect(rendererSource.match(/this\.eastbrookTownView\.update\(/g)).toHaveLength(2);

    const propsSource = readFileSync(path.join(__dirname, '..', 'src/render/props.ts'), 'utf8');
    expect(propsSource).toContain('builtInWorld && isEastbrookRebuildBuilding(b)');
    expect(propsSource).toContain('builtInWorld && isEastbrookRebuildWell(w)');
    expect(propsSource).toContain('builtInWorld && isEastbrookRebuildStall(s)');
    expect(propsSource).toContain('builtInWorld && isEastbrookRebuildFence(f)');

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
    expect(budget.maximumFoundationTriangles).toBe(EASTBROOK_LAYOUT.buildings.length * 12);
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
    expect(budget.assetTriangles).toBe(26_684);
    expect(budget.maximumFoundationTriangles).toBe(132);
    expect(budget.maximumRuntimeTriangles).toBe(
      budget.assetTriangles + budget.maximumFoundationTriangles,
    );
    expect(budget.maximumRuntimeTriangles).toBe(26_816);
    expect(
      budget.maximumRuntimeTriangles,
      JSON.stringify({
        maximumRuntimeTriangles: budget.maximumRuntimeTriangles,
        assets: budget.assets,
      }),
    ).toBeLessThanOrEqual(40_000);
    expect(budget.withinHardCeiling).toBe(true);
    expect(budget.target).toBe(30_000);
    expect(budget.maximumRuntimeTriangles).toBeLessThanOrEqual(budget.target);
    expect(budget.meetsTarget).toBe(true);
  });
});
