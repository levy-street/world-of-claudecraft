// The Willowfen dressing built per (family, cell) for the zone-feature
// distance cull (src/render/fen_features.ts over zone_feature_cells_core.ts).
//
// Driven through the real buildFenFeatures on the shipped WORLD_SEED with the
// deferred GLBs replaced by one-mesh stand-ins (fenFeaturesInternalsForTest),
// so every pin below is a fact about the shipping placement set: the census
// counted 324 instances (191 lean) and drew all of them from Eastbrook on the
// low tier, where the whole-zone footprint's edge sits inside the 340 yd fog.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFenFeatures,
  type FenFeaturesView,
  fenFeaturesInternalsForTest,
} from '../src/render/fen_features';
import { GFX, ZONE_FEATURE_CELL_SIZE_CLASSIC } from '../src/render/gfx';
import { measureFeatureFootprint } from '../src/render/renderer_diagnostics';
import {
  featureEdgeDistance,
  hasUnseededInstanceMatrix,
  isZoneFeatureVisible,
} from '../src/render/zone_feature_visibility_core';
import { WORLD_SEED } from '../src/sim/world_seed';

// The low-tier town view of the scene census (families3_low.log, town yaw
// 270): camera (11.26, 2.72, -15.73), scene fog far LOW_FOG.far = 340
// (renderer.ts). Everything of the fen is beyond that fog from here.
const TOWN_CAM = { x: 11.26, z: -15.73 };
const LOW_FOG_FAR = 340;
// The fen's placement rectangle (fen_features.ts / fen_willows.ts bounds).
const FEN_RECT = { x0: -540, x1: -180, z0: 180, z1: 700 };

function seedStandIns(): void {
  for (const key of fenFeaturesInternalsForTest.familyKeys) {
    const scene = new THREE.Group();
    scene.name = `${key}_glb`;
    scene.add(
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: key })),
    );
    fenFeaturesInternalsForTest.seedPropScene(key, scene);
  }
}

function familyOf(cullGroup: THREE.Group): string {
  return cullGroup.name.split(':')[1];
}
function cellKeyOf(cullGroup: THREE.Group): string {
  return cullGroup.name.split(':')[2];
}
function meshesOf(root: THREE.Object3D): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
}
function instanceCount(root: THREE.Object3D): number {
  return meshesOf(root).reduce((sum, mesh) => sum + mesh.count, 0);
}
/** Sorted instance positions, the identity of an instance set. */
function positionsOf(root: THREE.Object3D): string[] {
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const out: string[] = [];
  for (const mesh of meshesOf(root)) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      out.push(`${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`);
    }
  }
  return out.sort();
}

