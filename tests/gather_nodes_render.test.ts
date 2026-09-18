import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FOG_REACH_HYSTERESIS, nearestDistanceSq } from '../src/render/gather_batch_reach_core';
import {
  buildGatherNodes,
  gatherNodeIdFromIntersection,
  gatherNodePreloadInternalsForTest,
  resolveGatherNodePick,
} from '../src/render/gather_nodes';
import { NODE_Y_OFFSET, nodeTierScale } from '../src/render/gather_nodes_lookup';
import { GATHER_NODES } from '../src/sim/data';
import type { GatherNodeDef, GatherNodeType } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function oreTemplate(): THREE.Mesh {
  const template = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  template.castShadow = true;
  template.receiveShadow = true;
  return template;
}

function oreNode(id: string, x: number, z: number, zoneId = 'test_zone'): GatherNodeDef {
  return { id, zoneId, type: 'ore', pos: { x, z }, level: 1, tier: 1 };
}

function sunWithShadow(castShadow: boolean): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight();
  sun.castShadow = castShadow;
  sun.position.set(0, 0, 1);
  sun.target.position.set(0, 0, 0);
  return sun;
}

/** A reach past every node of every build below: nothing hides under it. */
const NO_HIDE_REACH = 1_000_000;

function instancedMeshes(group: THREE.Group): THREE.InstancedMesh[] {
  return group.children.filter(
    (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
  );
}

describe('gather node rendering', () => {
  it('batches repeated opaque nodes by zone and type under the coarse key', () => {
    const { group } = buildGatherNodes(1, 'coarse');
    const expectedBatches = new Set(GATHER_NODES.map((node) => `${node.zoneId}:${node.type}`));
    const meshes = instancedMeshes(group);

    // 156 nodes since the phase 20 density pass; the coarse key makes one
    // InstancedMesh per (zone, type), 42 today, derived from the content
    // rather than hand-typed so a new zone or node type moves both sides.
    expect(GATHER_NODES).toHaveLength(156);
    expect(expectedBatches.size).toBe(42);
    expect(meshes).toHaveLength(expectedBatches.size);
    expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(GATHER_NODES.length);
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(3);
    expect(new Set(meshes.map((mesh) => mesh.material)).size).toBe(3);
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.visible).toBe(true);
      expect(mesh.boundingBox).not.toBeNull();
      expect(mesh.boundingSphere).not.toBeNull();
      const nodeIds = mesh.userData.gatherNodeIds as string[];
      expect(nodeIds).toHaveLength(mesh.count);
      for (const nodeId of nodeIds) {
        const node = GATHER_NODES.find((candidate) => candidate.id === nodeId);
        expect(node?.zoneId).toBe(mesh.userData.gatherNodeZoneId);
        expect(node?.type).toBe(mesh.userData.gatherNodeType);
      }
      // The band is the batch's first node's band, kept for the mesh name.
      const first = GATHER_NODES.find((candidate) => candidate.id === nodeIds[0]);
      expect(Math.floor((first?.pos.z ?? 0) / 180)).toBe(mesh.userData.gatherNodeBand);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      expect(materials.every((material) => !material.transparent && material.alphaTest === 0)).toBe(
        true,
      );
    }
  });

  it('keeps the (zone, type, regional z-band) key under the band arm', () => {
    const { group } = buildGatherNodes(1, 'band');
    const expectedBatches = new Set(
      GATHER_NODES.map((node) => `${node.zoneId}:${node.type}:${Math.floor(node.pos.z / 180)}`),
    );
    const meshes = instancedMeshes(group);

    // 120 nodes in 57 batches through v0.33.0; the phase 20 density pass
    // (the +36 bottom-three set) took the content to 156 nodes and 69
    // batches. This is the ?gathercoarse=off A/B arm.
    expect(expectedBatches.size).toBe(69);
    expect(meshes).toHaveLength(69);
    expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(GATHER_NODES.length);
    for (const mesh of meshes) {
      const nodeIds = mesh.userData.gatherNodeIds as string[];
      expect(nodeIds).toHaveLength(mesh.count);
      for (const nodeId of nodeIds) {
        const node = GATHER_NODES.find((candidate) => candidate.id === nodeId);
        expect(node?.zoneId).toBe(mesh.userData.gatherNodeZoneId);
        expect(node?.type).toBe(mesh.userData.gatherNodeType);
        expect(Math.floor((node?.pos.z ?? 0) / 180)).toBe(mesh.userData.gatherNodeBand);
      }
    }
  });

  it('keeps each content id aligned with its instance transform and picking id', () => {
    const seed = 9;
    const { group } = buildGatherNodes(seed, 'coarse');
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
        // 5 decimal places, not 6: the instance matrix stores float32, whose
        // quantum at double-digit heights (~2e-6) already exceeds a 5e-7
        // tolerance; which side of it a node lands on depends on the exact
        // terrain height, so digit 6 was a coin flip, not a pin.
        expect(position.y).toBeCloseTo(
          terrainHeight(node.pos.x, node.pos.z, seed) +
            NODE_Y_OFFSET[node.type] -
            (nodeTierScale(node.tier) - 1) * templateMinY,
          5,
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
    const nodes: GatherNodeDef[] = [oreNode('ore_test_a', 12, 18), oreNode('ore_test_b', 17, 23)];
    const templates = new Map<GatherNodeType, THREE.Object3D>([['ore', source]]);
    const { group } = gatherNodePreloadInternalsForTest.buildFromTemplates(
      seed,
      templates,
      nodes,
      'coarse',
    );
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
    const nodes: GatherNodeDef[] = [
      oreNode('ore_behind_camera', 0, 20, 'wide_test_zone'),
      oreNode('ore_in_front_of_camera', 0, 160, 'wide_test_zone'),
    ];
    const templates = new Map<GatherNodeType, THREE.Object3D>([['ore', oreTemplate()]]);
    const view = gatherNodePreloadInternalsForTest.buildFromTemplates(
      20_061,
      templates,
      nodes,
      'coarse',
    );
    const mesh = view.group.children[0] as THREE.InstancedMesh;
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2_000);
    // The light direction the view derives is sun.position - target: along +z.
    const sun = sunWithShadow(true);

    camera.position.z = 90;
    camera.lookAt(0, 0, 91);
    camera.updateMatrixWorld(true);
    view.update(camera, sun, NO_HIDE_REACH);
    expect(mesh.castShadow).toBe(true);

    camera.lookAt(0, 0, 89);
    camera.updateMatrixWorld(true);
    sun.position.set(0, 0, -1);
    view.update(camera, sun, NO_HIDE_REACH);
    expect(mesh.castShadow).toBe(true);

    camera.position.z = 1_000;
    camera.lookAt(0, 0, 1_001);
    camera.updateMatrixWorld(true);
    sun.position.set(0, 0, 1);
    view.update(camera, sun, NO_HIDE_REACH);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.count).toBe(2);

    camera.position.z = 90;
    camera.lookAt(0, 0, 91);
    camera.updateMatrixWorld(true);
    view.update(camera, sun, NO_HIDE_REACH);
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
      oreNode('ore_transparent', 1, 2),
      {
        id: 'wood_alpha_tested',
        zoneId: 'test_zone',
        type: 'wood',
        pos: { x: 3, z: 4 },
        level: 1,
        tier: 1,
      },
      oreNode('ore_transparent_2', 5, 6),
    ];
    const templates = new Map<GatherNodeType, THREE.Object3D>([
      ['ore', transparent],
      ['wood', alphaTested],
    ]);
    const { group } = gatherNodePreloadInternalsForTest.buildFromTemplates(
      20_061,
      templates,
      nodes,
      'coarse',
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

describe('gather node rendering: the per-batch reach hide', () => {
  // Two batches of one zone: the near batch's nodes sit at z 0 and 60, the
  // far batch's at z 500 and 560 (a second type would be another batch; two
  // zones keep the fixture on the one template). The camera looks down +z
  // from `at` on the z axis.
  const build = () => {
    const nodes: GatherNodeDef[] = [
      oreNode('ore_near_a', 0, 0, 'near_zone'),
      oreNode('ore_near_b', 0, 60, 'near_zone'),
      oreNode('ore_far_a', 0, 500, 'far_zone'),
      oreNode('ore_far_b', 0, 560, 'far_zone'),
    ];
    const templates = new Map<GatherNodeType, THREE.Object3D>([['ore', oreTemplate()]]);
    const view = gatherNodePreloadInternalsForTest.buildFromTemplates(
      7,
      templates,
      nodes,
      'coarse',
    );
    const [near, far] = instancedMeshes(view.group);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2_000);
    const lookAlongZ = (at: number) => {
      camera.position.set(0, 2, at);
      camera.lookAt(0, 2, at + 1);
      camera.updateMatrixWorld(true);
    };
    return { view, near, far, camera, lookAlongZ };
  };

  it('hides a batch past the reach through count, never visible, and restores it under the reach', () => {
    const { view, near, far, camera, lookAlongZ } = build();
    const sun = sunWithShadow(false);
    lookAlongZ(0);
    view.update(camera, sun, 100);
    expect(near.count).toBe(2);
    expect(far.count).toBe(0);
    expect(far.visible).toBe(true);
    // 105 yd from the far batch's nearest node: inside the band, so it stays
    // hidden; the near batch's nearest node is now 335 yd behind and goes too.
    lookAlongZ(395);
    view.update(camera, sun, 100);
    expect(far.count).toBe(0);
    expect(near.count).toBe(0);
    expect(near.visible).toBe(true);
    // 100 yd: under the reach, shown at its full instance count.
    lookAlongZ(400);
    view.update(camera, sun, 100);
    expect(far.count).toBe(2);
    // Back into the band: hysteresis holds it.
    lookAlongZ(395);
    view.update(camera, sun, 100);
    expect(far.count).toBe(2);
    // 115 yd: past 1.1 times the reach, hidden again.
    lookAlongZ(385);
    view.update(camera, sun, 100);
    expect(far.count).toBe(0);
    // Home again: the near batch returns, the far one stays shed.
    lookAlongZ(0);
    view.update(camera, sun, 100);
    expect(near.count).toBe(2);
    expect(far.count).toBe(0);
  });

  it('never hides a batch while its nearest node is at or inside the reach (the core agrees)', () => {
    const { view, near, far, camera, lookAlongZ } = build();
    const sun = sunWithShadow(false);
    const reach = 100;
    const nearXs = Float64Array.from([0, 0]);
    const nearZs = Float64Array.from([0, 60]);
    const farZs = Float64Array.from([500, 560]);
    const checks = { nearInside: 0, farInside: 0, nearOutside: 0, farOutside: 0 };
    for (let at = -200; at <= 800; at += 7) {
      lookAlongZ(at);
      view.update(camera, sun, reach);
      const nearD2 = nearestDistanceSq(nearXs, nearZs, 0, at);
      const farD2 = nearestDistanceSq(nearXs, farZs, 0, at);
      if (nearD2 <= reach * reach) {
        checks.nearInside++;
        expect(near.count, `near at ${at}`).toBe(2);
      }
      if (farD2 <= reach * reach) {
        checks.farInside++;
        expect(far.count, `far at ${at}`).toBe(2);
      }
      // And past the band it is hidden, whatever the history.
      const hide = reach * FOG_REACH_HYSTERESIS;
      if (nearD2 > hide * hide) {
        checks.nearOutside++;
        expect(near.count, `near at ${at}`).toBe(0);
      }
      if (farD2 > hide * hide) {
        checks.farOutside++;
        expect(far.count, `far at ${at}`).toBe(0);
      }
    }
    // Every arm was exercised: a sweep that never crossed a threshold would
    // pass vacuously.
    for (const [arm, n] of Object.entries(checks)) expect(n, arm).toBeGreaterThan(0);
  });

  it('composes the hide into castShadow: a hidden batch never casts, a restored one casts if the shed allows', () => {
    const { view, near, far, camera, lookAlongZ } = build();
    const sun = sunWithShadow(true);
    lookAlongZ(0);
    view.update(camera, sun, 100);
    // Both batches are ahead of the camera, so the shed keeps them; only the
    // hide takes the far batch's shadow away.
    expect(near.castShadow).toBe(true);
    expect(far.count).toBe(0);
    expect(far.castShadow).toBe(false);
    // Under the reach again: the shed still allows, so it casts again.
    lookAlongZ(450);
    view.update(camera, sun, 100);
    expect(far.count).toBe(2);
    expect(far.castShadow).toBe(true);
    // Now the near batch is 390 yd behind a camera looking away with the
    // light along +z: shed AND hidden. Walking back under its reach restores
    // the count but the shed still says no until the camera faces it.
    expect(near.count).toBe(0);
    expect(near.castShadow).toBe(false);
    camera.position.set(0, 2, 30);
    camera.lookAt(0, 2, 31);
    camera.updateMatrixWorld(true);
    view.update(camera, sun, 100);
    expect(near.count).toBe(2);
    expect(near.castShadow).toBe(true);
    camera.lookAt(0, 2, 29);
    camera.updateMatrixWorld(true);
    view.update(camera, sun, 100);
    expect(near.count).toBe(2);
    expect(near.castShadow).toBe(true);
    // Behind and looking away, light along +z: nothing of it can shadow the view.
    camera.position.set(0, 2, 90);
    camera.lookAt(0, 2, 91);
    camera.updateMatrixWorld(true);
    view.update(camera, sun, 100);
    expect(near.count).toBe(2);
    expect(near.castShadow).toBe(false);
  });

  it('runs the hide when the sun casts no shadow while the shed does not', () => {
    const { view, near, far, camera, lookAlongZ } = build();
    const shadowless = sunWithShadow(false);
    // Both batches behind a camera looking away down +z from z = 1000, the
    // light along +z: the shed would reject them, but it is off. The hide
    // still runs, and a hidden batch never casts (the composed write).
    lookAlongZ(1_000);
    view.update(camera, shadowless, 100);
    expect(near.count).toBe(0);
    expect(far.count).toBe(0);
    expect(near.castShadow).toBe(false);
    expect(far.castShadow).toBe(false);
    // Under the reach with shadows off: the hide restores and the batch casts
    // at once, which is what says the shed never ran (its verdict would have
    // held the shadow off until a shadows-on frame re-evaluated it).
    lookAlongZ(0);
    view.update(camera, shadowless, 100);
    expect(near.count).toBe(2);
    expect(near.castShadow).toBe(true);
    // The decisive pose: the near batch 30 to 90 yd BEHIND a camera looking
    // away, light along +z, and still under the reach. The shed would reject
    // it (centre depth -60 + radius about 30.5 + the 1 yd margin is behind
    // the near plane); with shadows off it must not run, so the batch keeps
    // casting at its full count.
    camera.position.set(0, 2, 90);
    camera.lookAt(0, 2, 91);
    camera.updateMatrixWorld(true);
    view.update(camera, shadowless, 100);
    expect(near.count).toBe(2);
    expect(near.castShadow).toBe(true);
    // The same pose with shadows on: the shed runs and rejects it.
    view.update(camera, sunWithShadow(true), 100);
    expect(near.count).toBe(2);
    expect(near.castShadow).toBe(false);
    lookAlongZ(1_000);
    view.update(camera, sunWithShadow(true), 100);
    expect(near.castShadow).toBe(false);
    expect(far.castShadow).toBe(false);
  });

  it('keeps an individual-node fallback off the reach list: it never hides through the reach', () => {
    // A transparent template is not consolidated (an authored THREE.Mesh
    // clone per node, no instance count to hide through), so the reach pass
    // never measures it; only the shadow shed reaches it.
    const transparent = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ transparent: true }),
    );
    transparent.castShadow = true;
    const templates = new Map<GatherNodeType, THREE.Object3D>([['ore', transparent]]);
    const view = gatherNodePreloadInternalsForTest.buildFromTemplates(
      7,
      templates,
      [oreNode('ore_single', 0, 0)],
      'coarse',
    );
    const node = view.group.children[0] as THREE.Mesh;
    expect(node).not.toBeInstanceOf(THREE.InstancedMesh);
    expect(node.castShadow).toBe(true);
    // 1000 yd away, facing the node (the shed allows), reach 1 yd: an
    // instanced batch would hide here; the fallback keeps casting.
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2_000);
    camera.position.set(0, 2, -1_000);
    camera.lookAt(0, 2, 0);
    camera.updateMatrixWorld(true);
    const sun = sunWithShadow(true);
    sun.position.set(0, 0, -1);
    view.update(camera, sun, 1);
    expect(node.castShadow).toBe(true);
    expect(node.visible).toBe(true);
  });

  it('flips every part of a multi-part batch and composes castShadow on the casting part only', () => {
    // A template of two child meshes, one casting and one not (the way a GLB
    // with a decal or a glow part arrives): one InstancedMesh per part, both
    // hidden and restored together, and only the caster's castShadow moves.
    const source = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    body.castShadow = true;
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial(),
    );
    glow.castShadow = false;
    glow.position.y = 1;
    source.add(body, glow);
    const templates = new Map<GatherNodeType, THREE.Object3D>([['ore', source]]);
    const view = gatherNodePreloadInternalsForTest.buildFromTemplates(
      7,
      templates,
      [oreNode('ore_two_part_a', 0, 500), oreNode('ore_two_part_b', 0, 560)],
      'coarse',
    );
    const parts = instancedMeshes(view.group);
    expect(parts).toHaveLength(2);
    const [bodyPart, glowPart] = parts;
    expect(bodyPart.castShadow).toBe(true);
    expect(glowPart.castShadow).toBe(false);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2_000);
    const lookAlongZ = (at: number) => {
      camera.position.set(0, 2, at);
      camera.lookAt(0, 2, at + 1);
      camera.updateMatrixWorld(true);
    };
    const sun = sunWithShadow(true);
    lookAlongZ(0);
    view.update(camera, sun, 100);
    expect(bodyPart.count).toBe(0);
    expect(glowPart.count).toBe(0);
    expect(bodyPart.castShadow).toBe(false);
    expect(glowPart.castShadow).toBe(false);
    lookAlongZ(450);
    view.update(camera, sun, 100);
    expect(bodyPart.count).toBe(2);
    expect(glowPart.count).toBe(2);
    expect(bodyPart.castShadow).toBe(true);
    expect(glowPart.castShadow).toBe(false);
    // A shed rejection (behind a camera looking away, light along +z) moves
    // the caster only; the non-casting part is never in the caster list.
    lookAlongZ(1_000);
    view.update(camera, sun, 100);
    expect(bodyPart.castShadow).toBe(false);
    expect(glowPart.castShadow).toBe(false);
    lookAlongZ(450);
    view.update(camera, sun, 100);
    expect(bodyPart.castShadow).toBe(true);
    expect(glowPart.castShadow).toBe(false);
  });

  it('makes a hidden batch unpickable by a real Raycaster and a shown one pickable', () => {
    const { view, near, far, camera, lookAlongZ } = build();
    lookAlongZ(0);
    view.update(camera, sunWithShadow(false), 100);
    expect(far.count).toBe(0);
    view.group.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, -1, 0);
    const nearHits = new THREE.Raycaster(new THREE.Vector3(0, 50, 0), down).intersectObject(
      near,
      false,
    );
    expect(nearHits.length).toBeGreaterThan(0);
    expect(resolveGatherNodePick(nearHits)).toBe('ore_near_a');
    const farHits = new THREE.Raycaster(new THREE.Vector3(0, 50, 500), down).intersectObject(
      far,
      false,
    );
    expect(farHits).toHaveLength(0);
    expect(resolveGatherNodePick(farHits)).toBeNull();
    // Back under the reach the far batch is a click target again.
    lookAlongZ(450);
    view.update(camera, sunWithShadow(false), 100);
    const shownHits = new THREE.Raycaster(new THREE.Vector3(0, 50, 500), down).intersectObject(
      far,
      false,
    );
    expect(resolveGatherNodePick(shownHits)).toBe('ore_far_a');
  });

  it('leaves the id table and the build-time bounds untouched across a hide and a restore', () => {
    const { view, far, camera, lookAlongZ } = build();
    const ids = far.userData.gatherNodeIds as string[];
    const idsBefore = [...ids];
    const sphereBefore = far.boundingSphere?.clone();
    const boxBefore = far.boundingBox?.clone();
    expect(sphereBefore).toBeDefined();
    expect(boxBefore).toBeDefined();
    lookAlongZ(0);
    view.update(camera, sunWithShadow(false), 100);
    expect(far.count).toBe(0);
    expect(far.userData.gatherNodeIds).toBe(ids);
    expect(ids).toEqual(idsBefore);
    expect(far.boundingSphere?.equals(sphereBefore as THREE.Sphere)).toBe(true);
    expect(far.boundingBox?.equals(boxBefore as THREE.Box3)).toBe(true);
    lookAlongZ(500);
    view.update(camera, sunWithShadow(false), 100);
    expect(far.count).toBe(idsBefore.length);
    expect(far.userData.gatherNodeIds).toBe(ids);
    expect(far.boundingSphere?.equals(sphereBefore as THREE.Sphere)).toBe(true);
    expect(far.boundingBox?.equals(boxBefore as THREE.Box3)).toBe(true);
  });

  it('draws every batch to the far plane under the band arm', () => {
    const nodes: GatherNodeDef[] = [oreNode('ore_near', 0, 0), oreNode('ore_far', 0, 500)];
    const templates = new Map<GatherNodeType, THREE.Object3D>([['ore', oreTemplate()]]);
    const view = gatherNodePreloadInternalsForTest.buildFromTemplates(7, templates, nodes, 'band');
    const meshes = instancedMeshes(view.group);
    expect(meshes).toHaveLength(2);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2_000);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 2, 1);
    camera.updateMatrixWorld(true);
    view.update(camera, sunWithShadow(false), 100);
    for (const mesh of meshes) expect(mesh.count).toBe(1);
  });
});
