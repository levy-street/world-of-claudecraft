// The Willowfen dressing built per (family, cell) for the zone-feature
// distance cull (src/render/fen_features.ts over zone_feature_cells_core.ts).
//
// Driven through the real buildFenFeatures on the shipped WORLD_SEED with the
// deferred GLBs replaced by one-mesh stand-ins (fenFeaturesInternalsForTest),
// so every pin below is a fact about the shipping placement set: the census
// counted 324 instances (191 lean) and drew all of them from Eastbrook on the
// low tier, where the whole-zone footprint's edge sits inside the 340 yd fog.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFenFeatures,
  type FenFeaturesView,
  fenFeaturesBuildOptions,
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

// The far-field policy is the one arm decision (far_terrain_core.ts); the
// wiring test drives both answers through it, the rest of the file never
// reads it (the builds below pass their cell size explicitly).
const farField = vi.hoisted(() => ({ vistaEnabled: false, calls: [] as unknown[][] }));
vi.mock('../src/render/far_terrain_core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/far_terrain_core')>();
  return {
    ...actual,
    farFieldPolicy: (...args: unknown[]) => {
      farField.calls.push(args);
      return {
        sprites: farField.vistaEnabled,
        vista: { enabled: farField.vistaEnabled, spacing: 0, envelopeFar: 0, cameraFar: 0 },
      };
    },
  };
});

// The low-tier town view of the scene census (families3_low.log, town yaw
// 270): camera (11.26, 2.72, -15.73), scene fog far LOW_FOG.far = 340
// (renderer.ts). Everything of the fen is beyond that fog from here.
const TOWN_CAM = { x: 11.26, z: -15.73 };
const LOW_FOG_FAR = 340;
// The fen's placement rectangle (fen_features.ts / fen_willows.ts bounds).
const FEN_RECT = { x0: -540, x1: -180, z0: 180, z1: 700 };