describe('fen features per-cell cull groups', () => {
  let cells: FenFeaturesView;
  let whole: FenFeaturesView;
  afterEach(() => fenFeaturesInternalsForTest.resetPropScenes());

  function build(): void {
    seedStandIns();
    cells = buildFenFeatures(WORLD_SEED, { cellSize: ZONE_FEATURE_CELL_SIZE_CLASSIC });
    whole = buildFenFeatures(WORLD_SEED, { cellSize: 0 });
    cells.group.updateMatrixWorld(true);
    whole.group.updateMatrixWorld(true);
  }

  it('registers one cull group per (family, cell) and nothing else on the parent', () => {
    build();
    expect(cells.group.name).toBe('fen-features');
    expect(cells.cullGroups).toHaveLength(26);
    expect(new Set(cells.cullGroups.map(cellKeyOf)).size).toBe(6);
    expect(new Set(cells.cullGroups.map(familyOf))).toEqual(
      new Set(fenFeaturesInternalsForTest.familyKeys),
    );
    expect(cells.group.children).toHaveLength(cells.cullGroups.length);
    for (const cullGroup of cells.cullGroups) {
      expect(cullGroup.parent).toBe(cells.group);
      expect(cullGroup.name.startsWith('fen-features:')).toBe(true);
      // one stand-in part per family, so one mesh per cull group
      expect(cullGroup.children).toHaveLength(1);
      expect(meshesOf(cullGroup)[0].count).toBeGreaterThan(0);
    }
  });

  it("keeps today's layout with a cell size of 0: five whole meshes, one footprint", () => {
    build();
    // the vista arm and the `?fencells=off` census arm: meshes straight under
    // the parent, and the parent alone registered with the cull (the
    // pre-split scene graph, so the census before/after compares one build)
    expect(whole.cullGroups).toEqual([whole.group]);
    expect(whole.group.children).toHaveLength(5);
    expect(meshesOf(whole.group)).toHaveLength(5);
    for (const mesh of whole.group.children) expect(mesh.parent).toBe(whole.group);
  });

  it('draws exactly the shipped instance set, whatever the cell size', () => {
    build();
    // 324 placements on the shipped seed (willow 54, lilies 47, reeds 69,
    // mushrooms 127, log 27); the lean thin keeps 191 of them. The thin runs
    // over the whole family before the split, so both layouts agree.
    expect(instanceCount(whole.group)).toBe(GFX.leanFoliage ? 191 : 324);
    expect(instanceCount(cells.group)).toBe(instanceCount(whole.group));
    for (const family of fenFeaturesInternalsForTest.familyKeys) {
      const wholeMesh = meshesOf(whole.group).find(
        (m) => (m.material as THREE.Material).name === family,
      ) as THREE.InstancedMesh;
      const familyCells = cells.cullGroups.filter((g) => familyOf(g) === family);
      expect(familyCells.reduce((sum, g) => sum + instanceCount(g), 0)).toBe(wholeMesh.count);
      const wholePositions = positionsOf(wholeMesh);
      const cellPositions = familyCells.flatMap(positionsOf).sort();
      expect(cellPositions).toEqual(wholePositions);
    }
  });

  it('seeds every instance matrix before attach (the footprint guard)', () => {
    build();
    for (const mesh of meshesOf(cells.group)) {
      expect(hasUnseededInstanceMatrix(mesh.instanceMatrix.array, mesh.count)).toBe(false);
    }
  });

  it("gives every cell its own geometry object over the family's shared vertex data", () => {
    build();
    for (const family of fenFeaturesInternalsForTest.familyKeys) {
      const meshes = cells.cullGroups.filter((g) => familyOf(g) === family).flatMap(meshesOf);
      expect(new Set(meshes.map((m) => m.geometry.id)).size).toBe(meshes.length);
      const position = meshes[0].geometry.getAttribute('position');
      for (const mesh of meshes) {
        expect(mesh.geometry.getAttribute('position')).toBe(position);
        expect(mesh.geometry.index).toBe(meshes[0].geometry.index);
        expect(mesh.geometry.boundingSphere).not.toBeNull();
      }
    }
  });

  it('from Eastbrook at the low fog, keeps one cell where the whole zone was kept', () => {
    build();
    // The bug: as one footprint (today's layout) the fen is inside the reach
    // from town, so all five meshes stay registered visible...
    for (const root of [whole.group, cells.group]) {
      const footprint = measureFeatureFootprint(root);
      expect(footprint).not.toBeNull();
      expect(isZoneFeatureVisible(footprint, TOWN_CAM.x, TOWN_CAM.z, LOW_FOG_FAR)).toBe(true);
    }
    // ...while per cell only the one cell that reaches into the fog stays.
    const kept = cells.cullGroups.filter((g) =>
      isZoneFeatureVisible(measureFeatureFootprint(g), TOWN_CAM.x, TOWN_CAM.z, LOW_FOG_FAR),
    );
    expect(new Set(kept.map(cellKeyOf)).size).toBe(1);
    const keptInstances = kept.reduce((sum, g) => sum + instanceCount(g), 0);
    expect(keptInstances).toBeGreaterThan(0);
    expect(keptInstances).toBeLessThanOrEqual(40);
    // and the next CELL is clear of the fog by a wide margin (the near cell's
    // other families may sit just past it; they share its cell), so a
    // placement drift that pulls a second cell into reach shows up here
    const keptCell = cellKeyOf(kept[0]);
    const otherCells = cells.cullGroups.filter((g) => cellKeyOf(g) !== keptCell);
    const nearestOtherCellEdge = Math.min(
      ...otherCells.map((g) =>
        featureEdgeDistance(
          measureFeatureFootprint(g) as NonNullable<ReturnType<typeof measureFeatureFootprint>>,
          TOWN_CAM.x,
          TOWN_CAM.z,
        ),
      ),
    );
    expect(nearestOtherCellEdge).toBeGreaterThan(LOW_FOG_FAR + 50);
  });

  it('keeps every cell footprint inside the fen rectangle', () => {
    build();
    for (const cullGroup of cells.cullGroups) {
      const fp = measureFeatureFootprint(cullGroup);
      expect(fp).not.toBeNull();
      if (!fp) continue;
      expect(fp.centerX - fp.halfX).toBeGreaterThanOrEqual(FEN_RECT.x0);
      expect(fp.centerX + fp.halfX).toBeLessThanOrEqual(FEN_RECT.x1);
      expect(fp.centerZ - fp.halfZ).toBeGreaterThanOrEqual(FEN_RECT.z0);
      expect(fp.centerZ + fp.halfZ).toBeLessThanOrEqual(FEN_RECT.z1);
    }
  });
});
