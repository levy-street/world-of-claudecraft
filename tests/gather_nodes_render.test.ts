import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildGatherNodes,
  gatherNodeIdFromIntersection,
  gatherNodePreloadInternalsForTest,
} from '../src/render/gather_nodes';
import { NODE_Y_OFFSET, nodeTierScale } from '../src/render/gather_nodes_lookup';
import { GATHER_NODES } from '../src/sim/data';
import type { GatherNodeDef, GatherNodeType } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

describe('gather node rendering', () => {
  it('batches repeated opaque nodes by zone, type, and regional z-band', () => {
    const { group } = buildGatherNodes(1);
    const expectedBatches = new Set(
      GATHER_NODES.map((node) => `${node.zoneId}:${node.type}:${Math.floor(node.pos.z / 180)}`),
    );
    const meshes = group.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );

    // 120 nodes in 57 batches through v0.33.0; the phase 20 density pass
    // (the +36 bottom-three set) took the content to 156 nodes and 68
    // batches (11 new zone:type:band combos across willowfen, galecrest,
    // and farshore_isle).
    expect(GATHER_NODES).toHaveLength(156);
    expect(expectedBatches.size).toBe(68);
    expect(meshes).toHaveLength(68);
    expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(GATHER_NODES.length);
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(3);
    expect(new Set(meshes.map((mesh) => mesh.material)).size).toBe(3);
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.boundingBox).not.toBeNull();
      expect(mesh.boundingSphere).not.toBeNull();
      const nodeIds = mesh.userData.gatherNodeIds as string[];
      expect(nodeIds).toHaveLength(mesh.count);
      for (const nodeId of nodeIds) {
        const node = GATHER_NODES.find((candidate) => candidate.id === nodeId);
        expect(node?.zoneId).toBe(mesh.userData.gatherNodeZoneId);
        expect(node?.type).toBe(mesh.userData.gatherNodeType);
        expect(Math.floor((node?.pos.z ?? 0) / 180)).toBe(mesh.userData.gatherNodeBand);
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      expect(materials.every((material) => !material.transparent && material.alphaTest === 0)).toBe(
        true,
      );
    }
  });

  it('keeps each content id aligned with its instance transform and picking id', () => {
    const seed = 9;
    const { group } = buildGatherNodes(seed);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const seenIds = new Set<string>();

    for (const child of group.children) {
      expect(child).toBeInstanceOf(THREE.InstancedMesh);
      const mesh = child as THREE.InstancedMesh;
      const nodeIds = mesh.userData.gatherNodeIds as string[];
      // The tier-scale base anchor (the packet's UX pass): the instance
      // translation compensates the upscale by (tierScale - 1) * minY of the
      // UNSCALED template. Headless builds use the single-part fallback
      // primitives, so the template union minY is this mesh's own geometry
      // bounding-box min.y under an identity part transform.
      mesh.geometry.computeBoundingBox();
      const templateMinY = mesh.geometry.boundingBox?.min.y ?? 0;
      for (const [instanceId, nodeId] of nodeIds.entries()) {
        mesh.getMatrixAt(instanceId, matrix);
        position.setFromMatrixPosition(matrix);
        const node = GATHER_NODES.find((candidate) => candidate.id === nodeId);
        expect(node).toBeDefined();
        if (!node) continue;
        expect(position.x).toBe(node.pos.x);
        expect(position.y).toBeCloseTo(
          terrainHeight(node.pos.x, node.pos.z, seed) +
            NODE_Y_OFFSET[node.type] -
            (nodeTierScale(node.tier) - 1) * templateMinY,
          6,
        );
        expect(position.z).toBe(node.pos.z);
        expect(
          gatherNodeIdFromIntersection({
            distance: 0,
            point: new THREE.Vector3(),
            object: mesh,
            instanceId,
          }),
        ).toBe(nodeId);
        seenIds.add(nodeId);
      }
    }

    expect(seenIds).toEqual(new Set(GATHER_NODES.map((node) => node.id)));
  });

  it('preserves a complete authored child transform and bounds every instance', () => {
    const seed = 20_061;
    const source = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.set(0.25, 0.5, -0.75);
    pivot.rotation.set(0.2, -0.4, 0.1);
    pivot.scale.setScalar(0.65);
    const sourceMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 3),
      new THREE.MeshStandardMaterial(),
    );
    sourceMesh.castShadow = true;
    sourceMesh.receiveShadow = true;
    pivot.add(sourceMesh);
    source.add(pivot);
    const nodes: GatherNodeDef[] = [
      {
        id: 'ore_test_a',
        zoneId: 'test_zone',
        type: 'ore',
        pos: { x: 12, z: 18 },
        level: 1,
        tier: 1,
      },
      {
        id: 'ore_test_b',
        zoneId: 'test_zone',
        type: 'ore',
        pos: { x: 17, z: 23 },
        level: 1,
        tier: 1,
      },
    ];
    const templates = new Map<GatherNodeType, THREE.Object3D>([['ore', source]]);
    const { group } = gatherNodePreloadInternalsForTest.buildFromTemplates(seed, templates, nodes);
    const mesh = group.children[0] as THREE.InstancedMesh;
    const actual = new THREE.Matrix4();
    const placement = new THREE.Matrix4();
    const expected = new THREE.Matrix4();

    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    source.updateMatrixWorld(true);
    sourceMesh.geometry.computeBoundingBox();
    const sourceBounds = sourceMesh.geometry.boundingBox;
    expect(sourceBounds).not.toBeNull();
    if (!sourceBounds) throw new Error('source geometry lost its bounds');
    for (const [instanceId, node] of nodes.entries()) {
      const y = terrainHeight(node.pos.x, node.pos.z, seed) + NODE_Y_OFFSET[node.type];
      placement.makeTranslation(node.pos.x, y, node.pos.z);
      expected.multiplyMatrices(placement, sourceMesh.matrixWorld);
      mesh.getMatrixAt(instanceId, actual);
      for (let i = 0; i < actual.elements.length; i++) {
        expect(actual.elements[i]).toBeCloseTo(expected.elements[i], 6);
      }
      const instanceBounds = sourceBounds.clone().applyMatrix4(actual);
      expect(mesh.boundingBox?.containsBox(instanceBounds)).toBe(true);
    }
  });

  it('rejects shadows only when the whole instanced batch is behind the camera', () => {
    const template = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    template.castShadow = true;
    const nodes: GatherNodeDef[] = [
      {
        id: 'ore_behind_camera',
        zoneId: 'wide_test_zone',
        type: 'ore',
        pos: { x: 0, z: 20 },
        level: 1,
        tier: 1,
      },
      {
        id: 'ore_in_front_of_camera',
        zoneId: 'wide_test_zone',
        type: 'ore',
        pos: { x: 0, z: 160 },
        level: 1,
        tier: 1,
      },
    ];
    const templates = new Map<GatherNodeType, THREE.Object3D>([['ore', template]]);
    const view = gatherNodePreloadInternalsForTest.buildFromTemplates(20_061, templates, nodes);
    const mesh = view.group.children[0] as THREE.InstancedMesh;
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2_000);
    const lightDirection = new THREE.Vector3(0, 0, 1);

    camera.position.z = 90;
    camera.lookAt(0, 0, 91);
    camera.updateMatrixWorld(true);
    view.updateShadowVisibility(camera, lightDirection, true);
    expect(mesh.castShadow).toBe(true);

    camera.lookAt(0, 0, 89);
    camera.updateMatrixWorld(true);
    lightDirection.set(0, 0, -1);
    view.updateShadowVisibility(camera, lightDirection, true);
    expect(mesh.castShadow).toBe(true);

    camera.position.z = 1_000;
    camera.lookAt(0, 0, 1_001);
    camera.updateMatrixWorld(true);
    lightDirection.set(0, 0, 1);
    view.updateShadowVisibility(camera, lightDirection, true);
    expect(mesh.castShadow).toBe(false);

    camera.position.z = 90;
    camera.lookAt(0, 0, 91);
    camera.updateMatrixWorld(true);
    view.updateShadowVisibility(camera, lightDirection, true);
    expect(mesh.castShadow).toBe(true);
  });

  it('keeps transparent and alpha-tested authored templates as individual draws', () => {
    const transparent = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ transparent: true }),
    );
    const alphaTested = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ alphaTest: 0.5 }),
    );
    const nodes: GatherNodeDef[] = [
      {
        id: 'ore_transparent',
        zoneId: 'test_zone',
        type: 'ore',
        pos: { x: 1, z: 2 },
        level: 1,
        tier: 1,
      },
      {
        id: 'wood_alpha_tested',
        zoneId: 'test_zone',
        type: 'wood',
        pos: { x: 3, z: 4 },
        level: 1,
        tier: 1,
      },
      {
        id: 'ore_transparent_2',
        zoneId: 'test_zone',
        type: 'ore',
        pos: { x: 5, z: 6 },
        level: 1,
        tier: 1,
      },
    ];
    const templates = new Map<GatherNodeType, THREE.Object3D>([
      ['ore', transparent],
      ['wood', alphaTested],
    ]);
    const { group } = gatherNodePreloadInternalsForTest.buildFromTemplates(
      20_061,
      templates,
      nodes,
    );

    expect(group.children).toHaveLength(3);
    expect(group.children.every((child) => !(child instanceof THREE.InstancedMesh))).toBe(true);
    expect((group.children[0] as THREE.Mesh).material).toBe(transparent.material);
    expect((group.children[1] as THREE.Mesh).material).toBe(transparent.material);
    expect(group.children.map((child) => child.userData.gatherNodeId)).toEqual([
      'ore_transparent',
      'ore_transparent_2',
      'wood_alpha_tested',
    ]);
  });

  it('retains the legacy parent id fallback for unsupported authored hierarchies', () => {
    const parent = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    parent.userData.gatherNodeId = 'legacy_node';
    parent.add(mesh);

    expect(
      gatherNodeIdFromIntersection({
        distance: 0,
        point: new THREE.Vector3(),
        object: mesh,
      }),
    ).toBe('legacy_node');
    const unknown = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    expect(
      gatherNodeIdFromIntersection({
        distance: 0,
        point: new THREE.Vector3(),
        object: unknown,
        instanceId: 99,
      }),
    ).toBeNull();
  });
});