// One mesh per family, except the willow, which stands in as a two-part model
// (trunk and canopy, as a real GLB may be) with a material group on its
// trunk, so the per-cell part loop and the geometry copy of groups are
// exercised, not only the one-part path.
const TWO_PART_FAMILY = 'willow';
function seedStandIns(): void {
  for (const key of fenFeaturesInternalsForTest.familyKeys) {
    const scene = new THREE.Group();
    scene.name = `${key}_glb`;
    const trunk = new THREE.BoxGeometry(1, 1, 1);
    if (key === TWO_PART_FAMILY) {
      trunk.addGroup(0, trunk.index?.count ?? 36, 0);
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(2, 1, 2),
        new THREE.MeshStandardMaterial({ name: key }),
      );
      canopy.position.y = 1.5;
      scene.add(canopy);
    }
    scene.add(new THREE.Mesh(trunk, new THREE.MeshStandardMaterial({ name: key })));
    fenFeaturesInternalsForTest.seedPropScene(key, scene);
  }
}
const partsOf = (family: string): number => (family === TWO_PART_FAMILY ? 2 : 1);

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
  const wholeCount = (family: string): number =>
    meshesOf(whole.group).find((m) => (m.material as THREE.Material).name === family)?.count ?? 0;
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
      // one mesh per part of the family's model, all with the cell's count
      expect(cullGroup.children).toHaveLength(partsOf(familyOf(cullGroup)));
      const counts = new Set(meshesOf(cullGroup).map((m) => m.count));
      expect(counts.size).toBe(1);
      expect(meshesOf(cullGroup)[0].count).toBeGreaterThan(0);
    }
  });

  it("keeps today's layout with a cell size of 0: five whole meshes, one footprint", () => {
    build();
    // the vista arm and the `?fencells=off` census arm: meshes straight under
    // the parent, and the parent alone registered with the cull (the
    // pre-split scene graph, so the census before/after compares one build)
    expect(whole.cullGroups).toEqual([whole.group]);
    expect(whole.group.children).toHaveLength(6);
    expect(meshesOf(whole.group)).toHaveLength(6);
    for (const mesh of whole.group.children) expect(mesh.parent).toBe(whole.group);
  });

  it('draws exactly the shipped instance set, whatever the cell size', () => {
    build();
    // 324 placements on the shipped seed (willow 54, lilies 47, reeds 69,
    // mushrooms 127, log 27); the lean thin keeps 191 of them. The thin runs
    // over the whole family before the split, so both layouts agree.
    // (the two-part willow counts its instances once per part on both sides)
    expect(instanceCount(whole.group)).toBe((GFX.leanFoliage ? 191 : 324) + wholeCount('willow'));
    expect(instanceCount(cells.group)).toBe(instanceCount(whole.group));
    for (const family of fenFeaturesInternalsForTest.familyKeys) {
      const wholeMeshes = meshesOf(whole.group).filter(
        (m) => (m.material as THREE.Material).name === family,
      );
      expect(wholeMeshes).toHaveLength(partsOf(family));
      const familyCells = cells.cullGroups.filter((g) => familyOf(g) === family);
      expect(familyCells.reduce((sum, g) => sum + instanceCount(g), 0)).toBe(
        wholeMeshes.reduce((sum, m) => sum + m.count, 0),
      );
      const wholePositions = positionsOf(wholeMeshes[0]);
      const cellPositions = familyCells.flatMap((g) => positionsOf(meshesOf(g)[0])).sort();
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
      // per part: the cells of one part share that part's attribute objects
      const byPart = new Map<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, number>();
      for (const mesh of meshes) {
        const position = mesh.geometry.getAttribute('position');
        byPart.set(position, (byPart.get(position) ?? 0) + 1);
        expect(mesh.geometry.boundingSphere).not.toBeNull();
        expect(mesh.geometry.boundingBox).not.toBeNull();
      }
      expect(byPart.size).toBe(partsOf(family));
      for (const shared of byPart.values()) expect(shared).toBe(meshes.length / partsOf(family));
      if (family === TWO_PART_FAMILY) {
        // the trunk part carries one material group beyond BoxGeometry's six
        // face groups; every cell copy of that part keeps it
        const trunks = meshes.filter((m) => m.geometry.groups.length === 7);
        expect(trunks).toHaveLength(meshes.length / 2);
        for (const m of trunks) {
          expect(m.geometry.groups[6]).toEqual({ start: 0, count: 36, materialIndex: 0 });
        }
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
    // placements, so each cull group counted once whatever its part count
    const keptInstances = kept.reduce((sum, g) => sum + meshesOf(g)[0].count, 0);
    expect(keptInstances).toBeGreaterThan(0);
    // a small fraction of the 324 (the willow stand-in's canopy widens its
    // footprint, so the near cell's willows count here too)
    expect(keptInstances).toBeLessThanOrEqual(60);
    // and the next CELL is clear of the fog by a wide margin (the near cell's
    // other families may sit just past it; they share its cell), so a
    // placement drift that pulls a second cell into reach shows up here
    const keptCell = cellKeyOf(kept[0]);
    const otherCells = cells.cullGroups.filter((g) => cellKeyOf(g) !== keptCell);
    expect(otherCells.length).toBeGreaterThan(0);
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

  it('wires the live build to the far-field policy, whole under the ?fencells=off dev arm', async () => {
    // The renderer calls buildFenFeatures(seed) with no options: this default
    // is the only path a player's build takes. The arm is farFieldPolicy's
    // decision (the renderer's own vista read), mocked here on both answers.
    expect(ZONE_FEATURE_CELL_SIZE_CLASSIC).toBe(180);
    farField.vistaEnabled = false;
    expect(fenFeaturesBuildOptions()).toEqual({ cellSize: ZONE_FEATURE_CELL_SIZE_CLASSIC });
    expect(farField.calls.at(-1)).toEqual([GFX.vistaTier, GFX]);
    farField.vistaEnabled = true;
    expect(fenFeaturesBuildOptions()).toEqual({ cellSize: 0 });
    // render_dev_flags reads location once at module load, so the dev arm is
    // exercised on a fresh module graph (the render_dev_flags test's idiom).
    farField.vistaEnabled = false;
    vi.resetModules();
    vi.stubGlobal('location', { search: '?fencells=off' });
    try {
      const fresh = await import('../src/render/fen_features');
      expect(fresh.fenFeaturesBuildOptions()).toEqual({ cellSize: 0 });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
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
